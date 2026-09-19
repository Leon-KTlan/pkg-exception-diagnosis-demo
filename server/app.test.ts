import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  Diagnosis,
  Evidence,
  TraceCompletedPayload,
  TraceEvent,
  TraceFailedPayload,
} from "../shared/protocol.js";
import { createApp } from "./app.js";
import { getDemoFixture } from "./demo/fixtures/index.js";
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
  identifyCalls = 0;
  toolSelectionCalls = 0;

  constructor(
    private readonly invalidEvidence = false,
    private readonly identifyPackageId?: string,
  ) {}

  async identify(question: string): Promise<IntentResult> {
    this.identifyCalls += 1;
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
  const modelFactoryCalls = { count: 0 };
  return {
    app: createApp({
      createModel: () => {
        modelFactoryCalls.count += 1;
        return model;
      },
      tools: createWarehouseTools(),
      minimumStepMs: 0,
      demoDelayScale: 0,
    }),
    model,
    modelFactoryCalls,
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
    expect(events.find((event) => event.type === "trace.started")?.payload).toMatchObject({
      mode: "live",
      simulated: false,
    });
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
        question: "帮我看看包裹 PKG-404 为什么还没入库",
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
        question: "帮我看看包裹 PKG-TIMEOUT 为什么还没入库",
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

  it("rejects a question without a package before creating the model", async () => {
    const { app, model, modelFactoryCalls } = createTestApp();
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({ question: "为什么我的包裹还没有入库？" })
      .expect(400)
      .expect("Content-Type", /json/);

    expect(response.body).toEqual({ error: "请补充包裹号" });
    expect(modelFactoryCalls.count).toBe(0);
    expect(model.identifyCalls).toBe(0);
    expect(model.toolSelectionCalls).toBe(0);
    expect(response.text).not.toContain("trace.started");
  });

  it("rejects multiple different packages before creating the model", async () => {
    const { app, model, modelFactoryCalls } = createTestApp();
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({ question: "帮我看看 PKG-123 和 PKG-456 为什么都没入库" })
      .expect(400)
      .expect("Content-Type", /json/);

    expect(response.body).toEqual({ error: "一次只能诊断一个包裹" });
    expect(modelFactoryCalls.count).toBe(0);
    expect(model.identifyCalls).toBe(0);
    expect(model.toolSelectionCalls).toBe(0);
    expect(response.text).not.toContain("trace.started");
  });

  it("treats repeated case-insensitive package IDs as one package", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({ question: "请查看 PKG-20260918；pkg-20260918 为什么还没入库？" })
      .expect(200);

    expect(parseEvents(response.text).at(-1)?.type).toBe("trace.completed");
  });

  it("extracts a package surrounded by Chinese and English punctuation", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({ question: "请查看（pkg-20260918），为什么还没入库？" })
      .expect(200);

    expect(parseEvents(response.text).at(-1)?.type).toBe("trace.completed");
  });

  it.each([
    ["XPKG-20260918", "请补充包裹号"],
    ["PKG--20260918", "请补充包裹号"],
    ["PKG-20260918-", "请补充包裹号"],
    ["PKG-20260918_EXTRA", "请补充包裹号"],
  ])("does not extract a package fragment from %s", async (question, error) => {
    const { app, model, modelFactoryCalls } = createTestApp();
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send({ question })
      .expect(400);

    expect(response.body).toEqual({ error });
    expect(modelFactoryCalls.count).toBe(0);
    expect(model.identifyCalls).toBe(0);
    expect(model.toolSelectionCalls).toBe(0);
  });

  it.each([
    [{}, "问题必须是字符串"],
    [{ question: 123 }, "问题必须是字符串"],
    [{ question: "   " }, "问题不能为空"],
  ])("rejects invalid question input %j", async (body, error) => {
    const { app, model, modelFactoryCalls } = createTestApp();
    const response = await request(app)
      .post("/api/diagnoses/stream")
      .send(body)
      .expect(400);

    expect(response.body).toEqual({ error });
    expect(modelFactoryCalls.count).toBe(0);
    expect(model.identifyCalls).toBe(0);
    expect(model.toolSelectionCalls).toBe(0);
  });

  it("accepts exactly 500 Unicode characters and rejects 501", async () => {
    const packageId = "PKG-20260918";
    const boundaryQuestion = `${"啊".repeat(500 - Array.from(packageId).length)}${packageId}`;
    const accepted = createTestApp();
    await request(accepted.app)
      .post("/api/diagnoses/stream")
      .send({ question: boundaryQuestion })
      .expect(200);

    const rejected = createTestApp();
    const response = await request(rejected.app)
      .post("/api/diagnoses/stream")
      .send({ question: `${boundaryQuestion}啊` })
      .expect(400);

    expect(response.body).toEqual({ error: "问题长度不能超过500个Unicode字符" });
    expect(rejected.modelFactoryCalls.count).toBe(0);
    expect(rejected.model.identifyCalls).toBe(0);
    expect(rejected.model.toolSelectionCalls).toBe(0);
  });
});

