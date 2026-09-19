import { describe, expect, it } from "vitest";
import { validateDiagnosisRequest } from "./request-validation.js";

describe("validateDiagnosisRequest", () => {
  it("trims the question and returns one canonical package ID", () => {
    expect(
      validateDiagnosisRequest({
        question: "  请查看（pkg-20260918），为什么还没入库？  ",
      }),
    ).toEqual({
      ok: true,
      value: {
        question: "请查看（pkg-20260918），为什么还没入库？",
        packageId: "PKG-20260918",
      },
    });
  });

  it.each([
    [{}, "问题必须是字符串"],
    [{ question: 123 }, "问题必须是字符串"],
    [{ question: "   " }, "问题不能为空"],
    [{ question: "为什么我的包裹还没有入库？" }, "请补充包裹号"],
    [{ question: "帮我看看 PKG-123 和 PKG-456 为什么都没入库" }, "一次只能诊断一个包裹"],
  ])("preserves the existing rejection for %j", (body, error) => {
    expect(validateDiagnosisRequest(body)).toEqual({ ok: false, error });
  });

  it("uses Unicode characters for the existing 500-character limit", () => {
    const packageId = "PKG-20260918";
    const accepted = `${"啊".repeat(500 - Array.from(packageId).length)}${packageId}`;
    const rejected = `${accepted}啊`;

    expect(validateDiagnosisRequest({ question: accepted })).toMatchObject({ ok: true });
    expect(validateDiagnosisRequest({ question: rejected })).toEqual({
      ok: false,
      error: "问题长度不能超过500个Unicode字符",
    });
  });
});
