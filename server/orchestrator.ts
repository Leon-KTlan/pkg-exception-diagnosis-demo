import { randomUUID } from "node:crypto";
import {
  STEP_DEFINITIONS,
  type Diagnosis,
  type Evidence,
  type StepId,
  type StepPayload,
  type TraceCompletedPayload,
  type TraceEvent,
  type TraceEventType,
  type TraceFailedPayload,
  type TraceStartedPayload,
} from "../shared/protocol.js";
import { buildEvidence, validateDiagnosis } from "./evidence.js";
import type { AgentContext, ModelGateway } from "./model.js";
import {
  ClientDisconnectedError,
  DiagnosisTimeoutError,
  abortableDelay,
  createChildAbortController,
  getAbortReason,
  raceWithAbort,
} from "./abort.js";
import {
  ToolTimeoutError,
  type PackageRecord,
  type PutawayTaskRecord,
  type ReceiptRecord,
  type ToolRegistry,
  type WarehouseTool,
} from "./tools.js";

export interface RunDiagnosisOptions {
  question: string;
  packageId: string;
  model: ModelGateway;
  tools: ToolRegistry;
  emit: (event: TraceEvent) => void | Promise<void>;
  minimumStepMs?: number;
  traceId?: string;
  signal?: AbortSignal;
  diagnosisTimeoutMs?: number;
  toolTimeoutMs?: number;
}

export const TOOL_TIMEOUT_MS = 10_000;
export const DIAGNOSIS_TIMEOUT_MS = 110_000;

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "发生未知错误";

const toTerminationReason = (error: unknown) => {
  const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
  switch (code) {
    case "MODEL_TIMEOUT":
      return "MODEL_TIMEOUT" as const;
    case "TOOL_TIMEOUT":
      return "TOOL_TIMEOUT" as const;
    case "DIAGNOSIS_TIMEOUT":
      return "DIAGNOSIS_TIMEOUT" as const;
    case "CLIENT_DISCONNECTED":
      return "SERVER_DISCONNECTED" as const;
    default:
      return "SERVER_ERROR" as const;
  }
};