describe("POST /api/demo/diagnoses/stream", () => {
  it("maps each supported package to its deterministic fixture", () => {
    expect(getDemoFixture("PKG-20260918")?.packageId).toBe("PKG-20260918");
    expect(getDemoFixture("PKG-404")?.packageId).toBe("PKG-404");
    expect(getDemoFixture("PKG-TIMEOUT")?.packageId).toBe("PKG-TIMEOUT");
    expect(getDemoFixture("PKG-12345")).toBeUndefined();
  });

  it("replays the success diagnosis without invoking Live dependencies", async () => {
    const { app, model, modelFactoryCalls } = createTestApp();
    const question = "请查看（pkg-20260918），为什么还没入库？";
    const response = await request(app)
      .post("/api/demo/diagnoses/stream")
      .send({ question })
      .expect(200)
      .expect("Content-Type", /text\/event-stream/);

    const events = parseEvents(response.text);
    const started = events.find((event) => event.type === "trace.started");
    const completed = events.at(-1);
    const completedPayload = completed?.payload as unknown as TraceCompletedPayload;

    expect(started?.payload).toMatchObject({
      mode: "demo",
      simulated: true,
      question,
      model: "固定回放",
    });
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(new Set(events.map((event) => event.traceId)).size).toBe(1);
    expect(
      events.find((event) => event.type === "step.started" && event.stepId === "identify")?.payload,
    ).toMatchObject({ input: { question } });
    expect(
      events.find((event) => event.type === "step.completed" && event.stepId === "identify")?.payload,
    ).toMatchObject({
      output: {
        packageId: "PKG-20260918",
        normalizedQuestion: question,
      },
    });
    expect(events.filter((event) => event.type === "tool.call.started")).toHaveLength(3);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(3);
    expect(completed?.type).toBe("trace.completed");
    expect(completedPayload.toolCallCount).toBe(3);
    expect(completedPayload.tokenUsage).toBeUndefined();
    expect(completedPayload.evidence).toHaveLength(4);
    expect(modelFactoryCalls.count).toBe(0);
    expect(model.identifyCalls).toBe(0);
    expect(model.toolSelectionCalls).toBe(0);
  });

  it("creates an independent trace for each success replay", async () => {
    const { app } = createTestApp();
    const body = { question: "包裹 PKG-20260918 为什么还没有入库？" };

    const first = parseEvents(
      (
        await request(app)
          .post("/api/demo/diagnoses/stream")
          .send(body)
          .expect(200)
      ).text,
    );
    const second = parseEvents(
      (
        await request(app)
          .post("/api/demo/diagnoses/stream")
          .send(body)
          .expect(200)
      ).text,
    );

    expect(first[0].traceId).not.toBe(second[0].traceId);
    expect(first.map((event) => event.type)).toEqual(second.map((event) => event.type));
    expect(first.at(-1)?.type).toBe("trace.completed");
    expect(second.at(-1)?.type).toBe("trace.completed");
  });

  it("replays PKG-404 as insufficient evidence without invoking Live dependencies", async () => {
    const { app, model, modelFactoryCalls } = createTestApp();
    const question = "帮我看看包裹 PKG-404 为什么还没入库";
    const response = await request(app)
      .post("/api/demo/diagnoses/stream")
      .send({ question })
      .expect(200)
      .expect("Content-Type", /text\/event-stream/);

    const events = parseEvents(response.text);
    const started = events.find((event) => event.type === "trace.started");
    const completed = events.at(-1);
    const completedPayload = completed?.payload as unknown as TraceCompletedPayload;

    expect(started?.payload).toMatchObject({
      mode: "demo",
      simulated: true,
      question,
      model: "固定回放",
    });
    expect(completed?.type).toBe("trace.completed");
    expect(completedPayload.diagnosis.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(completedPayload.evidence).toEqual([]);
    expect(completedPayload.diagnosis.evidenceIds).toEqual([]);
    expect(completedPayload.toolCallCount).toBe(1);
    expect(completedPayload.tokenUsage).toBeUndefined();
    expect(events.filter((event) => event.type === "tool.call.started")).toHaveLength(1);
    expect(
      events
        .filter((event) => event.type === "step.completed")
        .filter((event) => ["receipt", "putaway", "anomaly", "evidence"].includes(event.stepId ?? ""))
        .every((event) => event.payload.status === "BLOCKED"),
    ).toBe(true);
    expect(modelFactoryCalls.count).toBe(0);
    expect(model.identifyCalls).toBe(0);
    expect(model.toolSelectionCalls).toBe(0);
  });

  it("replays PKG-TIMEOUT through retry and trace.failed without invoking Live dependencies", async () => {
    const { app, model, modelFactoryCalls } = createTestApp();
    const response = await request(app)
      .post("/api/demo/diagnoses/stream")
      .send({ question: "帮我看看包裹 PKG-TIMEOUT 为什么还没入库" })
      .expect(200)
      .expect("Content-Type", /text\/event-stream/);

    const events = parseEvents(response.text);
    const failed = events.at(-1);
    const failedPayload = failed?.payload as unknown as TraceFailedPayload;

    expect(failed?.type).toBe("trace.failed");
    expect(failedPayload.error).toBe("get_putaway_task 查询超时");
    expect(failedPayload.terminationReason).toBe("TOOL_TIMEOUT");
    expect(failedPayload.toolCallCount).toBe(4);
    expect(events.filter((event) => event.type === "step.retrying")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool.call.started")).toHaveLength(4);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(2);
    expect(
      events.find((event) => event.type === "step.failed" && event.stepId === "putaway")?.payload,
    ).toMatchObject({ status: "ERROR", error: "get_putaway_task 查询超时" });
    expect(
      events
        .filter((event) => event.type === "step.completed")
        .filter((event) => ["anomaly", "evidence", "diagnosis"].includes(event.stepId ?? ""))
        .every((event) => event.payload.status === "BLOCKED"),
    ).toBe(true);
    expect(events.find((event) => event.type === "trace.started")?.payload).toMatchObject({
      mode: "demo",
      simulated: true,
    });
    expect(JSON.stringify(events)).not.toContain("tokenUsage");
    expect(modelFactoryCalls.count).toBe(0);
    expect(model.identifyCalls).toBe(0);
    expect(model.toolSelectionCalls).toBe(0);
  });

  it("rejects a valid but unsupported package before opening SSE", async () => {
    const { app, model, modelFactoryCalls } = createTestApp();
    const response = await request(app)
      .post("/api/demo/diagnoses/stream")
      .send({ question: "帮我看看包裹 PKG-12345 为什么还没入库" })
      .expect(400)
      .expect("Content-Type", /json/);

    expect(response.body).toEqual({ error: "该包裹号暂不支持演示模式" });
    expect(response.text).not.toContain("trace.started");
    expect(modelFactoryCalls.count).toBe(0);
    expect(model.identifyCalls).toBe(0);
    expect(model.toolSelectionCalls).toBe(0);
  });
});
