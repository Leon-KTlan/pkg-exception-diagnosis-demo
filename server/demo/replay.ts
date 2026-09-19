import { randomUUID } from "node:crypto";
import type {
  StepId,
  TraceEvent,
  TraceEventType,
} from "../../shared/protocol.js";

export interface DemoReplayContext {
  question: string;
  packageId: string;
}

export interface DemoFixtureEvent {
  type: TraceEventType;
  stepId?: StepId;
  delayMs: number;
  payload: (context: DemoReplayContext) => Record<string, unknown>;
}

export interface DemoFixture {
  packageId: string;
  events: readonly DemoFixtureEvent[];
}

export interface ReplayDemoOptions {
  fixture: DemoFixture;
  question: string;
  packageId: string;
  emit: (event: TraceEvent) => void | Promise<void>;
  signal?: AbortSignal;
  delayScale?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const createTraceId = () =>
  `tr_demo_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

export const replayDemo = async ({
  fixture,
  question,
  packageId,
  emit,
  signal,
  delayScale = 1,
  sleep: wait = sleep,
}: ReplayDemoOptions) => {
  if (fixture.packageId !== packageId) {
    throw new Error(`Demo fixture packageId 不匹配：${packageId}`);
  }

  const traceId = createTraceId();
  let sequence = 0;
  const context = { question, packageId };

  for (const fixtureEvent of fixture.events) {
    if (signal?.aborted) {
      return { traceId, emittedEvents: sequence };
    }

    const delayMs = Math.max(0, Math.round(fixtureEvent.delayMs * delayScale));
    if (delayMs > 0) {
      await wait(delayMs);
    }
    if (signal?.aborted) {
      return { traceId, emittedEvents: sequence };
    }

    sequence += 1;
    await emit({
      traceId,
      sequence,
      timestamp: new Date().toISOString(),
      stepId: fixtureEvent.stepId,
      type: fixtureEvent.type,
      payload: fixtureEvent.payload(context),
    });
  }

  return { traceId, emittedEvents: sequence };
};
