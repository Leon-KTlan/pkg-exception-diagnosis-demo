import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Circle,
  Clipboard,
  Clock3,
  DatabaseZap,
  Link2,
  LoaderCircle,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  XCircle,
  Ban,
} from "lucide-react";
import type {
  Diagnosis,
  Evidence,
  StepId,
  StepStatus,
  StepView,
  TraceMode,
  TraceStatus,
} from "../shared/protocol";
import { STEP_DEFINITIONS } from "../shared/protocol";
import type { TraceState } from "./state";

const classNames = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const statusLabels: Record<StepStatus, string> = {
  PENDING: "等待中",
  RUNNING: "执行中",
  SUCCESS: "已完成",
  ERROR: "失败",
  RETRYING: "重试中",
  BLOCKED: "已阻断",
  CANCELLED: "已取消",
};

const statusIcons: Record<StepStatus, ReactNode> = {
  PENDING: <Circle size={14} strokeWidth={1.5} />,
  RUNNING: <LoaderCircle size={14} className="animate-spin" />,
  SUCCESS: <Check size={14} strokeWidth={2.4} />,
  ERROR: <XCircle size={14} />,
  RETRYING: <RotateCcw size={14} className="animate-spin" />,
  BLOCKED: <ShieldAlert size={14} />,
  CANCELLED: <Ban size={14} />,
};

export const modeLabels: Record<TraceMode, string> = {
  demo: "演示回放（Demo）",
  live: "模型实时诊断（Live）",
};

const traceStatus = (state: TraceState) => {
  if (state.status === "COMPLETED" && state.diagnosis?.status === "INSUFFICIENT_EVIDENCE") {
    return "诊断完成 · 证据不足";
  }
  const labels: Record<TraceStatus, string> = {
    IDLE: "未开始", RUNNING: "正在诊断", COMPLETED: "诊断完成",
    FAILED: "诊断失败", CANCELLED: "已取消",
  };
  return labels[state.status];
};

const businessError = (message: string) =>
  STEP_DEFINITIONS.reduce(
    (text, step) => text.replaceAll(step.toolName, step.title), message,
  );

export const TraceContext = ({ state, draftMode, draftQuestion }: {
  state: TraceState;
  draftMode: TraceMode;
  draftQuestion: string;
}) => {
  const changed = state.question !== draftQuestion.trim() || state.mode !== draftMode;
  return (
    <div className="trace-context">
      <div className="trace-context-heading">
        <span className="eyebrow">{changed ? "上次诊断" : "本次诊断"}</span>
        <span>{state.mode && modeLabels[state.mode]}</span>
      </div>
      <strong>{state.question}</strong>
      {changed && <p className="draft-notice">待诊断内容已修改，下方为上次诊断结果。发起新诊断后替换。</p>}
    </div>
  );
};

const formatDuration = (milliseconds?: number) => {
  if (milliseconds === undefined) return "—";
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
};

export const StatusPill = ({ status }: { status: StepStatus }) => (
  <span className={classNames("status-pill", `status-${status.toLowerCase()}`)}>
    {statusIcons[status]}
    {statusLabels[status]}
  </span>
);

export const ModeControl = ({
  mode,
  onChange,
  disabled = false,
}: {
  mode: TraceMode;
  onChange: (mode: TraceMode) => void;
  disabled?: boolean;
}) => (
  <div className="mode-control" role="group" aria-label="诊断运行模式">
    {([
      ["demo", modeLabels.demo],
      ["live", modeLabels.live],
    ] as const).map(([value, label]) => (
      <button
        key={value}
        type="button"
        className={classNames("mode-option", mode === value && "is-selected")}
        aria-pressed={mode === value}
        disabled={disabled}
        onClick={() => onChange(value)}
      >
        {label}
      </button>
    ))}
  </div>
);

