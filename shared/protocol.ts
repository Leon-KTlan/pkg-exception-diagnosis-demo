export type StepId =
  | "identify"
  | "package"
  | "receipt"
  | "putaway"
  | "anomaly"
  | "evidence"
  | "diagnosis";

export type StepKind = "AGENT_NODE" | "TOOL_CALL";

export type StepStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "ERROR"
  | "RETRYING"
  | "BLOCKED";

export type TraceStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";

export type TraceMode = "live" | "demo";

export interface StepDefinition {
  id: StepId;
  title: string;
  description: string;
  kind: StepKind;
  toolName: string;
}

export interface StepView extends StepDefinition {
  status: StepStatus;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  attempt?: number;
  error?: string;
}

export interface Evidence {
  evidenceId: string;
  sourceStepId: StepId;
  title: string;
  fact: string;
  sourceField: string;
  rawValue: unknown;
}

export type Severity = "LOW" | "MEDIUM" | "HIGH";
export type DiagnosisStatus = "CONFIRMED" | "INSUFFICIENT_EVIDENCE";

export interface SuggestedAction {
  title: string;
  description: string;
  priority: "P0" | "P1" | "P2";
  owner: string;
}

export interface Diagnosis {
  status: DiagnosisStatus;
  summary: string;
  reason: string;
  severity: Severity;
  evidenceIds: string[];
  actions: SuggestedAction[];
  limitations: string[];
}

export type TraceEventType =
  | "trace.started"
  | "step.started"
  | "tool.call.started"
  | "tool.call.completed"
  | "step.completed"
  | "step.retrying"
  | "step.failed"
  | "trace.completed"
  | "trace.failed";

export interface TraceEvent<T = Record<string, unknown>> {
  traceId: string;
  sequence: number;
  timestamp: string;
  stepId?: StepId;
  type: TraceEventType;
  payload: T;
}

export interface TraceStartedPayload {
  mode: TraceMode;
  simulated: boolean;
  question: string;
  model: string;
  steps: StepDefinition[];
}

export interface StepPayload {
  status?: StepStatus;
  kind?: StepKind;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  attempt?: number;
  error?: string;
}

export interface TraceCompletedPayload {
  diagnosis: Diagnosis;
  evidence: Evidence[];
  totalDurationMs: number;
  toolCallCount: number;
  tokenUsage?: number;
}

export interface TraceFailedPayload {
  error: string;
  totalDurationMs: number;
  toolCallCount: number;
}

export const STEP_DEFINITIONS: StepDefinition[] = [
  {
    id: "identify",
    title: "识别问题",
    description: "解析包裹号并识别诊断意图",
    kind: "AGENT_NODE",
    toolName: "intent_router",
  },
  {
    id: "package",
    title: "查询包裹",
    description: "获取包裹到仓状态与关联收货单",
    kind: "TOOL_CALL",
    toolName: "get_package",
  },
  {
    id: "receipt",
    title: "查询收货单",
    description: "核对收货结果与关联入库任务",
    kind: "TOOL_CALL",
    toolName: "get_receipt",
  },
  {
    id: "putaway",
    title: "查询入库任务",
    description: "检查上架任务状态与阻塞原因",
    kind: "TOOL_CALL",
    toolName: "get_putaway_task",
  },
  {
    id: "anomaly",
    title: "发现异常",
    description: "基于工具结果定位业务阻塞点",
    kind: "AGENT_NODE",
    toolName: "anomaly_detector",
  },
  {
    id: "evidence",
    title: "生成证据链",
    description: "从工具输出中提取可追溯事实",
    kind: "AGENT_NODE",
    toolName: "evidence_builder",
  },
  {
    id: "diagnosis",
    title: "最终诊断",
    description: "生成原因、限制与建议动作",
    kind: "AGENT_NODE",
    toolName: "diagnosis_synthesizer",
  },
];
