import type { Diagnosis, Evidence, Severity } from "../shared/protocol.js";
import type {
  PackageRecord,
  PutawayTaskRecord,
  ReceiptRecord,
  WarehouseTool,
} from "./tools.js";

export interface IntentResult {
  packageId: string;
  intent: "WAREHOUSE_INBOUND_DIAGNOSIS";
  normalizedQuestion: string;
}

export interface AnomalyResult {
  found: boolean;
  reasonCode: string;
  reason: string;
  severity: Severity;
}

export interface AgentContext {
  question: string;
  packageId: string;
  packageRecord?: PackageRecord | null;
  receiptRecord?: ReceiptRecord | null;
  putawayTaskRecord?: PutawayTaskRecord | null;
  anomaly?: AnomalyResult;
}

export interface SelectedTool {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelGateway {
  readonly modelName: string;
  readonly tokenUsage: number;
  identify(question: string, expectedPackageId?: string): Promise<IntentResult>;
  selectTool(context: AgentContext, eligibleTools: WarehouseTool[]): Promise<SelectedTool>;
  detectAnomaly(context: AgentContext): Promise<AnomalyResult>;
  composeDiagnosis(
    context: AgentContext,
    evidence: Evidence[],
    validationError?: string,
  ): Promise<Diagnosis>;
}

interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

const stripCodeFence = (value: string) =>
  value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

const parseJson = <T>(value: string | null | undefined, label: string): T => {
  if (!value) {
    throw new Error(`${label} 未返回内容`);
  }

  try {
    return JSON.parse(stripCodeFence(value)) as T;
  } catch {
    throw new Error(`${label} 返回了无效 JSON`);
  }
};

export class DeepSeekGateway implements ModelGateway {
  readonly modelName: string;
  private readonly config: DeepSeekConfig;
  private consumedTokens = 0;

  constructor(config: DeepSeekConfig) {
    this.config = config;
    this.modelName = config.model;
  }

  get tokenUsage() {
    return this.consumedTokens;
  }

  private async complete(body: Record<string, unknown>) {
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          thinking: { type: "disabled" },
          ...body,
        }),
      },
    );

    const result = (await response.json()) as ChatCompletionResponse;
    if (!response.ok) {
      throw new Error(result.error?.message ?? `DeepSeek 请求失败 (${response.status})`);
    }

    this.consumedTokens += result.usage?.total_tokens ?? 0;
    const message = result.choices?.[0]?.message;
    if (!message) {
      throw new Error("DeepSeek 未返回有效消息");
    }
    return message;
  }

  async identify(question: string, expectedPackageId?: string) {
    const packageIdInstruction = expectedPackageId
      ? `服务端已从用户问题中确定唯一包裹号为 ${expectedPackageId}。packageId 必须输出该值；normalizedQuestion 必须原样保留该包裹号，包括连字符和大小写，只规范化其他问题文字。`
      : "必须原样保留用户问题中的包裹号，包括连字符和大小写。";
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `你是仓储异常诊断路由器。只输出 JSON，字段为 packageId、intent、normalizedQuestion。intent 必须是 WAREHOUSE_INBOUND_DIAGNOSIS。不得补造用户没有提供的包裹号。${packageIdInstruction}`,
      },
      { role: "user", content: question },
    ];
    const message = await this.complete({
      messages,
      response_format: { type: "json_object" },
    });
    return parseJson<IntentResult>(message.content, "意图识别");
  }

  async selectTool(context: AgentContext, eligibleTools: WarehouseTool[]) {
    const contextSnapshot = JSON.stringify(context, null, 2);
    const message = await this.complete({
      messages: [
        {
          role: "system",
          content:
            "你是仓储诊断 Agent。根据已有事实选择下一项必要工具。必须调用提供的工具，不得猜测参数，不得使用上下文中不存在的关联单号。",
        },
        {
          role: "user",
          content: `用户问题与当前事实：\n${contextSnapshot}`,
        },
      ],
      tools: eligibleTools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: "required",
    });

    const call = message.tool_calls?.[0]?.function;
    if (!call?.name) {
      throw new Error("DeepSeek 没有选择下一工具");
    }

    return {
      name: call.name,
      arguments: parseJson<Record<string, unknown>>(call.arguments, "工具参数"),
    };
  }

  async detectAnomaly(context: AgentContext) {
    const message = await this.complete({
      messages: [
        {
          role: "system",
          content:
            "你是仓储异常分析器。只能依据输入事实判断。只输出 JSON：found(boolean)、reasonCode(string)、reason(string)、severity(LOW|MEDIUM|HIGH)。",
        },
        {
          role: "user",
          content: JSON.stringify(context, null, 2),
        },
      ],
      response_format: { type: "json_object" },
    });
    return parseJson<AnomalyResult>(message.content, "异常分析");
  }

  async composeDiagnosis(
    context: AgentContext,
    evidence: Evidence[],
    validationError?: string,
  ) {
    const message = await this.complete({
      messages: [
        {
          role: "system",
          content:
            "你是仓储异常诊断专家。只输出 JSON，字段为 status、summary、reason、severity、evidenceIds、actions、limitations。status 只能是 CONFIRMED 或 INSUFFICIENT_EVIDENCE；severity 只能是 LOW、MEDIUM 或 HIGH，禁止使用 NONE、UNKNOWN 等其他值；actions 每项必须包含 title、description、priority(P0|P1|P2)、owner。只能引用输入中存在的 evidenceId。当 allowedEvidence 为空时，status 必须为 INSUFFICIENT_EVIDENCE、severity 必须为 LOW、evidenceIds 必须为空数组。若 validationError 非空，必须按照错误信息修正结果。所有自然语言使用中文。",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              context,
              allowedEvidence: evidence,
              validationError: validationError ?? null,
            },
            null,
            2,
          ),
        },
      ],
      response_format: { type: "json_object" },
    });
    return parseJson<Diagnosis>(message.content, "最终诊断");
  }
}
