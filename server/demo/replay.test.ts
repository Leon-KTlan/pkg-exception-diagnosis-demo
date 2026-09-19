import { describe, expect, it, vi } from "vitest";
import type { TraceEvent } from "../../shared/protocol.js";
import { insufficientEvidenceFixture } from "./fixtures/insufficient-evidence.js";
import { successFixture } from "./fixtures/success.js";
import { timeoutFixture } from "./fixtures/timeout.js";
import { replayDemo } from "./replay.js";

const question = "包裹 PKG-20260918 为什么还没有入库？";

describe("replayDemo", () => {
  it("emits a valid ordered event stream with runtime trace metadata", async () => {
    const events: TraceEvent[] = [];

    await replayDemo({
      fixture: successFixture,
      question,
      packageId: "PKG-20260918",
      delayScale: 0,
      emit: (event) => events.push(event),
    });

    expect(events.length).toBeGreaterThan(1);
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(new Set(events.map((event) => event.traceId)).size).toBe(1);
    expect(events.every((event) => /^tr_demo_[a-f0-9]{12}$/.test(event.traceId))).toBe(true);
    expect(events.every((event) => !Number.isNaN(Date.parse(event.timestamp)))).toBe(true);
    expect(events.at(-1)?.type).toBe("trace.completed");
  });

  it("stops before the next event when its signal is aborted during a delay", async () => {
    const controller = new AbortController();
    const events: TraceEvent[] = [];
    const sleep = vi.fn(async () => {
      controller.abort();
    });

    await replayDemo({
      fixture: successFixture,
      question,
      packageId: "PKG-20260918",
      emit: (event) => events.push(event),
      sleep,
      signal: controller.signal,
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("trace.started");
    expect(sleep).toHaveBeenCalled();
  });

  it.each([
    [insufficientEvidenceFixture, "trace.completed"],
    [timeoutFixture, "trace.failed"],
  ] as const)("replays %s with a valid deterministic protocol stream", async (fixture, terminalType) => {
    const events: TraceEvent[] = [];

    await replayDemo({
      fixture,
      question: `包裹 ${fixture.packageId} 为什么还没有入库？`,
      packageId: fixture.packageId,
      delayScale: 0,
      emit: (event) => events.push(event),
    });

    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(new Set(events.map((event) => event.traceId)).size).toBe(1);
    expect(events.every((event) => /^tr_demo_[a-f0-9]{12}$/.test(event.traceId))).toBe(true);
    expect(events.every((event) => !Number.isNaN(Date.parse(event.timestamp)))).toBe(true);
    expect(events.find((event) => event.type === "trace.started")?.payload).toMatchObject({
      mode: "demo",
      simulated: true,
    });
    expect(events.at(-1)?.type).toBe(terminalType);
    expect(JSON.stringify(events)).not.toContain("tokenUsage");
  });
});
