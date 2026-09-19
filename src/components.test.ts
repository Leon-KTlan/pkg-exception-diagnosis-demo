import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { STEP_DEFINITIONS, type Diagnosis, type StepView } from "../shared/protocol";
import { DiagnosisPanel, RunError, StepInspector, StepTimeline, TraceMeta, TraceContext, LiveClock, EvidenceChain, ModeControl, RunFeedback } from "./components";
import { createInitialTraceState } from "./state";

describe("diagnosis presentation", () => {
  it("labels Demo trace data and simulated tool calls", () => {
    const state = {
      ...createInitialTraceState(),
      traceId: "tr_demo_123456789abc",
      mode: "demo" as const,
      simulated: true,
      model: "固定回放",
      toolCallCount: 3,
    };

    const markup = renderToStaticMarkup(createElement(TraceMeta, { state }));

    expect(markup).toContain("DEMO");
    expect(markup).toContain("演示仓储数据");
    expect(markup).toContain("固定回放");
    expect(markup).toContain("模拟工具调用：3 次");
  });

  it("keeps Live trace wording and real model information", () => {
    const state = {
      ...createInitialTraceState(),
      traceId: "tr_live_123456789abc",
      mode: "live" as const,
      simulated: false,
      model: "fake-deepseek",
      toolCallCount: 2,
    };

    const markup = renderToStaticMarkup(createElement(TraceMeta, { state }));

    expect(markup).toContain("LIVE");
    expect(markup).toContain("演示仓储数据");
    expect(markup).toContain("fake-deepseek");
    expect(markup).toContain("工具调用：2 次");
    expect(markup).not.toContain("模拟工具调用");
  });

  it("shows each step status directly in the timeline", () => {
    const steps: StepView[] = STEP_DEFINITIONS.map((step, index) => ({
      ...step,
      status: index === 0 ? "ERROR" : index === 1 ? "BLOCKED" : "SUCCESS",
    }));

    const markup = renderToStaticMarkup(
      createElement(StepTimeline, {
        steps,
        selectedStepId: "identify",
        onSelect: vi.fn(),
      }),
    );

    expect(markup).toContain("失败");
    expect(markup).toContain("已阻断");
    expect(markup.match(/已完成/g)).toHaveLength(5);
  });

  it("distinguishes insufficient evidence from confidence and severity", () => {
    const diagnosis: Diagnosis = {
      status: "INSUFFICIENT_EVIDENCE",
      summary: "未找到包裹记录",
      reason: "缺少包裹基础数据",
      severity: "LOW",
      evidenceIds: [],
      actions: [
        {
          title: "核对包裹号",
          description: "确认包裹号后重新诊断",
          priority: "P1",
          owner: "仓库操作员",
        },
      ],
      limitations: ["缺少包裹基础数据"],
    };

    const markup = renderToStaticMarkup(
      createElement(DiagnosisPanel, { diagnosis }),
    ).replaceAll("<!-- -->", "");

    expect(markup).toContain("引用 0 条证据");
    expect(markup).toContain("证据不足");
    expect(markup).not.toContain("严重度：低");
    expect(markup).not.toContain("0/4");
  });

  it("shows the identify question and structured result in the existing inspector", () => {
    const identify = {
      ...STEP_DEFINITIONS.find((step) => step.id === "identify")!,
      status: "SUCCESS" as const,
      input: { question: "包裹 PKG-20260918 为什么还没有入库？" },
      output: {
        packageId: "PKG-20260918",
        intent: "WAREHOUSE_INBOUND_DIAGNOSIS",
        normalizedQuestion: "查询包裹 PKG-20260918 尚未完成入库的原因",
      },
    };

    const markup = renderToStaticMarkup(createElement(StepInspector, { step: identify }));

    expect(markup).toContain("PKG-20260918");
    expect(markup).toContain("WAREHOUSE_INBOUND_DIAGNOSIS");
    expect(markup).toContain("查询包裹 PKG-20260918 尚未完成入库的原因");
  });

  it("uses explicit cancellation wording for a cancelled step and trace", () => {
    const cancelled = {
      ...STEP_DEFINITIONS[0],
      status: "CANCELLED" as const,
    };
    const timeline = renderToStaticMarkup(
      createElement(StepTimeline, {
        steps: [cancelled],
        selectedStepId: "identify",
        onSelect: vi.fn(),
      }),
    );
    const error = renderToStaticMarkup(
      createElement(RunError, { title: "诊断已取消", message: "已取消诊断" }),
    );

    expect(timeline).toContain("已取消");
    expect(error).toContain("诊断已取消");
  });
});

const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(element).replaceAll("<!-- -->", "");

