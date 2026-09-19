import type { Response } from "express";
import type { TraceEvent } from "../shared/protocol.js";

export const prepareSseResponse = (response: Response) => {
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
};

export const createSseSender = (response: Response) => (event: TraceEvent) => {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
};

export const finishSseResponse = (response: Response) => {
  if (!response.writableEnded) {
    response.end();
  }
};
