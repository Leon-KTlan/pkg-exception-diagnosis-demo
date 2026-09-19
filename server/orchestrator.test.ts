import { describe, expect, it } from "vitest";
import type { TraceEvent } from "../shared/protocol.js";
import { ClientDisconnectedError } from "./abort.js";
import type { ModelGateway } from "./model.js";
import { runDiagnosis } from "./orchestrator.js";
import type { ToolRegistry } from "./tools.js";

const baseModel = (overrides: Partial<ModelGateway> = {}): ModelGateway => ({
  modelName: "fake-deepseek",
  tokenUsage: 0,
  identify: async (question) => ({
    packageId: "PKG-20260918",
    intent: "WAREHOUSE_INBOUND_DIAGNOSIS",
    normalizedQuestion: question,
  }),
  selectTool: async (_context, eligibleTools) => ({
    name: eligibleTools[0].name,
    arguments: { packageId: "PKG-20260918" },
  }),
  detectAnomaly: async () => ({
    found: true,
    reasonCode: "TEST",
    reason: "测试异常",
    severity: "LOW",
  }),
  composeDiagnosis: async () => ({
    status: "INSUFFICIENT_EVIDENCE",
    summary: "测试诊断",
    reason: "测试原因",
    severity: "LOW",
    evidenceIds: [],
    actions: [],
    limitations: [],
  }),
  ...overrides,
});

const question = "包裹 PKG-20260918 为什么还没有入库？";

describe("runDiagnosis cancellation and deadlines", () => {
  it("stops downstream work when the client aborts", async () => {
    const controller = new AbortController();
    let observedAbort = false;
    const model = baseModel({
      identify: async (_question, _packageId, signal) =>
        new Promise((_, reject) => {
          const abort = () => {
            observedAbort = true;
            reject(signal?.reason);
          };
          if (signal?.aborted) {
            abort();
            return;
          }
          signal?.addEventListener("abort", abort, { once: true });
        }),
    });
    const events: TraceEvent[] = [];
    const run = runDiagnosis({
      question,
      packageId: "PKG-20260918",
      model,
      tools: {},
      emit: (event) => events.push(event),
      minimumStepMs: 0,
      signal: controller.signal,
      diagnosisTimeoutMs: 1000,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(new ClientDisconnectedError());
    const result = await run;

    expect(result.cancelled).toBe(true);
    expect(observedAbort).toBe(true);
    expect(events.at(-1)?.type).not.toBe("trace.failed");
    expect(events.some((event) => event.type === "trace.completed")).toBe(false);
  });

  it("fails with a diagnosis timeout and does not hang", async () => {
    const model = baseModel({
      identify: async () => new Promise(() => undefined),
    });
    const events: TraceEvent[] = [];

    await runDiagnosis({
      question,
      packageId: "PKG-20260918",
      model,
      tools: {},
      emit: (event) => events.push(event),
      minimumStepMs: 0,
      diagnosisTimeoutMs: 5,
    });

    expect(events.at(-1)?.type).toBe("trace.failed");
    expect(events.at(-1)?.payload).toMatchObject({
      terminationReason: "DIAGNOSIS_TIMEOUT",
    });
  });

  it("times out an uncooperative tool and preserves one retry", async () => {
    let calls = 0;
    const tools: ToolRegistry = {
      get_package: {
        name: "get_package",
        description: "测试工具",
        parameters: { type: "object" },
        execute: async (_args, _context) => {
          calls += 1;
          return new Promise<null>(() => undefined);
        },
      },
    };
    const events: TraceEvent[] = [];

    await runDiagnosis({
      question,
      packageId: "PKG-20260918",
      model: baseModel(),
      tools,
      emit: (event) => events.push(event),
      minimumStepMs: 0,
      toolTimeoutMs: 5,
      diagnosisTimeoutMs: 1000,
    });

    expect(calls).toBe(2);
    expect(events.filter((event) => event.type === "step.retrying")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("trace.failed");
    expect(events.at(-1)?.payload).toMatchObject({ terminationReason: "TOOL_TIMEOUT" });
  });
});
