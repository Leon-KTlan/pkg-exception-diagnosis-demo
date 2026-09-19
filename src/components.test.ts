import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { STEP_DEFINITIONS, type Diagnosis, type StepView } from "../shared/protocol";
import { DiagnosisPanel, StepInspector, StepTimeline } from "./components";

describe("diagnosis presentation", () => {
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
});
