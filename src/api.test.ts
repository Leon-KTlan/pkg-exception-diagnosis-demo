import { afterEach, describe, expect, it, vi } from "vitest";
import { streamDiagnosis } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamDiagnosis", () => {
  it("sends only the natural-language question", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
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
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
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
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await streamDiagnosis({
      question: "帮我看看包裹 PKG-20260918 为什么还没入库",
      onEvent: vi.fn(),
    });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/diagnoses/stream");
  });
});
