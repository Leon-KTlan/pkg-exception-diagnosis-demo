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
});
