import { describe, expect, it } from "vitest";
import { STEP_DEFINITIONS, type TraceEvent } from "../shared/protocol";
import { createInitialTraceState, traceReducer } from "./state";

const event = (
  sequence: number,
  type: TraceEvent["type"],
  payload: Record<string, unknown>,
  stepId?: TraceEvent["stepId"],
): TraceEvent => ({
  traceId: "tr_test",
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
    const blocked = traceReducer(createInitialTraceState(), {
      type: "event",
      event: event(
        3,
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
});