export const TraceMeta = ({ state }: { state: TraceState }) => {
  const traceKind =
    state.mode === "demo" && state.simulated === true
      ? "demo"
      : state.mode === "live" && state.simulated === false
        ? "live"
        : undefined;
  const cells = [
    {
      label: "运行模式",
      value: traceKind ? traceKind.toUpperCase() : "等待创建",
      accent: Boolean(traceKind),
      accentClass: traceKind ? `${traceKind}-value` : "",
    },
    {
      label: "数据来源",
      value: "演示仓储数据",
      accent: false,
      accentClass: "",
    },
    { label: "Trace ID", value: state.traceId ?? "等待创建" },
    { label: "当前模型", value: state.model ?? "等待创建" },
    {
      label: "调用统计",
      value:
        traceKind === "demo"
          ? `模拟工具调用：${state.toolCallCount} 次`
          : `工具调用：${state.toolCallCount} 次`,
    },
    { label: "总耗时", value: formatDuration(state.totalDurationMs) },
    { label: "运行状态", value: traceStatus(state) },
    ...(state.terminationReason
      ? [{ label: "终止原因", value: state.terminationReason }]
      : []),
  ];

  return (
    <section className="trace-strip" aria-label="诊断运行信息">
      {cells.map((cell) => (
        <div className="trace-cell" key={cell.label}>
          <span>{cell.label}</span>
          <strong className={cell.accent ? cell.accentClass : ""}>{cell.value}</strong>
        </div>
      ))}
    </section>
  );
};

export const StepTimeline = ({
  steps,
  selectedStepId,
  onSelect,
}: {
  steps: StepView[];
  selectedStepId: StepId;
  onSelect: (stepId: StepId) => void;
}) => (
  <aside className="panel timeline-panel" aria-label="诊断步骤">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">执行路径</span>
        <h2>诊断链路</h2>
      </div>
      <span className="panel-count">{steps.length} 步</span>
    </div>
    <ol className="timeline-list">
      {steps.map((step, index) => (
        <li key={step.id} className="timeline-item">
          <button
            type="button"
            className={classNames(
              "timeline-button",
              selectedStepId === step.id && "is-selected",
              step.status === "RUNNING" && "is-running",
            )}
            onClick={() => onSelect(step.id)}
          >
            <span className={classNames("step-index", `step-${step.status.toLowerCase()}`)}>
              {step.status === "SUCCESS" ? <Check size={15} /> : String(index + 1).padStart(2, "0")}
            </span>
            <span className="step-copy">
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </span>
            <span className="step-meta">
              <span
                className={classNames(
                  "timeline-status",
                  `status-${step.status.toLowerCase()}`,
                )}
              >
                {statusLabels[step.status]}
              </span>
              <span className="step-duration">{formatDuration(step.durationMs)}</span>
            </span>
          </button>
          {index < steps.length - 1 && <span className="timeline-rail" />}
        </li>
      ))}
    </ol>
  </aside>
);

const JsonBlock = ({ label, value }: { label: string; value: unknown }) => {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const serialized = value === undefined ? "等待数据" : JSON.stringify(value, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serialized);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2000);
  };

  return (
    <details className="json-disclosure">
      <summary>
        <span>
          <TerminalSquare size={15} />
          {label}
        </span>
        <ChevronDown size={15} className="summary-chevron" />
      </summary>
      <div className="json-shell">
        <button type="button" className="copy-button" onClick={copy} disabled={value === undefined}>
          {copyState === "copied" ? <Check size={13} /> : <Clipboard size={13} />}
          {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败，请手动选择" : "复制"}
        </button>
        <pre>{serialized}</pre>
      </div>
    </details>
  );
};

const describeOutput = (step: StepView) => {
  if (step.status === "PENDING") return "开始诊断后，按顺序执行此步骤。";
  if (step.status === "CANCELLED") return "诊断已取消，当前步骤未继续执行。";
  if (step.status === "BLOCKED") return businessError(step.error ?? "上游条件不足，当前步骤未执行。");
  if (step.status === "ERROR") return businessError(step.error ?? "执行失败，请重新诊断。");
  if (step.status === "RETRYING") return businessError(step.error ?? "首次调用失败，正在自动重试。");
  if (step.status === "RUNNING") return `正在${step.title}，完成后将自动更新。`;
  if (step.output === null) return "工具执行成功，但没有找到匹配的业务数据。";
  if (Array.isArray(step.output)) return `已生成 ${step.output.length} 条可追溯证据。`;
  if (typeof step.output === "object") return "步骤已完成，可按需展开查看原始数据。";
  return String(step.output ?? "步骤已完成。");
};

