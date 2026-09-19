import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  Diagnosis,
  Evidence,
  TraceCompletedPayload,
  TraceEvent,
} from "../shared/protocol.js";
import { createApp } from "./app.js";
import type {
  AgentContext,
  AnomalyResult,
  IntentResult,
  ModelGateway,
  SelectedTool,
} from "./model.js";
import { createWarehouseTools, type WarehouseTool } from "./tools.js";

class FakeModel implements ModelGateway {
  readonly modelName = "fake-deepseek";
  readonly tokenUsage = 42;
  toolSelectionCalls = 0;

  constructor(
    private readonly invalidEvidence = false,
    private readonly identifyPackageId?: string,
  ) {}

  async identify(question: string): Promise<IntentResult> {
    const packageId =
      this.identifyPackageId ??
      question.match(/PKG-[A-Z0-9-]+/i)?.[0]?.toUpperCase() ?? "";
    return {
      packageId,
      intent: "WAREHOUSE_INBOUND_DIAGNOSIS",
      normalizedQuestion: question,
    };
  }

  async selectTool(
    context: AgentContext,
    eligibleTools: WarehouseTool[],
  ): Promise<SelectedTool> {
    this.toolSelectionCalls += 1;
    const name = eligibleTools[0].name;
    const argumentsByTool: Record<string, Record<string, unknown>> = {
      get_package: { packageId: context.packageId },
      get_receipt: { receiptId: context.packageRecord?.receiptId },
      get_putaway_task: { taskId: context.receiptRecord?.putawayTaskId },
    };
    return { name, arguments: argumentsByTool[name] };
  }

  async detectAnomaly(): Promise<AnomalyResult> {
    return {
      found: true,
      reasonCode: "BIN_CAPACITY_EXCEEDED",
      reason: "目标库位容量不足",
      severity: "HIGH",
    };
  }

  async composeDiagnosis(
    context: AgentContext,
    evidence: Evidence[],
  ): Promise<Diagnosis> {
    const hasPackage = Boolean(context.packageRecord);
    return {
      status: hasPackage ? "CONFIRMED" : "INSUFFICIENT_EVIDENCE",
      summary: hasPackage ? "目标库位容量不足导致入库任务阻塞" : "未找到包裹记录",
      reason: hasPackage
        ? "包裹已完成收货，但入库任务无法分配到目标库位。"
        : "当前包裹号没有对应仓储记录，无法继续诊断。",
      severity: hasPackage ? "HIGH" : "LOW",
      evidenceIds: this.invalidEvidence
        ? ["EV-NOT-EXISTS"]
        : evidence.map((item) => item.evidenceId),
      actions: [
        {
          title: hasPackage ? "重新分配库位" : "核对包裹号",
          description: hasPackage
            ? "选择具备足够容量的可用库位。"
            : "确认包裹号后重新发起诊断。",
          priority: "P1",
          owner: "仓库操作员",
        },
      ],
      limitations: hasPackage ? [] : ["缺少包裹基础数据"],
    };
  }
}

const parseEvents = (body: string) =>
  body
    .split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data:")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(5).trim()) as TraceEvent);

const createTestApp = (
  options: { invalidEvidence?: boolean; identifyPackageId?: string } = {},
) => {
  const model = new FakeModel(options.invalidEvidence, options.identifyPackageId);
  return {
    app: createApp({
      createModel: () => model,
      tools: createWarehouseTools(),
      minimumStepMs: 0,
    }),
    model,
  };
};

describe("POST /api/diagnoses/stream", () => {
  it("streams an ordered, evidence-backed diagnosis for the primary package", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({
        question: "包裹 PKG-20260918 为什么还没有入库？",
      })
      .expect(200)
      .expect("Content-Type", /text\/event-stream/);

    const events = parseEvents(response.text);
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(events.filter((event) => event.type === "tool.call.started")).toHaveLength(3);

    const completed = events.at(-1);
    expect(completed?.type).toBe("trace.completed");
    expect(
      events.find((event) => event.type === "step.completed" && event.stepId === "identify")?.payload,
    ).toMatchObject({
      status: "SUCCESS",
      output: {
        packageId: "PKG-20260918",
        intent: "WAREHOUSE_INBOUND_DIAGNOSIS",
        normalizedQuestion: "包裹 PKG-20260918 为什么还没有入库？",
      },
    });
    const payload = completed?.payload as unknown as TraceCompletedPayload;
    expect(payload.diagnosis.status).toBe("CONFIRMED");
    expect(payload.evidence).toHaveLength(4);
    expect(payload.diagnosis.evidenceIds).toEqual(
      payload.evidence.map((item) => item.evidenceId),
    );
  });

  it("distinguishes an empty business result from a tool failure", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({
        question: "包裹 PKG-404 为什么还没有入库？",
      })
      .expect(200);

    const events = parseEvents(response.text);
    const packageCompleted = events.find(
      (event) => event.type === "step.completed" && event.stepId === "package",
    );
    const receiptBlocked = events.find(
      (event) => event.type === "step.completed" && event.stepId === "receipt",
    );
    const completed = events.at(-1)?.payload as unknown as TraceCompletedPayload;

    expect(packageCompleted?.payload).toMatchObject({ status: "SUCCESS", output: null });
    expect(receiptBlocked?.payload).toMatchObject({ status: "BLOCKED" });
    expect(completed.diagnosis.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(completed.evidence).toEqual([]);
  });

  it("retries one timeout and blocks downstream steps after the second failure", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({
        question: "包裹 PKG-TIMEOUT 为什么还没有入库？",
      })
      .expect(200);

    const events = parseEvents(response.text);
    expect(
      events.filter(
        (event) => event.type === "step.retrying" && event.stepId === "putaway",
      ),
    ).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("trace.failed");
    expect(
      events.find(
        (event) => event.type === "step.completed" && event.stepId === "anomaly",
      )?.payload,
    ).toMatchObject({ status: "BLOCKED" });
  });

  it("rejects a final diagnosis that cites evidence the tools never produced", async () => {
    const { app } = createTestApp({ invalidEvidence: true });
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({
        question: "包裹 PKG-20260918 为什么还没有入库？",
      })
      .expect(200);

    const events = parseEvents(response.text);
    expect(
      events.filter(
        (event) => event.type === "step.retrying" && event.stepId === "diagnosis",
      ),
    ).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("trace.failed");
    expect(JSON.stringify(events)).not.toContain('"status":"CONFIRMED","summary"');
  });

  it("fails identify when the model returns a different package and does not call tools", async () => {
    const { app, model } = createTestApp({ identifyPackageId: "PKG-404" });
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({ question: "包裹 PKG-20260918 为什么还没有入库？" })
      .expect(200);

    const events = parseEvents(response.text);
    expect(
      events.find((event) => event.type === "step.failed" && event.stepId === "identify")?.payload,
    ).toMatchObject({ status: "ERROR" });
    expect(
      events.find((event) => event.type === "step.completed" && event.stepId === "package")?.payload,
    ).toMatchObject({ status: "BLOCKED" });
    expect(events.at(-1)?.type).toBe("trace.failed");
    expect(model.toolSelectionCalls).toBe(0);
  });
});
