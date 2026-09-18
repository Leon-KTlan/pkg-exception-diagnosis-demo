import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
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
} from "lucide-react";
import type {
  Diagnosis,
  Evidence,
  StepId,
  StepStatus,
  StepView,
  TraceStatus,
} from "../shared/protocol";
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
};

const statusIcons: Record<StepStatus, ReactNode> = {
  PENDING: <Circle size={14} strokeWidth={1.5} />,
  RUNNING: <LoaderCircle size={14} className="animate-spin" />,
  SUCCESS: <Check size={14} strokeWidth={2.4} />,
  ERROR: <XCircle size={14} />,
  RETRYING: <RotateCcw size={14} className="animate-spin" />,
  BLOCKED: <ShieldAlert size={14} />,
};

const EXPECTED_EVIDENCE_COUNT = 4;

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

export const TraceMeta = ({ state }: { state: TraceState }) => {
  const statusCopy: Record<TraceStatus, string> = {
    IDLE: "待启动",
    RUNNING: "诊断中",
    COMPLETED: "诊断完成",
    FAILED: "诊断失败",
  };

  const cells = [
    { label: "运行模式", value: "LIVE", accent: true },
    { label: "Trace ID", value: state.traceId ?? "等待创建" },
    { label: "当前模型", value: state.model ?? "DeepSeek" },
    { label: "工具调用", value: `${state.toolCallCount} 次` },
    { label: "总耗时", value: formatDuration(state.totalDurationMs) },
    { label: "运行状态", value: statusCopy[state.status] },
  ];

  return (
    <section className="trace-strip" aria-label="诊断运行信息">
      {cells.map((cell) => (
        <div className="trace-cell" key={cell.label}>
          <span>{cell.label}</span>
          <strong className={cell.accent ? "live-value" : ""}>{cell.value}</strong>
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
  const [copied, setCopied] = useState(false);
  const serialized = value === undefined ? "等待数据" : JSON.stringify(value, null, 2);
  const copy = async () => {
    await navigator.clipboard.writeText(serialized);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <details className="json-disclosure" open={label === "Output" && value !== undefined}>
      <summary>
        <span>
          <TerminalSquare size={15} />
          {label}
        </span>
        <ChevronDown size={15} className="summary-chevron" />
      </summary>
      <div className="json-shell">
        <button type="button" className="copy-button" onClick={copy} disabled={value === undefined}>
          {copied ? <Check size={13} /> : <Clipboard size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
        <pre>{serialized}</pre>
      </div>
    </details>
  );
};

const describeOutput = (step: StepView) => {
  if (step.status === "PENDING") return "等待上游步骤完成后执行。";
  if (step.status === "BLOCKED") return step.error ?? "上游条件不足，当前步骤已阻断。";
  if (step.status === "ERROR") return step.error ?? "执行失败，请重新诊断。";
  if (step.status === "RETRYING") return step.error ?? "首次调用失败，正在自动重试。";
  if (step.status === "RUNNING") return "Agent 正在处理当前步骤，结果会通过 SSE 实时到达。";
  if (step.output === null) return "工具执行成功，但没有找到匹配的业务数据。";
  if (Array.isArray(step.output)) return `已生成 ${step.output.length} 条可追溯证据。`;
  if (typeof step.output === "object") return "步骤已完成，结构化结果可在下方展开检查。";
  return String(step.output ?? "步骤已完成。");
};

export const StepInspector = ({ step }: { step: StepView }) => (
  <section className="panel inspector-panel" aria-live="polite">
    <div className="inspector-topline">
      <div className="step-kind">
        {step.kind === "TOOL_CALL" ? <DatabaseZap size={15} /> : <Sparkles size={15} />}
        {step.kind}
      </div>
      <StatusPill status={step.status} />
    </div>

    <div className="inspector-title">
      <span>当前步骤</span>
      <h2>{step.title}</h2>
      <p>{step.description}</p>
    </div>

    <div className="tool-ledger">
      <div>
        <span>Tool Name</span>
        <code>{step.toolName}</code>
      </div>
      <div>
        <span>Status</span>
        <strong>{step.status}</strong>
      </div>
      <div>
        <span>Duration</span>
        <strong>{formatDuration(step.durationMs)}</strong>
      </div>
      <div>
        <span>Attempt</span>
        <strong>{step.attempt ?? (step.status === "PENDING" ? "—" : 1)}</strong>
      </div>
    </div>

    <div className={classNames("step-summary", step.status === "ERROR" && "is-error")}>
      {step.status === "RUNNING" && <span className="activity-pulse" />}
      <p>{describeOutput(step)}</p>
    </div>

    <div className="json-stack">
      <JsonBlock label="Input" value={step.input} />
      <JsonBlock label="Output" value={step.output} />
    </div>
  </section>
);

export const EvidenceChain = ({ evidence }: { evidence: Evidence[] }) => (
  <aside className="panel evidence-panel" aria-label="证据链">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">事实溯源</span>
        <h2>证据链</h2>
      </div>
      <span className="evidence-score">
        {evidence.length}/{EXPECTED_EVIDENCE_COUNT}
      </span>
    </div>

    {evidence.length === 0 ? (
      <div className="evidence-empty">
        <Link2 size={24} />
        <p>工具返回结果后，证据会在这里逐条串联。</p>
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
                  <dd>{item.sourceStepId}</dd>
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
  evidence,
}: {
  diagnosis: Diagnosis;
  evidence: Evidence[];
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
          <span>{diagnosis.status}</span>
          <span>严重度：{severityLabels[diagnosis.severity]}</span>
          <span>
            证据：{diagnosis.evidenceIds.length}/
            {Math.max(evidence.length, EXPECTED_EVIDENCE_COUNT)}
          </span>
        </div>
      </div>
      <p className="diagnosis-reason">{diagnosis.reason}</p>

      <div className="diagnosis-grid">
        <div>
          <h3>建议动作</h3>
          <ol className="action-list">
            {diagnosis.actions.map((action) => (
              <li key={`${action.priority}-${action.title}`}>
                <span className="action-priority">{action.priority}</span>
                <div>
                  <strong>{action.title}</strong>
                  <p>{action.description}</p>
                  <small>执行角色 · {action.owner}</small>
                </div>
                <ArrowUpRight size={17} />
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
              <CheckCircle2 size={18} />
              关键证据完整，未发现数据缺口。
            </div>
          )}
        </div>
      </div>
    </div>
  </section>
);

export const RunError = ({ message }: { message: string }) => (
  <section className="run-error" role="alert">
    <AlertTriangle size={22} />
    <div>
      <strong>诊断未能完成</strong>
      <p>{message}</p>
    </div>
  </section>
);

export const LiveClock = ({ running }: { running: boolean }) => (
  <span className={classNames("live-clock", running && "is-running")}>
    <Clock3 size={14} />
    {running ? "事件流连接中" : "等待诊断"}
  </span>
);
