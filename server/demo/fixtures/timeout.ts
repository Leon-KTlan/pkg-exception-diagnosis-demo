import { STEP_DEFINITIONS, type Diagnosis } from "../../../shared/protocol.js";
import type { DemoFixture, DemoFixtureEvent } from "../replay.js";

const packageId = "PKG-TIMEOUT";

const packageRecord = {
  packageId,
  status: "ARRIVED_AT_WAREHOUSE",
  warehouseId: "WH-EAST-01",
  warehouseName: "华东一号仓",
  arrivedAt: "2026-09-18T10:06:08+08:00",
  receiptId: "RCV-TIMEOUT-001",
  expectedQuantity: 6,
};

const receiptRecord = {
  receiptId: "RCV-TIMEOUT-001",
  packageId,
  status: "RECEIVED",
  receivedAt: "2026-09-18T10:19:12+08:00",
  checkedQuantity: 6,
  putawayTaskId: "PUT-TIMEOUT-001",
};

const timeoutError = "get_putaway_task 查询超时";
const blockedError = "上游步骤失败，当前步骤无法执行";

const event = (
  type: DemoFixtureEvent["type"],
  payload: DemoFixtureEvent["payload"],
  stepId: DemoFixtureEvent["stepId"],
  delayMs: number,
): DemoFixtureEvent => ({ type, payload, stepId, delayMs });

export const timeoutFixture: DemoFixture = {
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
        output: { ...packageRecord, packageId: currentPackageId },
        durationMs: 160,
        attempt: 1,
      }),
      "package",
      200,
    ),
    event(
      "step.completed",
      ({ packageId: currentPackageId }) => ({
        status: "SUCCESS",
        output: { ...packageRecord, packageId: currentPackageId },
        durationMs: 620,
      }),
      "package",
      240,
    ),
    event(
      "step.started",
      () => ({
        status: "RUNNING",
        kind: "TOOL_CALL",
        toolName: "get_receipt",
        input: { receiptId: receiptRecord.receiptId },
      }),
      "receipt",
      240,
    ),
    event(
      "tool.call.started",
      () => ({
        status: "RUNNING",
        toolName: "get_receipt",
        input: { receiptId: receiptRecord.receiptId },
        attempt: 1,
      }),
      "receipt",
      180,
    ),
    event(
      "tool.call.completed",
      ({ packageId: currentPackageId }) => ({
        status: "SUCCESS",
        toolName: "get_receipt",
        input: { receiptId: receiptRecord.receiptId },
        output: { ...receiptRecord, packageId: currentPackageId },
        durationMs: 180,
        attempt: 1,
      }),
      "receipt",
      200,
    ),
    event(
      "step.completed",
      ({ packageId: currentPackageId }) => ({
        status: "SUCCESS",
        output: { ...receiptRecord, packageId: currentPackageId },
        durationMs: 640,
      }),
      "receipt",
      240,
    ),
    event(
      "step.started",
      () => ({
        status: "RUNNING",
        kind: "TOOL_CALL",
        toolName: "get_putaway_task",
        input: { taskId: receiptRecord.putawayTaskId },
      }),
      "putaway",
      240,
    ),
    event(
      "tool.call.started",
      () => ({
        status: "RUNNING",
        toolName: "get_putaway_task",
        input: { taskId: receiptRecord.putawayTaskId },
        attempt: 1,
      }),
      "putaway",
      180,
    ),
    event(
      "step.retrying",
      () => ({
        status: "RETRYING",
        toolName: "get_putaway_task",
        input: { taskId: receiptRecord.putawayTaskId },
        attempt: 2,
        error: timeoutError,
      }),
      "putaway",
      260,
    ),
    event(
      "tool.call.started",
      () => ({
        status: "RUNNING",
        toolName: "get_putaway_task",
        input: { taskId: receiptRecord.putawayTaskId },
        attempt: 2,
      }),
      "putaway",
      180,
    ),
    event(
      "step.failed",
      () => ({
        status: "ERROR",
        toolName: "get_putaway_task",
        input: { taskId: receiptRecord.putawayTaskId },
        error: timeoutError,
        durationMs: 980,
      }),
      "putaway",
      240,
    ),
    event(
      "step.completed",
      () => ({ status: "BLOCKED", error: blockedError }),
      "anomaly",
      180,
    ),
    event(
      "step.completed",
      () => ({ status: "BLOCKED", error: blockedError }),
      "evidence",
      180,
    ),
    event(
      "step.completed",
      () => ({ status: "BLOCKED", error: "诊断链路未完整执行" }),
      "diagnosis",
      180,
    ),
    event(
      "trace.failed",
      () => ({
        error: timeoutError,
        totalDurationMs: 4320,
        toolCallCount: 4,
        terminationReason: "TOOL_TIMEOUT",
      }),
      undefined,
      160,
    ),
  ],
};
