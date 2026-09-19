import type { Request, Response } from "express";
import type { TraceEvent } from "../shared/protocol.js";
import { ClientDisconnectedError } from "./abort.js";

export const prepareSseResponse = (response: Response) => {
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
};

export const createSseSender = (response: Response) => (event: TraceEvent) => {
  if (response.destroyed || response.writableEnded) {
    throw new ClientDisconnectedError();
  }
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
};

export const createDisconnectController = (request: Request, response: Response) => {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted && !response.writableEnded) {
      controller.abort(new ClientDisconnectedError());
    }
  };

  request.on("aborted", abort);
  response.on("close", abort);

  return {
    signal: controller.signal,
    cleanup: () => {
      request.off("aborted", abort);
      response.off("close", abort);
    },
  };
};

export const finishSseResponse = (response: Response) => {
  if (!response.writableEnded) {
    response.end();
  }
};
