import { extractPackageIds } from "./package-id.js";

export interface DiagnosisRequest {
  question: string;
  packageId: string;
}

export type DiagnosisRequestValidation =
  | { ok: true; value: DiagnosisRequest }
  | { ok: false; error: string };

export const validateDiagnosisRequest = (
  body: unknown,
): DiagnosisRequestValidation => {
  const rawQuestion = (body as { question?: unknown } | null | undefined)?.question;
  if (typeof rawQuestion !== "string") {
    return { ok: false, error: "问题必须是字符串" };
  }

  const question = rawQuestion.trim();
  if (!question) {
    return { ok: false, error: "问题不能为空" };
  }
  if (Array.from(question).length > 500) {
    return { ok: false, error: "问题长度不能超过500个Unicode字符" };
  }

  const packageIds = extractPackageIds(question);
  if (packageIds.length === 0) {
    return { ok: false, error: "请补充包裹号" };
  }
  if (packageIds.length > 1) {
    return { ok: false, error: "一次只能诊断一个包裹" };
  }

  return {
    ok: true,
    value: {
      question,
      packageId: packageIds[0],
    },
  };
};
