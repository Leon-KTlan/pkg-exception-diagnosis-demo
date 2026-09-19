import type { TraceEvent, TraceMode } from "../shared/protocol";

export type DiagnosisMode = TraceMode;

interface StreamDiagnosisOptions {
  mode?: DiagnosisMode;
  question: string;
  signal?: AbortSignal;
  onEvent: (event: TraceEvent) => void;
}

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

export const streamDiagnosis = async ({
  mode = "live",
  question,
  signal,
  onEvent,
}: StreamDiagnosisOptions) => {
  const response = await fetch(getDiagnosisEndpoint(mode), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  if (!response.body) {
    throw new Error("浏览器不支持流式响应");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flushFrame = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    onEvent(JSON.parse(data) as TraceEvent);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      flushFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) {
    flushFrame(buffer);
  }
};
