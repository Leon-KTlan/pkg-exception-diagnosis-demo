import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App, { SCENARIO_QUESTIONS } from "./App";

describe("diagnosis entry", () => {
  it("offers supported scenarios before playback and explains the data boundary", () => {
    const markup = renderToStaticMarkup(createElement(App));
    expect(markup).toContain("演示回放（Demo）");
    expect(markup).toContain("模型实时诊断（Live）");
    expect(markup).toContain("两种模式均使用虚构的演示仓储数据");
    expect(markup).toContain("播放演示");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain("等待上游");
    for (const scenario of SCENARIO_QUESTIONS) {
      expect(markup).toContain(scenario.label);
      expect(markup).toContain(scenario.packageId);
    }
  });
});
