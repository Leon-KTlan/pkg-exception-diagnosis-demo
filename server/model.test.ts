import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekGateway } from "./model.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeepSeekGateway", () => {
  it("disables thinking mode so required tool choices remain supported", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  packageId: "PKG-20260918",
                  intent: "WAREHOUSE_INBOUND_DIAGNOSIS",
                  normalizedQuestion: "包裹 PKG-20260918 为什么还没有入库？",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const gateway = new DeepSeekGateway({
      apiKey: "sk-test-only",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
    });

    await gateway.identify("包裹 PKG-20260918 为什么还没有入库？");

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "deepseek-flash",
      temperature: 0,
      thinking: { type: "disabled" },
    });
  });

  it("constrains empty-evidence diagnoses to a valid low severity result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
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
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const gateway = new DeepSeekGateway({
      apiKey: "sk-test-only",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
    });

    await gateway.composeDiagnosis(
      { question: "包裹 PKG-404 为什么还没有入库？", packageId: "PKG-404" },
      [],
      "severity 不合法",
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0].content).toContain(
      "allowedEvidence 为空时，status 必须为 INSUFFICIENT_EVIDENCE、severity 必须为 LOW",
    );
    expect(JSON.parse(body.messages[1].content)).toMatchObject({
      allowedEvidence: [],
      validationError: "severity 不合法",
    });
  });
});