export const StepInspector = ({ step }: { step: StepView }) => (
  <section className="panel inspector-panel" aria-live="polite">
    <div className="inspector-topline">
      <div className="step-kind">
        {step.kind === "TOOL_CALL" ? <DatabaseZap size={15} /> : <Sparkles size={15} />}
        {step.kind === "TOOL_CALL" ? "仓储工具" : "分析步骤"}
      </div>
      <StatusPill status={step.status} />
    </div>

    <div className="inspector-title">
      <span>步骤详情</span>
      <h2>{step.title}</h2>
      <p>{step.description}</p>
    </div>

    <div className="step-facts">
      <span>耗时 <strong>{formatDuration(step.durationMs)}</strong></span>
      <span>尝试次数 <strong>{step.attempt ?? "—"}</strong></span>
    </div>
    <details className="technical-details">
      <summary>技术信息</summary>
      <div className="tool-ledger">
        <div><span>工具 / 能力名</span><code>{step.toolName}</code></div>
        <div><span>原始状态</span><code>{step.status}</code></div>
      </div>
      {step.error && <p>{step.error}</p>}
    </details>

    <div className={classNames("step-summary", step.status === "ERROR" && "is-error")}>
      {step.status === "RUNNING" && <span className="activity-pulse" />}
      <p>{describeOutput(step)}</p>
    </div>

    <div className="json-stack">
      <JsonBlock label="输入数据（Input）" value={step.input} />
      <JsonBlock label="输出数据（Output）" value={step.output} />
    </div>
  </section>
);

export const EvidenceChain = ({ evidence, status }: { evidence: Evidence[]; status: TraceStatus }) => (
  <aside className="panel evidence-panel" aria-label="证据链">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">事实溯源</span>
        <h2>证据链</h2>
      </div>
      <span className="evidence-score">
        已获得 {evidence.length} 条证据
      </span>
    </div>

    {evidence.length === 0 ? (
      <div className="evidence-empty">
        <Link2 size={24} />
        <p>{({
          IDLE: "开始诊断后，可在这里核验业务事实及来源。",
          RUNNING: "尚未获得证据，正在等待诊断步骤完成。",
          COMPLETED: "本次未获得可用证据，数据不足，无法确认入库原因。",
          FAILED: "诊断已结束，未形成完整证据链。已收到的工具结果可在步骤详情中查看。",
          CANCELLED: "诊断已取消，当前没有可用证据。已收到的步骤仍可查看。",
        } satisfies Record<TraceStatus, string>)[status]}</p>
      </div>
    ) : (
      <ol className="evidence-list">
        {evidence.map((item, index) => (
          <li key={item.evidenceId} className="evidence-node">
            <span className="evidence-index">{String(index + 1).padStart(2, "0")}</span>
            <details open={index === evidence.length - 1}>
              <summary>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.evidenceId}</small>
                </div>
                <ChevronDown size={15} />
              </summary>
              <p>{item.fact}</p>
              <dl>
                <div>
                  <dt>来源步骤</dt>
                  <dd>{STEP_DEFINITIONS.find((step) => step.id === item.sourceStepId)?.title}</dd>
                </div>
                <div>
                  <dt>原始字段</dt>
                  <dd>{item.sourceField}</dd>
                </div>
                <div>
                  <dt>字段值</dt>
                  <dd>{String(item.rawValue)}</dd>
                </div>
              </dl>
            </details>
          </li>
        ))}
      </ol>
    )}
  </aside>
);

const severityLabels: Record<Diagnosis["severity"], string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
};

