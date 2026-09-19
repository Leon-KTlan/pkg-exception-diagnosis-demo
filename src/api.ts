import type { TerminationReason, TraceEvent, TraceMode } from "../shared/protocol";

export type DiagnosisMode = TraceMode;

export const CLIENT_INACTIVITY_TIMEOUT_MS = 30_000;
export const CLIENT_OVERALL_TIMEOUT_MS = 120_000;

export type StreamFailureReason =
  | "STREAM_DISCONNECTED"
  | "CLIENT_INACTIVITY_TIMEOUT"
  | "CLIENT_OVERALL_TIMEOUT";

export class StreamDiagnosisError extends Error {
  readonly reason: StreamFailureReason;

  constructor(reason: StreamFailureReason, message: string) {
    super(message);
    this.name = "StreamDiagnosisError";
    this.reason = reason;
  }
}

interface StreamDiagnosisOptions {
  mode?: DiagnosisMode;
  question: string;
  signal?: AbortSignal;
  onEvent: (event: TraceEvent) => void;
  inactivityTimeoutMs?: number;
  overallTimeoutMs?: number;
}

const terminalEventTypes = new Set<TraceEvent["type"]>([
  "trace.completed",
  "trace.failed",
  "trace.cancelled",
]);

export const getDiagnosisEndpoint = (mode: DiagnosisMode) =>
  mode === "demo" ? "/api/demo/diagnoses/stream" : "/api/diagnoses/stream";

const parseError = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `请求失败 (${response.status})`;
  } catch {
    return `请求失败 (${response.status})`;
  }
};

class RequestSetupError extends Error {}

export const streamDiagnosis = async ({
  mode = "live",
  question,
  signal,
  onEvent,
  inactivityTimeoutMs = CLIENT_INACTIVITY_TIMEOUT_MS,
  overallTimeoutMs = CLIENT_OVERALL_TIMEOUT_MS,
}: StreamDiagnosisOptions) => {
  const requestController = new AbortController();
  let timeoutReason: StreamFailureReason | undefined;
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelReader: (() => void) | undefined;
  let sawAnyEvent = false;
  let sawTerminalEvent = false;

  const abortFor = (reason: StreamFailureReason) => {
    if (requestController.signal.aborted) return;
    timeoutReason = reason;
    requestController.abort(new Error(reason));
  };
  const resetInactivityTimer = () => {
    if (inactivityTimer !== undefined) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(
      () => abortFor("CLIENT_INACTIVITY_TIMEOUT"),
      inactivityTimeoutMs,
    );
  };
  const abortFromCaller = () => {
    requestController.abort(signal?.reason);
  };

  signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();
  overallTimer = setTimeout(
    () => abortFor("CLIENT_OVERALL_TIMEOUT"),
    overallTimeoutMs,
  );
  resetInactivityTimer();

  try {
    let response: Response;
    try {
      response = await fetch(getDiagnosisEndpoint(mode), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: requestController.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeoutReason) {
        throw new StreamDiagnosisError(
          timeoutReason,
          timeoutReason === "CLIENT_OVERALL_TIMEOUT"
            ? "诊断请求超过最大运行时间"
            : "诊断连接长时间没有事件",
        );
      }
      throw new StreamDiagnosisError("STREAM_DISCONNECTED", "无法连接诊断服务");
    }

    if (!response.ok) {
      throw new RequestSetupError(await parseError(response));
    }
    if (!response.body) {
      throw new RequestSetupError("浏览器不支持流式响应");
    }

    reader = response.body.getReader();
    const streamReader = reader;
    cancelReader = () => {
      void reader?.cancel();
    };
    requestController.signal.addEventListener("abort", cancelReader, { once: true });
    const decoder = new TextDecoder();
    let buffer = "";

    const readChunk = async () => {
      if (requestController.signal.aborted) {
        throw requestController.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
      }
      let onAbort: (() => void) | undefined;
      const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => {
          reject(
            requestController.signal.reason ??
              new DOMException("The operation was aborted", "AbortError"),
          );
        };
        requestController.signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        return await Promise.race([streamReader.read(), abortPromise]);
      } finally {
        if (onAbort) requestController.signal.removeEventListener("abort", onAbort);
      }
    };

    const flushFrame = (frame: string) => {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) return;
      const event = JSON.parse(data) as TraceEvent;
      sawAnyEvent = true;
      resetInactivityTimer();
      onEvent(event);
      if (terminalEventTypes.has(event.type)) {
        sawTerminalEvent = true;
      }
    };

    while (!sawTerminalEvent) {
      const { done, value } = await readChunk();
      buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        flushFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        if (sawTerminalEvent) break;
      }
      if (done) break;
    }

    requestController.signal.removeEventListener("abort", cancelReader);
    cancelReader = undefined;
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }

    if (!sawTerminalEvent && buffer.trim()) {
      flushFrame(buffer);
    }
    if (!sawTerminalEvent) {
      throw new StreamDiagnosisError(
        timeoutReason ?? "STREAM_DISCONNECTED",
        timeoutReason === "CLIENT_OVERALL_TIMEOUT"
          ? "诊断请求超过最大运行时间"
          : timeoutReason === "CLIENT_INACTIVITY_TIMEOUT"
            ? "诊断连接长时间没有事件"
            : "连接意外中断，诊断未完成",
      );
    }
  } catch (error) {
    if (error instanceof RequestSetupError || error instanceof StreamDiagnosisError) {
      throw error;
    }
    if (signal?.aborted) throw error;
    if (timeoutReason) {
      throw new StreamDiagnosisError(
        timeoutReason,
        timeoutReason === "CLIENT_OVERALL_TIMEOUT"
          ? "诊断请求超过最大运行时间"
          : "诊断连接长时间没有事件",
      );
    }
    throw new StreamDiagnosisError(
      "STREAM_DISCONNECTED",
      sawAnyEvent ? "连接意外中断，诊断未完成" : "无法连接诊断服务",
    );
  } finally {
    if (inactivityTimer !== undefined) clearTimeout(inactivityTimer);
    if (overallTimer !== undefined) clearTimeout(overallTimer);
    signal?.removeEventListener("abort", abortFromCaller);
    if (cancelReader) {
      requestController.signal.removeEventListener("abort", cancelReader);
    }
    await reader?.cancel().catch(() => undefined);
  }
};

export const toTraceFailureReason = (
  error: StreamDiagnosisError,
): Exclude<TerminationReason, "USER_CANCELLED"> => error.reason;
