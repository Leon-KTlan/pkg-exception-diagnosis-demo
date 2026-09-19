import {
  STEP_DEFINITIONS,
  type Diagnosis,
  type Evidence,
  type StepId,
  type StepPayload,
  type StepView,
  type TraceCompletedPayload,
  type TraceEvent,
  type TraceFailedPayload,
  type TraceStartedPayload,
  type TraceMode,
  type TraceStatus,
} from "../shared/protocol";

export interface TraceState {
  traceId?: string;
  mode?: TraceMode;
  simulated?: boolean;
  question?: string;
  model?: string;
  status: TraceStatus;
  steps: StepView[];
  activeStepId: StepId;
  evidence: Evidence[];
  diagnosis?: Diagnosis;
  error?: string;
  totalDurationMs?: number;
  toolCallCount: number;
  tokenUsage?: number;
  lastSequence: number;
}

export type TraceAction =
  | { type: "reset" }
  | { type: "event"; event: TraceEvent };

export const createInitialTraceState = (): TraceState => ({
  status: "IDLE",
  steps: STEP_DEFINITIONS.map((step) => ({ ...step, status: "PENDING" })),
  activeStepId: "identify",
  evidence: [],
  toolCallCount: 0,
  lastSequence: 0,
});

const updateStep = (
  state: TraceState,
  stepId: StepId,
  payload: StepPayload,
) => ({
  ...state,
  steps: state.steps.map((step) =>
    step.id === stepId
      ? {
          ...step,
          ...payload,
          kind: payload.kind ?? step.kind,
          toolName: payload.toolName ?? step.toolName,
          status: payload.status ?? step.status,
        }
      : step,
  ),
  activeStepId: stepId,
});

export const traceReducer = (
  state: TraceState,
  action: TraceAction,
): TraceState => {
  if (action.type === "reset") {
    return createInitialTraceState();
  }

  const { event } = action;
  if (state.traceId && event.traceId !== state.traceId) {
    return state;
  }
  if (!state.traceId && event.type !== "trace.started") {
    return state;
  }
  if (event.sequence <= state.lastSequence) {
    return state;
  }

  let nextState = { ...state, lastSequence: event.sequence };
  switch (event.type) {
    case "trace.started": {
      const payload = event.payload as unknown as TraceStartedPayload;
      if (
        (payload.mode !== "demo" && payload.mode !== "live") ||
        typeof payload.simulated !== "boolean" ||
        (payload.mode === "demo") !== payload.simulated
      ) {
        return state;
      }
      return {
        ...nextState,
        traceId: event.traceId,
        mode: payload.mode,
        simulated: payload.simulated,
        question: payload.question,
        model: payload.model,
        status: "RUNNING",
        error: undefined,
        steps: payload.steps.map((step) => ({ ...step, status: "PENDING" })),
      };
    }
    case "step.started":
    case "tool.call.completed":
    case "step.completed":
    case "step.retrying":
    case "step.failed": {
      if (!event.stepId) return nextState;
      const payload = event.payload as StepPayload;
      const updated = updateStep(nextState, event.stepId, payload);
      if (
        event.type === "step.completed" &&
        event.stepId === "evidence" &&
        Array.isArray(payload.output)
      ) {
        return { ...updated, evidence: payload.output as Evidence[] };
      }
      return updated;
    }
    case "tool.call.started": {
      if (!event.stepId) return nextState;
      nextState = {
        ...nextState,
        toolCallCount: nextState.toolCallCount + 1,
      };
      return updateStep(nextState, event.stepId, event.payload as StepPayload);
    }
    case "trace.completed": {
      const payload = event.payload as unknown as TraceCompletedPayload;
      return {
        ...nextState,
        status: "COMPLETED",
        diagnosis: payload.diagnosis,
        evidence: payload.evidence,
        totalDurationMs: payload.totalDurationMs,
        toolCallCount: payload.toolCallCount,
        tokenUsage: payload.tokenUsage,
        activeStepId: "diagnosis",
      };
    }
    case "trace.failed": {
      const payload = event.payload as unknown as TraceFailedPayload;
      return {
        ...nextState,
        status: "FAILED",
        error: payload.error,
        totalDurationMs: payload.totalDurationMs,
        toolCallCount: payload.toolCallCount,
      };
    }
    default:
      return nextState;
  }
};
