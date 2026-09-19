import {
  STEP_DEFINITIONS,
  type Diagnosis,
  type Evidence,
} from "../../../shared/protocol.js";
import type { DemoFixture, DemoFixtureEvent } from "../replay.js";

const packageId = "PKG-20260918";

const packageRecord = {
  packageId,
  status: "ARRIVED_AT_WAREHOUSE",
  warehouseId: "WH-EAST-01",
  warehouseName: "华东一号仓",
  arrivedAt: "2026-09-18T09:42:16+08:00",
  receiptId: "RCV-20260918-0471",
  expectedQuantity: 12,
};

const receiptRecord = {
  receiptId: "RCV-20260918-0471",
  packageId,
  status: "RECEIVED",
  receivedAt: "2026-09-18T10:03:51+08:00",
  checkedQuantity: 12,
  putawayTaskId: "PUT-20260918-0834",
};

const putawayTaskRecord = {
  taskId: "PUT-20260918-0834",
  receiptId: "RCV-20260918-0471",
  status: "BLOCKED",
  targetBin: "A-03-17",
  reasonCode: "BIN_CAPACITY_EXCEEDED",
  requiredCapacity: 12,
  availableCapacity: 0,
  blockedSince: "2026-09-18T10:04:27+08:00",
};

const evidence: Evidence[] = [
  {
    evidenceId: "EV-PKG-STATUS",
    sourceStepId: "package",
    title: "包裹已到仓",
    fact: `${packageId} 已于 2026-09-18T09:42:16+08:00 到达华东一号仓`,
    sourceField: "status",
    rawValue: "ARRIVED_AT_WAREHOUSE",
  },
  {
    evidenceId: "EV-RECEIPT-STATUS",
    sourceStepId: "receipt",
    title: "收货单已完成",
    fact: "RCV-20260918-0471 已完成 12 件货物核对",
    sourceField: "status",
    rawValue: "RECEIVED",
  },
  {
    evidenceId: "EV-PUTAWAY-STATUS",
    sourceStepId: "putaway",
    title: "入库任务被阻塞",
    fact: "PUT-20260918-0834 当前状态为 BLOCKED",
    sourceField: "status",
    rawValue: "BLOCKED",
  },
  {
    evidenceId: "EV-BIN-CAPACITY",
    sourceStepId: "putaway",
    title: "目标库位容量不足",
    fact: "库位 A-03-17 可用容量为 0，低于所需 12",
    sourceField: "reasonCode",
    rawValue: "BIN_CAPACITY_EXCEEDED",
  },
];

const diagnosis: Diagnosis = {
  status: "CONFIRMED",
  summary: "目标库位容量不足导致入库任务阻塞",
  reason: "包裹已完成收货，但入库任务无法分配到目标库位。",
  severity: "HIGH",
  evidenceIds: evidence.map((item) => item.evidenceId),
  actions: [
    {
      title: "重新分配库位",
      description: "选择具备足够容量的可用库位。",
      priority: "P1",
      owner: "仓库操作员",
    },
  ],
  limitations: [],
};

const event = (
  type: DemoFixtureEvent["type"],
  payload: DemoFixtureEvent["payload"],
  stepId: DemoFixtureEvent["stepId"],
  delayMs: number,
): DemoFixtureEvent => ({ type, payload, stepId, delayMs });

export const successFixture: DemoFixture = {
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
      320,
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
        durationMs: 420,
      }),
      "identify",
      420,
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
      320,
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
      220,
    ),
    event(
      "tool.call.completed",
      ({ packageId: currentPackageId }) => ({
        status: "SUCCESS",
        toolName: "get_package",
        input: { packageId: currentPackageId },
        output: { ...packageRecord, packageId: currentPackageId },
        durationMs: 180,
        attempt: 1,
      }),
      "package",
      260,
    ),
    event(
      "step.completed",
      () => ({ status: "SUCCESS", output: packageRecord, durationMs: 760 }),
      "package",
      320,
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
      320,
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
      220,
    ),
    event(
      "tool.call.completed",
      () => ({
        status: "SUCCESS",
        toolName: "get_receipt",
        input: { receiptId: receiptRecord.receiptId },
        output: receiptRecord,
        durationMs: 210,
        attempt: 1,
      }),
      "receipt",
      260,
    ),
    event(
      "step.completed",
      () => ({ status: "SUCCESS", output: receiptRecord, durationMs: 790 }),
      "receipt",
      320,
    ),
    event(
      "step.started",
      () => ({
        status: "RUNNING",
        kind: "TOOL_CALL",
        toolName: "get_putaway_task",
        input: { taskId: putawayTaskRecord.taskId },
      }),
      "putaway",
      320,
    ),
    event(
      "tool.call.started",
      () => ({
        status: "RUNNING",
        toolName: "get_putaway_task",
        input: { taskId: putawayTaskRecord.taskId },
        attempt: 1,
      }),
      "putaway",
      220,
    ),
    event(
      "tool.call.completed",
      () => ({
        status: "SUCCESS",
        toolName: "get_putaway_task",
        input: { taskId: putawayTaskRecord.taskId },
        output: putawayTaskRecord,
        durationMs: 260,
        attempt: 1,
      }),
      "putaway",
      260,
    ),
    event(
      "step.completed",
      () => ({ status: "SUCCESS", output: putawayTaskRecord, durationMs: 840 }),
      "putaway",
      320,
    ),
    event(
      "step.started",
      () => ({
        status: "RUNNING",
        kind: "AGENT_NODE",
        toolName: "anomaly_detector",
        input: {
          package: packageRecord,
          receipt: receiptRecord,
          putawayTask: putawayTaskRecord,
        },
      }),
      "anomaly",
      320,
    ),
    event(
      "step.completed",
      () => ({
        status: "SUCCESS",
        output: {
          found: true,
          reasonCode: "BIN_CAPACITY_EXCEEDED",
          reason: "目标库位容量不足",
          severity: "HIGH",
        },
        durationMs: 680,
      }),
      "anomaly",
      420,
    ),
    event(
      "step.started",
      () => ({
        status: "RUNNING",
        kind: "AGENT_NODE",
        toolName: "evidence_builder",
        input: { sourceSteps: ["package", "receipt", "putaway"] },
      }),
      "evidence",
      320,
    ),
    event(
      "step.completed",
      () => ({ status: "SUCCESS", output: evidence, durationMs: 520 }),
      "evidence",
      420,
    ),
    event(
      "step.started",
      ({ packageId: currentPackageId }) => ({
        status: "RUNNING",
        kind: "AGENT_NODE",
        toolName: "diagnosis_synthesizer",
        input: {
          packageId: currentPackageId,
          evidenceIds: evidence.map((item) => item.evidenceId),
        },
      }),
      "diagnosis",
      320,
    ),
    event(
      "step.completed",
      () => ({ status: "SUCCESS", output: diagnosis, durationMs: 640 }),
      "diagnosis",
      420,
    ),
    event(
      "trace.completed",
      () => ({
        diagnosis,
        evidence,
        totalDurationMs: 6380,
        toolCallCount: 3,
      }),
      "diagnosis",
      240,
    ),
  ],
};