export const runDiagnosis = async ({
  question,
  packageId,
  model,
  tools,
  emit: outputEvent,
  minimumStepMs = 400,
  traceId = `tr_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  signal,
  diagnosisTimeoutMs = DIAGNOSIS_TIMEOUT_MS,
  toolTimeoutMs = TOOL_TIMEOUT_MS,
}: RunDiagnosisOptions) => {
  const diagnosisDeadline = createChildAbortController(
    signal,
    diagnosisTimeoutMs,
    new DiagnosisTimeoutError(),
  );
  const executionSignal = diagnosisDeadline.signal;
  const traceStartedAt = performance.now();
  let sequence = 0;
  let toolCallCount = 0;
  let currentStepIndex = -1;

  const emit = async <T>(
    type: TraceEventType,
    payload: T,
    stepId?: StepId,
  ) => {
    if (signal?.aborted) {
      throw getAbortReason(signal);
    }
    sequence += 1;
    await outputEvent({
      traceId,
      sequence,
      timestamp: new Date().toISOString(),
      stepId,
      type,
      payload,
    } as TraceEvent);
  };

  const waitForMinimumDisplay = async (startedAt: number) => {
    const remaining = minimumStepMs - (performance.now() - startedAt);
    if (remaining > 0) {
      await abortableDelay(remaining, executionSignal);
    }
  };

  const startStep = async (stepId: StepId, input: unknown) => {
    currentStepIndex = STEP_DEFINITIONS.findIndex((step) => step.id === stepId);
    const definition = STEP_DEFINITIONS[currentStepIndex];
    await emit<StepPayload>(
      "step.started",
      {
        status: "RUNNING",
        kind: definition.kind,
        toolName: definition.toolName,
        input,
      },
      stepId,
    );
  };

  const completeStep = async (
    stepId: StepId,
    startedAt: number,
    output: unknown,
    status: StepPayload["status"] = "SUCCESS",
  ) => {
    const durationMs = Math.round(performance.now() - startedAt);
    await waitForMinimumDisplay(startedAt);
    await emit<StepPayload>(
      "step.completed",
      { status, output, durationMs },
      stepId,
    );
    return durationMs;
  };

  const runAgentStep = async <T>(
    stepId: StepId,
    input: unknown,
    operation: (signal: AbortSignal) => Promise<T> | T,
  ) => {
    const startedAt = performance.now();
    await startStep(stepId, input);
    try {
      const result = await raceWithAbort(
        Promise.resolve().then(() => operation(executionSignal)),
        executionSignal,
      );
      await completeStep(stepId, startedAt, result);
      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      await emit<StepPayload>(
        "step.failed",
        {
          status: "ERROR",
          error: toErrorMessage(error),
          durationMs,
        },
        stepId,
      );
      throw error;
    }
  };

  const runToolStep = async <T>(
    stepId: StepId,
    context: AgentContext,
    expectedToolName: string,
    expectedInput: Record<string, unknown>,
  ): Promise<T> => {
    const startedAt = performance.now();
    await startStep(stepId, expectedInput);
    const tool = tools[expectedToolName] as WarehouseTool<
      Record<string, unknown>,
      T
    >;
    if (!tool) {
      throw new Error(`工具 ${expectedToolName} 未注册`);
    }

    try {
      const selection = await model.selectTool(context, [tool], executionSignal);
      if (selection.name !== expectedToolName) {
        throw new Error(`Agent 选择了不允许的工具 ${selection.name}`);
      }
      for (const [key, expectedValue] of Object.entries(expectedInput)) {
        if (selection.arguments[key] !== expectedValue) {
          throw new Error(`工具参数 ${key} 与已知业务事实不一致`);
        }
      }

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        toolCallCount += 1;
        const toolStartedAt = performance.now();
        await emit<StepPayload>(
          "tool.call.started",
          {
            status: "RUNNING",
            toolName: selection.name,
            input: selection.arguments,
            attempt,
          },
          stepId,
        );
        try {
          const toolDeadline = createChildAbortController(
            executionSignal,
            toolTimeoutMs,
            new ToolTimeoutError(selection.name),
          );
          let result: T;
          try {
            result = await raceWithAbort(
              tool.execute(selection.arguments, {
                traceId,
                signal: toolDeadline.signal,
              }),
              toolDeadline.signal,
            );
          } catch (toolError) {
            if (toolDeadline.didTimeout()) {
              throw new ToolTimeoutError(selection.name);
            }
            throw toolError;
          } finally {
            toolDeadline.cleanup();
          }
          const toolDurationMs = Math.round(performance.now() - toolStartedAt);
          await emit<StepPayload>(
            "tool.call.completed",
            {
              status: "SUCCESS",
              toolName: selection.name,
              input: selection.arguments,
              output: result,
              durationMs: toolDurationMs,
              attempt,
            },
            stepId,
          );
          await completeStep(stepId, startedAt, result);
          return result;
        } catch (error) {
          if (error instanceof ToolTimeoutError && attempt === 1) {
            await emit<StepPayload>(
              "step.retrying",
              {
                status: "RETRYING",
                toolName: selection.name,
                input: selection.arguments,
                attempt: 2,
                error: error.message,
              },
              stepId,
            );
            continue;
          }
          throw error;
        }
      }
      throw new Error(`${expectedToolName} 执行失败`);
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      await emit<StepPayload>(
        "step.failed",
        {
          status: "ERROR",
          toolName: expectedToolName,
          input: expectedInput,
          error: toErrorMessage(error),
          durationMs,
        },
        stepId,
      );
      throw error;
    }
  };

  const blockSteps = async (stepIds: StepId[], reason: string) => {
    for (const stepId of stepIds) {
      await emit<StepPayload>(
        "step.completed",
        { status: "BLOCKED", error: reason },
        stepId,
      );
    }
  };

  const composeDiagnosis = async (
    context: AgentContext,
    evidence: Evidence[],
    signal: AbortSignal,
  ): Promise<Diagnosis> => {
    let validationError: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const diagnosis = await model.composeDiagnosis(
        context,
        evidence,
        validationError,
        signal,
      );
      validationError = validateDiagnosis(diagnosis, evidence) ?? undefined;
      if (!validationError) {
        return diagnosis;
      }
      if (attempt === 1) {
        await emit<StepPayload>(
          "step.retrying",
          {
            status: "RETRYING",
            attempt: 2,
            error: `结构化结果校验失败：${validationError}`,
          },
          "diagnosis",
        );
      }
    }
    throw new Error(`最终诊断校验失败：${validationError}`);
  };

  const context: AgentContext = {
    question,
    packageId,
  };

  try {
    if (signal?.aborted) {
      return { traceId, cancelled: true };
    }

    await emit<TraceStartedPayload>("trace.started", {
      mode: "live",
      simulated: false,
      question,
      model: model.modelName,
      steps: STEP_DEFINITIONS,
    });

    await runAgentStep("identify", { question }, async (stepSignal) => {
      const intent = await model.identify(question, packageId, stepSignal);
      if (
        !intent ||
        typeof intent.packageId !== "string" ||
        intent.intent !== "WAREHOUSE_INBOUND_DIAGNOSIS" ||
        typeof intent.normalizedQuestion !== "string" ||
        !intent.normalizedQuestion.trim()
      ) {
        throw new Error("意图识别结果格式无效");
      }
      if (intent.packageId.trim().toUpperCase() !== packageId) {
        throw new Error("意图识别结果与用户输入的包裹号不一致");
      }
      if (!intent.normalizedQuestion.toUpperCase().includes(packageId)) {
        throw new Error("规范化问题未保留用户输入的包裹号");
      }
      return intent;
    });

    context.packageRecord = await runToolStep<PackageRecord | null>(
      "package",
      context,
      "get_package",
      { packageId: context.packageId },
    );

    if (!context.packageRecord) {
      await blockSteps(
        ["receipt", "putaway", "anomaly", "evidence"],
        "未找到包裹，缺少继续查询所需的关联单号",
      );
      const diagnosis = await runAgentStep(
        "diagnosis",
        { packageId: context.packageId, evidenceIds: [] },
        (stepSignal) => composeDiagnosis(context, [], stepSignal),
      );
      const payload: TraceCompletedPayload = {
        diagnosis,
        evidence: [],
        totalDurationMs: Math.round(performance.now() - traceStartedAt),
        toolCallCount,
        ...(model.tokenUsage > 0 ? { tokenUsage: model.tokenUsage } : {}),
      };
      await emit("trace.completed", payload, "diagnosis");
      return { traceId, diagnosis, evidence: [] };
    }

    context.receiptRecord = await runToolStep<ReceiptRecord | null>(
      "receipt",
      context,
      "get_receipt",
      { receiptId: context.packageRecord.receiptId },
    );

    if (!context.receiptRecord) {
      await blockSteps(
        ["putaway", "anomaly", "evidence"],
        "未找到收货单，无法确认后续入库任务",
      );
      const evidence = buildEvidence(context);
      const diagnosis = await runAgentStep(
        "diagnosis",
        { packageId: context.packageId, evidenceIds: evidence.map((item) => item.evidenceId) },
        (stepSignal) => composeDiagnosis(context, evidence, stepSignal),
      );
      await emit<TraceCompletedPayload>(
        "trace.completed",
        {
          diagnosis,
          evidence,
          totalDurationMs: Math.round(performance.now() - traceStartedAt),
          toolCallCount,
          ...(model.tokenUsage > 0 ? { tokenUsage: model.tokenUsage } : {}),
        },
        "diagnosis",
      );
      return { traceId, diagnosis, evidence };
    }

    context.putawayTaskRecord = await runToolStep<PutawayTaskRecord | null>(
      "putaway",
      context,
      "get_putaway_task",
      { taskId: context.receiptRecord.putawayTaskId },
    );

    context.anomaly = await runAgentStep(
      "anomaly",
      {
        package: context.packageRecord,
        receipt: context.receiptRecord,
        putawayTask: context.putawayTaskRecord,
      },
      (stepSignal) => model.detectAnomaly(context, stepSignal),
    );

    const evidence = await runAgentStep(
      "evidence",
      {
        sourceSteps: ["package", "receipt", "putaway"],
      },
      () => buildEvidence(context),
    );

    const diagnosis = await runAgentStep(
      "diagnosis",
      {
        packageId: context.packageId,
        evidenceIds: evidence.map((item) => item.evidenceId),
      },
      (stepSignal) => composeDiagnosis(context, evidence, stepSignal),
    );

    await emit<TraceCompletedPayload>(
      "trace.completed",
      {
        diagnosis,
        evidence,
        totalDurationMs: Math.round(performance.now() - traceStartedAt),
        toolCallCount,
        ...(model.tokenUsage > 0 ? { tokenUsage: model.tokenUsage } : {}),
      },
      "diagnosis",
    );
    return { traceId, diagnosis, evidence };
  } catch (error) {
    if (signal?.aborted || error instanceof ClientDisconnectedError) {
      return { traceId, cancelled: true };
    }
    const terminalError = diagnosisDeadline.didTimeout()
      ? new DiagnosisTimeoutError()
      : error;
    const followingSteps = STEP_DEFINITIONS.slice(currentStepIndex + 1)
      .map((step) => step.id)
      .filter((stepId) => stepId !== "diagnosis");
    await blockSteps(followingSteps, "上游步骤失败，当前步骤无法执行");
    if (currentStepIndex < STEP_DEFINITIONS.length - 1) {
      await emit<StepPayload>(
        "step.completed",
        { status: "BLOCKED", error: "诊断链路未完整执行" },
        "diagnosis",
      );
    }
    await emit<TraceFailedPayload>("trace.failed", {
      error: toErrorMessage(terminalError),
      totalDurationMs: Math.round(performance.now() - traceStartedAt),
      toolCallCount,
      terminationReason: toTerminationReason(terminalError),
    });
    return { traceId, error: toErrorMessage(terminalError) };
  } finally {
    diagnosisDeadline.cleanup();
  }
};
