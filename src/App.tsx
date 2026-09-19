import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowRight,
  Boxes,
  Braces,
  CornerDownRight,
  Play,
  Radio,
  RotateCcw,
  Search,
  Warehouse,
} from "lucide-react";
import { streamDiagnosis } from "./api";
import {
  DiagnosisPanel,
  EvidenceChain,
  LiveClock,
  ModeControl,
  RunError,
  StepInspector,
  StepTimeline,
  TraceMeta,
} from "./components";
import { createInitialTraceState, traceReducer } from "./state";
import { createRunGeneration } from "./run-generation";
import type { StepId, TraceMode } from "../shared/protocol";

export const DEFAULT_QUESTION = "包裹 PKG-20260918 为什么还没有入库？";

export const SCENARIO_QUESTIONS = [
  { question: DEFAULT_QUESTION, label: "正常场景" },
  { question: "帮我看看包裹 PKG-404 为什么还没入库", label: "空数据" },
  { question: "帮我看看包裹 PKG-TIMEOUT 为什么还没入库", label: "工具超时" },
] as const;

function App() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [state, dispatch] = useReducer(traceReducer, undefined, createInitialTraceState);
  const [mode, setMode] = useState<TraceMode>("demo");
  const [selectedStepId, setSelectedStepId] = useState<StepId | null>(null);
  const [formError, setFormError] = useState<string>();
  const abortController = useRef<AbortController | undefined>(undefined);
  const runGeneration = useRef(createRunGeneration());

  const running = state.status === "RUNNING";
  const selectedStep = useMemo(
    () =>
      state.steps.find(
        (step) => step.id === (selectedStepId ?? state.activeStepId),
      ) ?? state.steps[0],
    [selectedStepId, state.activeStepId, state.steps],
  );

  useEffect(
    () => () => {
      abortController.current?.abort();
    },
    [],
  );

  const startDiagnosis = async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setFormError("请输入要诊断的问题。");
      return;
    }

    const generation = runGeneration.current.next();
    abortController.current?.abort();
    setQuestion(trimmedQuestion);
    setFormError(undefined);
    setSelectedStepId(null);
    dispatch({ type: "reset" });
    const controller = new AbortController();
    abortController.current = controller;

    try {
      await streamDiagnosis({
        mode,
        question: trimmedQuestion,
        signal: controller.signal,
        onEvent: (event) => {
          if (!runGeneration.current.isCurrent(generation)) return;
          dispatch({ type: "event", event });
        },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setFormError(error instanceof Error ? error.message : "无法连接诊断服务");
    } finally {
      if (abortController.current === controller) {
        abortController.current = undefined;
      }
    }
  };

  const switchMode = (nextMode: TraceMode) => {
    if (nextMode === mode) return;
    runGeneration.current.next();
    abortController.current?.abort();
    abortController.current = undefined;
    dispatch({ type: "reset" });
    setSelectedStepId(null);
    setFormError(undefined);
    setMode(nextMode);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="入库诊断台首页">
          <span className="brand-mark">
            <Warehouse size={22} />
          </span>
          <span>
            <strong>入库诊断台</strong>
            <small>WAREHOUSE TRACE / 01</small>
          </span>
        </a>
        <div className="header-context">
          <span><Radio size={13} /> Agent 在线诊断</span>
          <span className="header-rule" />
          <span>华东一号仓</span>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <span className="section-number">01 / 异常检索</span>
            <h1>
              让每一次诊断，
              <em>都有迹可循。</em>
            </h1>
            <p>
              输入自然语言问题，实时查看 Agent 如何调用仓储工具、识别阻塞点，并用原始业务数据生成可追溯的证据链。
            </p>
          </div>
          <div className="hero-annotation" aria-hidden="true">
            <Boxes size={31} />
            <span>ARRIVAL</span>
            <ArrowRight size={16} />
            <span>RECEIPT</span>
            <ArrowRight size={16} />
            <span>PUTAWAY</span>
          </div>
        </section>

        <div className="mode-bar">
          <div>
            <span className="eyebrow">运行边界</span>
            <p>先选择数据来源，再发起诊断</p>
          </div>
          <ModeControl mode={mode} onChange={switchMode} />
        </div>

        <section className="query-console" aria-label="发起诊断">
          <div className="query-label">
            <Search size={18} />
            <span>诊断问题</span>
          </div>
          <div className="query-input-wrap">
            <input
              aria-label="诊断问题"
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                setFormError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !running) void startDiagnosis();
              }}
              disabled={running}
              spellCheck={false}
            />
          </div>
          <button
            className="run-button"
            type="button"
            onClick={() => void startDiagnosis()}
            disabled={running}
          >
            {running ? <RotateCcw size={17} className="animate-spin" /> : <Play size={17} fill="currentColor" />}
            {running ? "诊断进行中" : state.status === "IDLE" ? "开始诊断" : "重新诊断"}
          </button>
          <div className="query-examples">
            <span>测试场景</span>
            {SCENARIO_QUESTIONS.map(({ question: scenarioQuestion, label }) => (
              <button
                type="button"
                key={scenarioQuestion}
                disabled={running}
                onClick={() => {
                  setQuestion(scenarioQuestion);
                  setFormError(undefined);
                }}
              >
                <CornerDownRight size={12} />
                {scenarioQuestion}
                <small>{label}</small>
              </button>
            ))}
          </div>
        </section>

        {formError && <RunError message={formError} />}

        <div className="workspace-label">
          <div>
            <Braces size={15} />
            <span>Agent 执行工作区</span>
          </div>
          <LiveClock running={running} />
        </div>

        <TraceMeta state={state} />

        <section className="diagnostic-grid">
          <StepTimeline
            steps={state.steps}
            selectedStepId={selectedStep.id}
            onSelect={setSelectedStepId}
          />
          <StepInspector step={selectedStep} />
          <EvidenceChain evidence={state.evidence} />
        </section>

        {state.diagnosis && (
          <DiagnosisPanel diagnosis={state.diagnosis} evidence={state.evidence} />
        )}
        {state.status === "FAILED" && state.error && <RunError message={state.error} />}
      </main>

      <footer>
        <span>入库诊断台 · Agent Trace Console</span>
        <span>数据为演示场景构造，不连接真实 WMS</span>
      </footer>
    </div>
  );
}

export default App;