describe("trace context and recovery", () => {
  it("keeps the previous trace identity when the draft question and mode change", () => {
    const state = {
      ...createInitialTraceState(), status: "COMPLETED" as const,
      question: "包裹 PKG-20260918 为什么没有入库？", mode: "demo" as const,
    };
    const markup = render(createElement(TraceContext, {
      state, draftMode: "live", draftQuestion: "PKG-404",
    }));
    expect(markup).toContain("上次诊断结果");
    expect(markup).toContain("PKG-20260918");
    expect(markup).toContain("演示回放（Demo）");
    expect(markup).not.toContain("PKG-404");
    expect(markup).not.toContain("模型实时诊断（Live）");
  });

  it("disables both mode controls during a run", () => {
    const markup = render(createElement(ModeControl, {
      mode: "demo", disabled: true, onChange: vi.fn(),
    }));
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it.each(["COMPLETED", "FAILED", "CANCELLED"] as const)("does not promise future progress after %s", (status) => {
    const state = { ...createInitialTraceState(), status };
    const statusMarkup = render(createElement(LiveClock, { state }));
    const evidenceMarkup = render(createElement(EvidenceChain, { evidence: [], status }));
    expect(statusMarkup).not.toContain("等待");
    expect(evidenceMarkup).not.toContain("正在等待");
    expect(evidenceMarkup).not.toContain("4/4");
    expect(evidenceMarkup).toContain("已获得 0 条证据");
  });

  it("explains the actual failed tool, retries, and deterministic demo recovery", () => {
    const state = {
      ...createInitialTraceState(), status: "FAILED" as const, mode: "demo" as const,
      terminationReason: "TOOL_TIMEOUT" as const,
      steps: STEP_DEFINITIONS.map((step) => ({
        ...step, status: step.id === "putaway" ? "ERROR" as const : "BLOCKED" as const,
        attempt: step.id === "putaway" ? 2 : undefined,
      })),
    };
    const markup = render(createElement(RunFeedback, {
      state, canRetry: true, onRetry: vi.fn(), onEdit: vi.fn(),
    }));
    expect(markup).toContain("查询入库任务超时，已自动重试 1 次");
    expect(markup).toContain("重复播放会得到相同结果");
    expect(markup).toContain("选择其他场景");
    expect(markup).not.toContain("get_putaway_task");
    expect(markup).not.toContain("重新诊断");
  });

  it("presents cancellation neutrally with a recovery action", () => {
    const state = { ...createInitialTraceState(), status: "CANCELLED" as const, mode: "live" as const };
    const markup = render(createElement(RunFeedback, {
      state, canRetry: true, onRetry: vi.fn(), onEdit: vi.fn(),
    }));
    expect(markup).toContain('role="status"');
    expect(markup).toContain("已收到的步骤记录已保留");
    expect(markup).toContain("重新诊断");
    expect(markup).not.toContain('role="alert"');
  });

  it("keeps raw output available but collapsed by default", () => {
    const markup = render(createElement(StepInspector, {
      step: { ...STEP_DEFINITIONS[1], status: "SUCCESS", output: { packageId: "PKG-20260918" } },
    }));
    expect(markup).toContain("PKG-20260918");
    expect(markup).toContain("输出数据（Output）");
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
  });

  it("prioritizes recommended actions without claiming evidence completeness", () => {
    const markup = render(createElement(DiagnosisPanel, {
      diagnosis: {
        status: "CONFIRMED", summary: "库位不足", reason: "容量不足", severity: "HIGH",
        evidenceIds: ["EV-1"], limitations: [],
        actions: [
          { title: "后续排查", description: "检查同步", priority: "P2", owner: "运维" },
          { title: "重新分配库位", description: "选择可用库位", priority: "P0", owner: "仓库操作员" },
        ],
      },
    }));
    expect(markup.indexOf("重新分配库位")).toBeLessThan(markup.indexOf("后续排查"));
    expect(markup).toContain("首要建议");
    expect(markup).toContain("需在仓储系统中处理");
    expect(markup).toContain("本次未列出额外限制");
    expect(markup).not.toContain("关键证据完整");
  });
});


describe("demo transport failure", () => {
  it("allows replay after a disconnected stream without claiming the fixture always fails", () => {
    const state = {
      ...createInitialTraceState(), status: "FAILED" as const, mode: "demo" as const,
      terminationReason: "STREAM_DISCONNECTED" as const,
    };
    const markup = render(createElement(RunFeedback, {
      state, canRetry: true, onRetry: vi.fn(), onEdit: vi.fn(),
    }));
    expect(markup).toContain("诊断连接已中断");
    expect(markup).toContain("重新播放");
    expect(markup).not.toContain("固定失败演示");
  });
});
