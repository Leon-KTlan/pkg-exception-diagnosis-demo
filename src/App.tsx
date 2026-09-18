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
  RunError,
  StepInspector,
  StepTimeline,
  TraceMeta,
} from "./components";
import { createInitialTraceState, traceReducer } from "./state";
import type { StepId } from "../shared/protocol";

const packagePattern = /^PKG-[A-Z0-9-]+$/;

function App() {
  const [packageId, setPackageId] = useState("PKG-20260918");
  const [state, dispatch] = useReducer(traceReducer, undefined, createInitialTraceState);
  const [selectedStepId, setSelectedStepId] = useState<StepId | null>(null);
  const [formError, setFormError] = useState<string>();
  const abortController = useRef<AbortController | undefined>(undefined);

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
    const normalizedPackageId = packageId.trim().toUpperCase();
    if (!packagePattern.test(normalizedPackageId)) {
      setFormError("请输入 PKG- 开头的有效包裹号，例如 PKG-20260918。");
      return;
    }

    setPackageId(normalizedPackageId);
    setFormError(undefined);
    setSelectedStepId(null);
    dispatch({ type: "reset" });
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;

    try {
      await streamDiagnosis({
        packageId: normalizedPackageId,
        signal: controller.signal,
        onEvent: (event) => dispatch({ type: "event", event }),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setFormError(error instanceof Error ? error.message : "无法连接诊断服务");
    }
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
              输入包裹号，实时查看 Agent 如何调用仓储工具、识别阻塞点，并用原始业务数据生成可追溯的证据链。
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

        <section className="query-console" aria-label="发起诊断">
          <div className="query-label">
            <Search size={18} />
            <span>包裹号</span>
          </div>
          <div className="query-input-wrap">
            <input
              aria-label="包裹号"
              value={packageId}
              onChange={(event) => {
                setPackageId(event.target.value.toUpperCase());
                setFormError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !running) void startDiagnosis();
              }}
              disabled={running}
              spellCheck={false}
            />
            <span className="input-question">为什么还没有入库？</span>
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
            {[
              ["PKG-404", "空数据"],
              ["PKG-TIMEOUT", "工具超时"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                disabled={running}
                onClick={() => {
                  setPackageId(value);
                  setFormError(undefined);
                }}
              >
                <CornerDownRight size={12} />
                {value}
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
