import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraceEvent } from "../shared/protocol";
import { streamDiagnosis } from "./api";

const completedEvent: TraceEvent = {
  traceId: "tr_test",
  sequence: 1,
  timestamp: "2026-09-19T00:00:00.000Z",
  type: "trace.completed",
  payload: {},
};

const responseFor = (events: TraceEvent[]) =>
  new Response(
    events
      .map(
        (event) =>
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamDiagnosis", () => {
  it("sends only the natural-language question", async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor([completedEvent]));
    vi.stubGlobal("fetch", fetchMock);

    await streamDiagnosis({
      question: "帮我看看包裹 PKG-20260918 为什么还没入库",
      onEvent: vi.fn(),
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      question: "帮我看看包裹 PKG-20260918 为什么还没入库",
    });
  });

  it("uses the Demo endpoint without changing the request contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor([completedEvent]));
    vi.stubGlobal("fetch", fetchMock);

    await streamDiagnosis({
      mode: "demo",
      question: "帮我看看包裹 PKG-20260918 为什么还没入库",
      onEvent: vi.fn(),
    });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/demo/diagnoses/stream");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      question: "帮我看看包裹 PKG-20260918 为什么还没入库",
    });
  });

  it("uses Live by default for existing callers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor([completedEvent]));
    vi.stubGlobal("fetch", fetchMock);

    await streamDiagnosis({
      question: "帮我看看包裹 PKG-20260918 为什么还没入库",
      onEvent: vi.fn(),
    });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/diagnoses/stream");
  });

  it("rejects EOF without a terminal event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        "event: trace.started\ndata: {\"traceId\":\"tr_test\",\"sequence\":1,\"type\":\"trace.started\",\"payload\":{}}\n\n",
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamDiagnosis({ question: "包裹 PKG-20260918 为什么还没有入库？", onEvent: vi.fn() }),
    ).rejects.toMatchObject({ reason: "STREAM_DISCONNECTED" });
  });

  it("aborts a stalled stream after the inactivity timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new ReadableStream(), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = streamDiagnosis({
      question: "包裹 PKG-20260918 为什么还没有入库？",
      onEvent: vi.fn(),
      inactivityTimeoutMs: 10,
      overallTimeoutMs: 100,
    });
    const assertion = expect(promise).rejects.toMatchObject({
      reason: "CLIENT_INACTIVITY_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(11);

    await assertion;
    vi.useRealTimers();
  });

  it("aborts a continuously open stream at the overall timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new ReadableStream(), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = streamDiagnosis({
      question: "包裹 PKG-20260918 为什么还没有入库？",
      onEvent: vi.fn(),
      inactivityTimeoutMs: 100,
      overallTimeoutMs: 10,
    });
    const assertion = expect(promise).rejects.toMatchObject({
      reason: "CLIENT_OVERALL_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(11);

    await assertion;
    vi.useRealTimers();
  });

  it("stops reading after the caller aborts", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new ReadableStream(), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = streamDiagnosis({
      question: "包裹 PKG-20260918 为什么还没有入库？",
      signal: controller.signal,
      onEvent: vi.fn(),
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeDefined();
  });
});
