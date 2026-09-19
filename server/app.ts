import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeepSeekGateway, type ModelGateway } from "./model.js";
import { runDiagnosis } from "./orchestrator.js";
import { validateDiagnosisRequest } from "./request-validation.js";
import {
  createSseSender,
  finishSseResponse,
  prepareSseResponse,
} from "./sse.js";
import { createWarehouseTools, type ToolRegistry } from "./tools.js";

export interface AppDependencies {
  createModel?: () => ModelGateway;
  tools?: ToolRegistry;
  minimumStepMs?: number;
}

const modelFromEnvironment = () => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "缺少 DEEPSEEK_API_KEY。请复制 .env.example 为 .env，并配置你自己的 DeepSeek Key。",
    );
  }
  return new DeepSeekGateway({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
  });
};

export const createApp = (dependencies: AppDependencies = {}) => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      modelConfigured: Boolean(
        dependencies.createModel || process.env.DEEPSEEK_API_KEY?.trim(),
      ),
    });
  });

  app.post("/api/diagnoses/stream", async (request, response) => {
    const validation = validateDiagnosisRequest(request.body);
    if (!validation.ok) {
      response.status(400).json({ error: validation.error });
      return;
    }
    const { question, packageId } = validation.value;

    let model: ModelGateway;
    try {
      model = dependencies.createModel?.() ?? modelFromEnvironment();
    } catch (error) {
      response.status(503).json({
        error: error instanceof Error ? error.message : "模型配置不可用",
      });
      return;
    }

    prepareSseResponse(response);
    const send = createSseSender(response);

    await runDiagnosis({
      question,
      packageId,
      model,
      tools: dependencies.tools ?? createWarehouseTools(),
      emit: send,
      minimumStepMs: dependencies.minimumStepMs,
    });

    finishSseResponse(response);
  });

  if (process.env.NODE_ENV === "production") {
    const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
    const staticDirectory = path.resolve(currentDirectory, "../../dist");
    app.use(express.static(staticDirectory));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(path.join(staticDirectory, "index.html"));
    });
  }

  return app;
};
