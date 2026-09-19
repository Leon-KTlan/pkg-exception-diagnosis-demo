import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Boxes,
  Braces,
  Play,
  Search,
  Square,
  Warehouse,
} from "lucide-react";
import { StreamDiagnosisError, streamDiagnosis, toTraceFailureReason } from "./api";
import {
  DiagnosisPanel,
  EvidenceChain,
  LiveClock,
  ModeControl,
  RunError,
  RunFeedback,
  TraceContext,
  StepInspector,
  StepTimeline,
  TraceMeta,
} from "./components";
import { createInitialTraceState, traceReducer } from "./state";
import { createRunGeneration } from "./run-generation";
import type { StepId, TraceMode } from "../shared/protocol";

export const DEFAULT_QUESTION = "包裹 PKG-20260918 为什么还没有入库？";

export const SCENARIO_QUESTIONS = [
  { question: DEFAULT_QUESTION, label: "库位不足", packageId: "PKG-20260918", description: "收货已完成，定位入库阻塞原因" },
  { question: "帮我看看包裹 PKG-404 为什么还没入库", label: "查无记录", packageId: "PKG-404", description: "数据不足时，了解诊断的边界" },
  { question: "帮我看看包裹 PKG-TIMEOUT 为什么还没入库", label: "查询超时", packageId: "PKG-TIMEOUT", description: "查看自动重试与失败处理" },
] as const;

