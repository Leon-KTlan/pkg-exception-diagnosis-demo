import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App, { DEFAULT_QUESTION, SCENARIO_QUESTIONS } from "./App";

describe("diagnosis question scenarios", () => {
  it("starts in Demo mode with an explicit authenticity boundary", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain("Demo · 模拟数据");
    expect(markup).toContain("Live · 真实诊断");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("uses a complete natural-language question as the default", () => {
    expect(DEFAULT_QUESTION).toBe("包裹 PKG-20260918 为什么还没有入库？");
  });

  it("uses complete questions for every shortcut", () => {
    expect(SCENARIO_QUESTIONS).toEqual([
      { question: "包裹 PKG-20260918 为什么还没有入库？", label: "正常场景" },
      { question: "帮我看看包裹 PKG-404 为什么还没入库", label: "空数据" },
      { question: "帮我看看包裹 PKG-TIMEOUT 为什么还没入库", label: "工具超时" },
    ]);
    expect(SCENARIO_QUESTIONS.every((scenario) => scenario.question.includes("包裹"))).toBe(true);
  });
});