export const DiagnosisPanel = ({
  diagnosis,
}: {
  diagnosis: Diagnosis;
}) => (
  <section className="diagnosis-panel">
    <div className="diagnosis-marker">
      {diagnosis.status === "CONFIRMED" ? <PackageCheck size={27} /> : <AlertTriangle size={27} />}
    </div>
    <div className="diagnosis-content">
      <div className="diagnosis-header">
        <div>
          <span className="eyebrow">最终诊断</span>
          <h2>{diagnosis.summary}</h2>
        </div>
        <div className="diagnosis-flags">
          <span>{diagnosis.status === "CONFIRMED" ? "原因已确认" : "证据不足"}</span>
          {diagnosis.status === "CONFIRMED" && <span>严重度：{severityLabels[diagnosis.severity]}</span>}
          <span>
            引用 {diagnosis.evidenceIds.length} 条证据
          </span>
        </div>
      </div>
      <p className="diagnosis-reason">{diagnosis.reason}</p>

      <div className="diagnosis-grid">
        <div>
          <h3>建议动作 <small>需在仓储系统中处理</small></h3>
          <ol className="action-list">
            {[...diagnosis.actions].sort((a, b) => a.priority.localeCompare(b.priority)).map((action, index) => (
              <li key={`${action.priority}-${action.title}`}>
                <span className="action-priority">{action.priority}</span>
                <div>
                  <strong>{index === 0 && <span className="first-action">首要建议</span>}{action.title}</strong>
                  <p>{action.description}</p>
                  <small>执行角色 · {action.owner}</small>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>诊断限制</h3>
          {diagnosis.limitations.length ? (
            <ul className="limitation-list">
              {diagnosis.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          ) : (
            <div className="all-clear">
              本次未列出额外限制。
            </div>
          )}
        </div>
      </div>
    </div>
  </section>
);

export const RunError = ({
  message,
  title = "诊断未能完成",
}: {
  message: string;
  title?: string;
}) => (
  <section className="run-error" role="alert">
    <AlertTriangle size={22} />
    <div>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  </section>
);

export const LiveClock = ({ state }: { state: TraceState }) => (
  <span className={classNames("live-clock", state.status === "RUNNING" && "is-running")} role="status">
    <Clock3 size={14} />
    {traceStatus(state)}
    {state.status === "RUNNING" && ` · ${state.steps.find((step) => step.id === state.activeStepId)?.title ?? "正在准备"}`}
  </span>
);

export const RunFeedback = ({ state, onRetry, onEdit, canRetry }: {
  state: TraceState;
  onRetry: () => void;
  onEdit: () => void;
  canRetry: boolean;
}) => {
  const cancelled = state.status === "CANCELLED";
  const failedStep = state.steps.find((step) => step.status === "ERROR");
  const retries = Math.max(0, (failedStep?.attempt ?? 1) - 1);
  const reason = state.terminationReason;
  const fixedFailure = state.mode === "demo" && reason === "TOOL_TIMEOUT";
  const message = reason === "TOOL_TIMEOUT"
    ? `${failedStep?.title ?? "仓储查询"}超时${retries ? `，已自动重试 ${retries} 次，仍未成功` : ""}。`
    : reason === "MODEL_TIMEOUT" ? "模型响应超时，本次未能完成诊断。"
    : reason === "STREAM_DISCONNECTED" || reason === "SERVER_DISCONNECTED"
      ? "诊断连接已中断，本次未能完成诊断。"
    : reason === "CLIENT_INACTIVITY_TIMEOUT" ? "长时间未收到诊断进度，本次运行已停止。"
    : reason === "DIAGNOSIS_TIMEOUT" || reason === "CLIENT_OVERALL_TIMEOUT"
      ? "诊断超过时间限制，本次运行已停止。"
    : businessError(state.error ?? "诊断服务暂时不可用，请稍后重试。");
  return (
    <section className={classNames("run-error", cancelled && "is-cancelled")} role={cancelled ? "status" : "alert"}>
      {cancelled ? <Ban size={22} /> : <AlertTriangle size={22} />}
      <div>
        <strong>{cancelled ? "已取消诊断" : "诊断未能完成"}</strong>
        <p>{cancelled ? "已收到的步骤记录已保留，可重新发起诊断。" : message}</p>
        {!cancelled && fixedFailure && <p>这是固定失败演示，重复播放会得到相同结果。请选择其他场景体验。</p>}
        <div className="recovery-actions">
          {canRetry && !fixedFailure && <button type="button" onClick={onRetry}>
            {state.mode === "demo" ? "重新播放" : "重新诊断"}
          </button>}
          <button type="button" onClick={onEdit}>{state.mode === "demo" ? "选择其他场景" : "核对诊断问题"}</button>
        </div>
      </div>
    </section>
  );
};