function App() {
  const [liveQuestion, setLiveQuestion] = useState(DEFAULT_QUESTION);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [state, dispatch] = useReducer(traceReducer, undefined, createInitialTraceState);
  const [mode, setMode] = useState<TraceMode>("demo");
  const question = mode === "demo" ? SCENARIO_QUESTIONS[scenarioIndex].question : liveQuestion;
  const [selectedStepId, setSelectedStepId] = useState<StepId | null>(null);
  const [formError, setFormError] = useState<string>();
  const abortController = useRef<AbortController | undefined>(undefined);
  const runStartedAt = useRef<number | undefined>(undefined);
  const runGeneration = useRef(createRunGeneration());

  const running = state.status === "RUNNING";
  const hasTrace = state.status !== "IDLE";
  const draftChanged = hasTrace && (state.question !== question.trim() || state.mode !== mode);
  const queryInput = useRef<HTMLInputElement>(null);
  const scenarioButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const runLabel = mode === "demo"
    ? hasTrace && !draftChanged ? "重新播放" : "播放演示"
    : !hasTrace ? "开始诊断" : draftChanged ? "诊断新问题" : "重新诊断";
  const selectedStep = useMemo(
    () =>
      state.steps.find(
        (step) => step.id === (selectedStepId ?? state.activeStepId),
      ) ?? state.steps[0],
    [selectedStepId, state.activeStepId, state.steps],
  );

  useEffect(
    () => () => {
      runGeneration.current.next();
      abortController.current?.abort();
    },
    [],
  );

  const startDiagnosis = async () => {
    const trimmedQuestion = question.trim();
    if (running) return;
    if (!trimmedQuestion) {
      setFormError("请输入要诊断的问题。");
      return;
    }

    const generation = runGeneration.current.next();
    abortController.current?.abort();
    if (mode === "live") setLiveQuestion(trimmedQuestion);
    setFormError(undefined);
    setSelectedStepId(null);
    dispatch({ type: "begin", mode, question: trimmedQuestion });
    const controller = new AbortController();
    abortController.current = controller;
    const startedAt = performance.now();
    runStartedAt.current = startedAt;
    let receivedTraceStarted = false;

    try {
      await streamDiagnosis({
        mode,
        question: trimmedQuestion,
        signal: controller.signal,
        onEvent: (event) => {
          if (!runGeneration.current.isCurrent(generation)) return;
          if (event.type === "trace.started") receivedTraceStarted = true;
          if (event.type === "trace.failed") setSelectedStepId(null);
          dispatch({ type: "event", event });
        },
      });
    } catch (error) {
      if (!runGeneration.current.isCurrent(generation)) return;
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "无法连接诊断服务";
      if (!receivedTraceStarted) {
        dispatch({ type: "reset" });
        setFormError(message.includes("DEEPSEEK_API_KEY")
          ? "模型尚未配置，请联系维护者完成配置，或切换演示回放。"
          : message);
      } else {
        const reason =
          error instanceof StreamDiagnosisError
            ? toTraceFailureReason(error)
            : "SERVER_ERROR";
        setSelectedStepId(null);
        dispatch({
          type: "terminate",
          status: "FAILED",
          error: message,
          terminationReason: reason,
          totalDurationMs: Math.round(performance.now() - startedAt),
        });
      }
    } finally {
      if (abortController.current === controller) {
        abortController.current = undefined;
        runStartedAt.current = undefined;
      }
    }
  };

  const cancelDiagnosis = () => {
    if (!running) return;
    runGeneration.current.next();
    const controller = abortController.current;
    const totalDurationMs = runStartedAt.current
      ? Math.round(performance.now() - runStartedAt.current)
      : undefined;
    abortController.current = undefined;
    runStartedAt.current = undefined;
    controller?.abort();
    dispatch({
      type: "terminate",
      status: "CANCELLED",
      error: "已取消诊断，已收到的步骤记录已保留。",
      terminationReason: "USER_CANCELLED",
      totalDurationMs,
    });
  };

  const switchMode = (nextMode: TraceMode) => {
    if (running || nextMode === mode) return;
    setFormError(undefined);
    setMode(nextMode);
  };

  const editQuestion = () => {
    // 恢复操作应返回当前结果所属的模式，不受下一次诊断的模式选择影响。
    const targetMode = state.mode ?? mode;
    setMode(targetMode);
    setFormError(undefined);
    window.requestAnimationFrame(() => {
      if (targetMode === "demo") scenarioButtons.current[scenarioIndex]?.focus();
      else queryInput.current?.focus();
    });
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="入库诊断台首页">
          <span className="brand-mark"><Warehouse size={22} /></span>
          <span><strong>入库诊断台</strong><small>WAREHOUSE TRACE / 01</small></span>
        </a>
        <div className="header-context"><span>仓储异常诊断</span><span className="header-rule" /><span>华东一号仓 · 演示</span></div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <span className="section-number">包裹入库 / 异常诊断</span>
            <h1>找到入库阻塞点，<em>让处理有依据。</em></h1>
            <p>从包裹、收货单到上架任务，查看异常原因、处理建议与业务证据。</p>
          </div>
          <div className="hero-annotation" aria-hidden="true"><Boxes size={31} /><span>ARRIVAL → PUTAWAY</span></div>
        </section>

        <div className="mode-bar">
          <div><span className="eyebrow">选择诊断方式</span><p>两种模式均使用虚构的演示仓储数据，不连接真实 WMS。</p></div>
          <ModeControl mode={mode} onChange={switchMode} disabled={running} />
        </div>
        <p className="mode-help" id="mode-help">
          {mode === "demo" ? "固定流程回放，无需模型配置。选择一个场景，再点击播放。" : "实际调用模型分析演示仓储数据，需已配置模型服务。"}
          {running && <strong> 取消当前诊断后可切换模式。</strong>}
        </p>

        {mode === "demo" && (
          <div className="scenario-grid" role="group" aria-label="选择演示场景">
            {SCENARIO_QUESTIONS.map((scenario, index) => (
              <button
                key={scenario.packageId}
                type="button"
                ref={(element) => { scenarioButtons.current[index] = element; }}
                className={`scenario-card${index === scenarioIndex ? " is-selected" : ""}`}
                aria-pressed={index === scenarioIndex}
                disabled={running}
                onClick={() => { setScenarioIndex(index); setFormError(undefined); }}
              >
                <span className="scenario-heading"><span>0{index + 1}</span><strong>{scenario.label}</strong><span>{index === scenarioIndex ? "已选择" : "选择"}</span></span>
                <span>{scenario.description}</span>
                <code>{scenario.packageId}</code>
              </button>
            ))}
          </div>
        )}

        <section className="query-console" aria-label="发起诊断">
          <div className="query-label"><Search size={18} /><span>{mode === "demo" ? "场景问题" : "诊断问题"}</span></div>
          <div className="query-input-wrap">
            {mode === "demo" ? <p className="scenario-question">{question}</p> : (
              <input
                ref={queryInput}
                aria-label="诊断问题"
                aria-describedby="question-help"
                aria-invalid={Boolean(formError)}
                value={liveQuestion}
                onChange={(event) => { setLiveQuestion(event.target.value); setFormError(undefined); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing && !running) void startDiagnosis();
                }}
                disabled={running}
                spellCheck={false}
              />
            )}
          </div>
          {running ? (
            <button className="run-button cancel-button" type="button" onClick={cancelDiagnosis}><Square size={16} fill="currentColor" />取消诊断</button>
          ) : (
            <button className="run-button" type="button" onClick={() => void startDiagnosis()}><Play size={17} fill="currentColor" />{runLabel}</button>
          )}
        </section>
        {mode === "live" && <p className="input-help" id="question-help">一次诊断一个包裹，请包含包裹号，如 PKG-20260918。可直接输入包裹号或完整问题，按 Enter 提交。</p>}
        {formError && <RunError title="暂时无法开始诊断" message={formError} />}

        {hasTrace ? (
          <>
            <section id="diagnosis-result" className="run-overview" aria-label="本次运行概况">
              <TraceContext state={state} draftMode={mode} draftQuestion={question} />
              <div className="run-status"><LiveClock state={state} />{!running && <a href="#diagnosis-result">查看结果</a>}</div>
            </section>
            <div className="result-region">
              {state.diagnosis && <DiagnosisPanel diagnosis={state.diagnosis} />}
              {state.diagnosis?.status === "INSUFFICIENT_EVIDENCE" && (
                <div className="recovery-actions empty-recovery">
                  <p>{state.mode === "demo" ? "这是固定的查无记录演示，可选择其他场景继续体验。" : "请核对包裹号后重新发起诊断。"}</p>
                  <button type="button" onClick={editQuestion}>{state.mode === "demo" ? "选择其他场景" : "核对包裹号"}</button>
                </div>
              )}
              {(state.status === "FAILED" || state.status === "CANCELLED") && (
                <RunFeedback state={state} canRetry={!draftChanged} onRetry={() => void startDiagnosis()} onEdit={editQuestion} />
              )}
            </div>
            <div className="workspace-label"><div><Braces size={15} /><span>执行过程与证据</span></div><span>点击步骤，按需核验原始数据</span></div>
            <details className="technical-details trace-technical"><summary>运行技术信息 · 模型、调用统计与 Trace ID</summary><TraceMeta state={state} /></details>
            <section className="diagnostic-grid">
              <StepTimeline steps={state.steps} selectedStepId={selectedStep.id} onSelect={setSelectedStepId} />
              <StepInspector key={`${state.traceId ?? "pending"}-${selectedStep.id}`} step={selectedStep} />
              <EvidenceChain evidence={state.evidence} status={state.status} />
            </section>
          </>
        ) : (
          <div className="start-guide"><span className="eyebrow">你将获得</span><p>异常原因与处理建议 <span>→</span> 可核验的业务证据 <span>→</span> 完整的七步执行记录</p></div>
        )}
      </main>
      <footer><span>入库诊断台 · Agent Trace Console</span><span>演示仓储数据 · 不连接真实 WMS</span></footer>
    </div>
  );
}

export default App;
