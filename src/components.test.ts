import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { STEP_DEFINITIONS, type Diagnosis, type StepView } from "../shared/protocol";
import { DiagnosisPanel, RunError, StepInspector, StepTimeline, TraceMeta } from "./components";
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
    expect(markup).toContain("模拟数据");
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
    expect(markup).toContain("实时诊断");
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

  it("uses the four expected evidence slots for an empty-data diagnosis", () => {
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
      createElement(DiagnosisPanel, { diagnosis, evidence: [] }),
    ).replaceAll("<!-- -->", "");

    expect(markup).toContain("证据：0/4");
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
