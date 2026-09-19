import { describe, expect, it } from "vitest";
import { STEP_DEFINITIONS, type TraceEvent } from "../shared/protocol";
import { createInitialTraceState, traceReducer } from "./state";

const event = (
  sequence: number,
  type: TraceEvent["type"],
  payload: Record<string, unknown>,
  stepId?: TraceEvent["stepId"],
  traceId = "tr_test",
): TraceEvent => ({
  traceId,
  sequence,
  timestamp: "2026-09-18T10:00:00.000Z",
  type,
  stepId,
  payload,
});

describe("traceReducer", () => {
  it("ignores duplicate or stale SSE events", () => {
    const started = traceReducer(createInitialTraceState(), {
      type: "event",
      event: event(1, "trace.started", {
        mode: "live",
        simulated: false,
        question: "包裹 PKG-20260918 为什么还没有入库？",
        model: "fake-deepseek",
        steps: STEP_DEFINITIONS,
      }),
    });
    const toolStarted = traceReducer(started, {
      type: "event",
      event: event(
        2,
        "tool.call.started",
        { status: "RUNNING", input: { packageId: "PKG-20260918" } },
        "package",
      ),
    });
    const duplicated = traceReducer(toolStarted, {
      type: "event",
      event: event(
        2,
        "tool.call.started",
        { status: "RUNNING", input: { packageId: "PKG-20260918" } },
        "package",
      ),
    });

    expect(duplicated).toBe(toolStarted);
    expect(duplicated.toolCallCount).toBe(1);
  });

  it("preserves blocked steps as a visible business state", () => {
    const started = traceReducer(createInitialTraceState(), {
      type: "event",
      event: event(1, "trace.started", {
        mode: "live",
        simulated: false,
        question: "包裹 PKG-404 为什么还没有入库？",
        model: "fake-deepseek",
        steps: STEP_DEFINITIONS,
      }),
    });
    const blocked = traceReducer(started, {
      type: "event",
      event: event(
        2,
        "step.completed",
        { status: "BLOCKED", error: "未找到包裹" },
        "receipt",
      ),
    });

    expect(blocked.steps.find((step) => step.id === "receipt")).toMatchObject({
      status: "BLOCKED",
      error: "未找到包裹",
    });
  });

  it("stores trace metadata from the initialization event", () => {
    const state = traceReducer(createInitialTraceState(), {
      type: "event",
      event: event(1, "trace.started", {
        mode: "demo",
        simulated: true,
        question: "包裹 PKG-20260918 为什么还没有入库？",
        model: "固定回放",
        steps: STEP_DEFINITIONS,
      }),
    });

    expect(state).toMatchObject({
      traceId: "tr_test",
      mode: "demo",
      simulated: true,
      model: "固定回放",
    });
  });

  it("ignores events from a different trace after binding the current trace", () => {
    const started = traceReducer(createInitialTraceState(), {
      type: "event",
      event: event(1, "trace.started", {
        mode: "live",
        simulated: false,
        question: "包裹 PKG-20260918 为什么还没有入库？",
        model: "fake-deepseek",
        steps: STEP_DEFINITIONS,
      }),
    });
    const foreign = traceReducer(started, {
      type: "event",
      event: event(
        2,
        "step.completed",
        { status: "SUCCESS", output: { packageId: "PKG-FOREIGN" } },
        "package",
        "tr_foreign",
      ),
    });

    expect(foreign).toBe(started);
  });

  it("does not reinsert a late event after reset", () => {
    const started = traceReducer(createInitialTraceState(), {
      type: "event",
      event: event(1, "trace.started", {
        mode: "demo",
        simulated: true,
        question: "包裹 PKG-20260918 为什么还没有入库？",
        model: "固定回放",
        steps: STEP_DEFINITIONS,
      }),
    });
    const reset = traceReducer(started, { type: "reset" });
    const late = traceReducer(reset, {
      type: "event",
      event: event(2, "step.completed", { status: "SUCCESS" }, "package"),
    });

    expect(late).toBe(reset);
    expect(late.traceId).toBeUndefined();
  });

  it("converges an active run to CANCELLED and cancels incomplete steps", () => {
    const started = traceReducer(createInitialTraceState(), {
      type: "begin",
      mode: "demo",
      question: "包裹 PKG-20260918 为什么还没有入库？",
    });
    const running = traceReducer(started, {
      type: "event",
      event: event(
        1,
        "trace.started",
        {
          mode: "demo",
          simulated: true,
          question: "包裹 PKG-20260918 为什么还没有入库？",
          model: "固定回放",
          steps: STEP_DEFINITIONS,
        },
      ),
    });
    const active = traceReducer(running, {
      type: "event",
      event: event(2, "step.started", { status: "RUNNING" }, "package"),
    });
    const cancelled = traceReducer(active, {
      type: "terminate",
      status: "CANCELLED",
      error: "已取消诊断",
      terminationReason: "USER_CANCELLED",
    });

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.steps.every((step) =>
      ["SUCCESS", "ERROR", "BLOCKED", "CANCELLED"].includes(step.status),
    )).toBe(true);
    expect(cancelled.steps.find((step) => step.id === "package")?.status).toBe("CANCELLED");
  });

  it("rejects late events after a terminal failure", () => {
    const started = traceReducer(createInitialTraceState(), {
      type: "event",
      event: event(1, "trace.started", {
        mode: "live",
        simulated: false,
        question: "包裹 PKG-20260918 为什么还没有入库？",
        model: "fake-deepseek",
        steps: STEP_DEFINITIONS,
      }),
    });
    const failed = traceReducer(started, {
      type: "event",
      event: event(2, "trace.failed", {
        error: "连接意外中断",
        terminationReason: "STREAM_DISCONNECTED",
        totalDurationMs: 100,
        toolCallCount: 1,
      }),
    });
    const late = traceReducer(failed, {
      type: "event",
      event: event(3, "step.started", { status: "RUNNING" }, "diagnosis"),
    });

    expect(late).toBe(failed);
    expect(late.status).toBe("FAILED");
  });
  it("selects the failed tool instead of its blocked dependents", () => {
    let state = traceReducer(createInitialTraceState(), {
      type: "event",
      event: event(1, "trace.started", {
        mode: "demo", simulated: true, question: "PKG-TIMEOUT",
        model: "固定回放", steps: STEP_DEFINITIONS,
      }),
    });
    state = traceReducer(state, {
      type: "event",
      event: event(2, "step.failed", { status: "ERROR", attempt: 2 }, "putaway"),
    });
    state = traceReducer(state, {
      type: "event",
      event: event(3, "step.completed", { status: "BLOCKED" }, "diagnosis"),
    });
    state = traceReducer(state, {
      type: "event",
      event: event(4, "trace.failed", {
        error: "get_putaway_task 查询超时", terminationReason: "TOOL_TIMEOUT",
        totalDurationMs: 100, toolCallCount: 4,
      }),
    });
    expect(state.activeStepId).toBe("putaway");
    expect(state.steps.find((step) => step.id === "putaway")?.attempt).toBe(2);
  });

  it("retains received work and ignores late completion after cancellation", () => {
    const started = traceReducer(createInitialTraceState(), {
      type: "event",
      event: event(1, "trace.started", {
        mode: "live", simulated: false, question: "PKG-20260918",
        model: "fake-model", steps: STEP_DEFINITIONS,
      }),
    });
    const received = traceReducer(started, {
      type: "event",
      event: event(2, "step.completed", { status: "SUCCESS", output: { packageId: "PKG-20260918" } }, "identify"),
    });
    const cancelled = traceReducer(received, {
      type: "terminate", status: "CANCELLED", error: "已取消",
      terminationReason: "USER_CANCELLED",
    });
    const late = traceReducer(cancelled, {
      type: "event", event: event(3, "step.started", { status: "RUNNING" }, "package"),
    });
    expect(late).toBe(cancelled);
    expect(late.steps[0]).toMatchObject({ status: "SUCCESS", output: { packageId: "PKG-20260918" } });
  });

});
