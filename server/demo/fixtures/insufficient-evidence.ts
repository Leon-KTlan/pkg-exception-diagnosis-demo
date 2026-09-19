import { STEP_DEFINITIONS, type Diagnosis } from "../../../shared/protocol.js";
import type { DemoFixture, DemoFixtureEvent } from "../replay.js";

const packageId = "PKG-404";

const diagnosis: Diagnosis = {
  status: "INSUFFICIENT_EVIDENCE",
  summary: "未找到包裹记录",
  reason: "当前包裹号没有对应仓储记录，无法继续诊断。",
  severity: "LOW",
  evidenceIds: [],
  actions: [
    {
      title: "核对包裹号",
      description: "确认包裹号后重新发起诊断。",
      priority: "P1",
      owner: "仓库操作员",
    },
  ],
  limitations: ["缺少包裹基础数据"],
};

const event = (
  type: DemoFixtureEvent["type"],
  payload: DemoFixtureEvent["payload"],
  stepId: DemoFixtureEvent["stepId"],
  delayMs: number,
): DemoFixtureEvent => ({ type, payload, stepId, delayMs });

const blocked = (error: string) => ({
  status: "BLOCKED",
  error,
});

export const insufficientEvidenceFixture: DemoFixture = {
  packageId,
  events: [
    event(
      "trace.started",
      ({ question }) => ({
        mode: "demo",
        simulated: true,
        question,
        model: "固定回放",
        steps: STEP_DEFINITIONS,
      }),
      undefined,
      0,
    ),
    event(
      "step.started",
      ({ question }) => ({
        status: "RUNNING",
        kind: "AGENT_NODE",
        toolName: "intent_router",
        input: { question },
      }),
      "identify",
      240,
    ),
    event(
      "step.completed",
      ({ question, packageId: currentPackageId }) => ({
        status: "SUCCESS",
        output: {
          packageId: currentPackageId,
          intent: "WAREHOUSE_INBOUND_DIAGNOSIS",
          normalizedQuestion: question,
        },
        durationMs: 320,
      }),
      "identify",
      320,
    ),
    event(
      "step.started",
      ({ packageId: currentPackageId }) => ({
        status: "RUNNING",
        kind: "TOOL_CALL",
        toolName: "get_package",
        input: { packageId: currentPackageId },
      }),
      "package",
      240,
    ),
    event(
      "tool.call.started",
      ({ packageId: currentPackageId }) => ({
        status: "RUNNING",
        toolName: "get_package",
        input: { packageId: currentPackageId },
        attempt: 1,
      }),
      "package",
      180,
    ),
    event(
      "tool.call.completed",
      ({ packageId: currentPackageId }) => ({
        status: "SUCCESS",
        toolName: "get_package",
        input: { packageId: currentPackageId },
        output: null,
        durationMs: 140,
        attempt: 1,
      }),
      "package",
      200,
    ),
    event(
      "step.completed",
      () => ({ status: "SUCCESS", output: null, durationMs: 620 }),
      "package",
      240,
    ),
    event(
      "step.completed",
      () => blocked("未找到包裹，缺少继续查询所需的关联单号"),
      "receipt",
      180,
    ),
    event(
      "step.completed",
      () => blocked("未找到包裹，缺少继续查询所需的关联单号"),
      "putaway",
      180,
    ),
    event(
      "step.completed",
      () => blocked("未找到包裹，缺少继续查询所需的关联单号"),
      "anomaly",
      180,
    ),
    event(
      "step.completed",
      () => blocked("未找到包裹，缺少继续查询所需的关联单号"),
      "evidence",
      180,
    ),
    event(
      "step.started",
      ({ packageId: currentPackageId }) => ({
        status: "RUNNING",
        kind: "AGENT_NODE",
        toolName: "diagnosis_synthesizer",
        input: { packageId: currentPackageId, evidenceIds: [] },
      }),
      "diagnosis",
      240,
    ),
    event(
      "step.completed",
      () => ({ status: "SUCCESS", output: diagnosis, durationMs: 420 }),
      "diagnosis",
      320,
    ),
    event(
      "trace.completed",
      () => ({
        diagnosis,
        evidence: [],
        totalDurationMs: 3280,
        toolCallCount: 1,
      }),
      "diagnosis",
      160,
    ),
  ],
};
