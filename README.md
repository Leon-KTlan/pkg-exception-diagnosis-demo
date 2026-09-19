# 入库诊断台

一个可本地运行的仓储异常诊断 Agent Demo。用户输入包裹号后，页面通过 SSE 实时展示 Agent 的意图识别、Tool Calling、错误重试、证据链生成和最终诊断。

![入库诊断台完成态](docs/screenshots/completed-state.png)

## Demo / Preview

<p align="center">
  <img src="docs/assets/demo-mode.gif" alt="Demo Mode 完整诊断流程" width="1100" />
</p>

上面的 GIF 展示的是 **Demo Mode**：页面使用模拟数据和固定、确定性的 SSE replay，不调用真实模型、真实仓储 tools 或外部服务。它只是项目展示材料，不是功能正确性的自动化证明。

页面默认进入 Demo Mode，可直接回放以下三个固定场景：

- `PKG-20260918`：完整成功诊断
- `PKG-404`：数据不足 / 证据不足
- `PKG-TIMEOUT`：工具超时、重试后失败

只有主动切换到 `Live · 真实诊断` 后，页面才会运行现有的真实诊断链路，并使用模型和仓储工具。

## 3 分钟体验

### 1. 先体验 Demo Mode（无需模型 Key）

Demo Mode 默认启动，不依赖模型 Key：

```bash
docker compose up --build
```

打开 [http://localhost:5173](http://localhost:5173)，保留默认问题并点击“开始诊断”。

### 2. 如需体验 Live Mode，再配置 DeepSeek

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env`，填入你自己的 DeepSeek Key：

```dotenv
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
```

真实 Key 不应提交到 Git，也不会被发送到浏览器。

### 3. 体验三个 Demo 场景

| 包裹号 | 场景 | 预期结果 |
| --- | --- | --- |
| `PKG-20260918` | 完整异常链路 | 收货完成，但入库任务因目标库位容量不足被阻塞 |
| `PKG-404` | 业务空数据 | 包裹查询成功但无记录，下游步骤阻断，证据不足 |
| `PKG-TIMEOUT` | 系统错误 | 入库任务查询超时，自动重试一次后失败 |

## 本地开发

要求 Node.js 22 LTS 或更高版本。

```bash
npm install --legacy-peer-deps
npm run dev
```

- Web：[http://localhost:5173](http://localhost:5173)
- Agent 服务：[http://localhost:8787](http://localhost:8787)
- 健康检查：[http://localhost:8787/api/health](http://localhost:8787/api/health)

## 架构

页面默认通过 `POST /api/demo/diagnoses/stream` 回放固定 Demo fixture；切换到 Live 后，才通过 `POST /api/diagnoses/stream` 进入真实模型、工具和编排链路。

```mermaid
flowchart LR
    U[仓库运营人员] -->|包裹问题| W[React 诊断工作区]
    W -->|Demo: 固定 SSE replay| R[Demo Replay]
    W -->|Live: POST /api/diagnoses/stream| A[Node Agent 编排器]
    R -->|共享领域 SSE| W
    A -->|Tool Calling| D[DeepSeek API]
    D -->|工具选择与诊断| A
    A --> P[get_package]
    A --> R[get_receipt]
    A --> T[get_putaway_task]
    P & R & T -->|Mock 仓储数据| A
    A -->|语义 SSE 事件| W
    A -->|合法 evidenceId| E[证据链与最终诊断]
```

DeepSeek 负责意图识别、下一工具选择、异常分析和最终诊断；Node 编排器负责最大步数、工具参数约束、自动重试、证据完整性和结构化输出校验。模型只能引用代码从 Tool Output 中生成的 `evidenceId`。

## Agent 状态

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> RUNNING
    RUNNING --> SUCCESS
    RUNNING --> RETRYING: 可恢复的工具超时
    RETRYING --> RUNNING: 自动重试一次
    RETRYING --> ERROR: 第二次仍失败
    ERROR --> BLOCKED: 阻断依赖步骤
    RUNNING --> CANCELLED: 用户主动取消
    SUCCESS --> [*]
    BLOCKED --> [*]
    CANCELLED --> [*]
```

七个稳定业务步骤：

1. 识别问题
2. 查询包裹
3. 查询收货单
4. 查询入库任务
5. 发现异常
6. 生成证据链
7. 最终诊断

查询步骤标记为 `TOOL_CALL`，内部处理步骤标记为 `AGENT_NODE`。每一步统一展示 Tool Name、Input、Output、Status 和 Duration。

## Streaming 协议

服务端不把供应商原始数据包直接暴露给前端，而是发送稳定的领域事件：

```text
trace.started
step.started
tool.call.started
tool.call.completed
step.completed
step.retrying
step.failed
trace.completed
trace.failed
trace.cancelled
```

每条事件包含 `traceId`、单调递增的 `sequence`、`timestamp`、`stepId`、`type` 和 `payload`。`trace.started` 还会标记 `mode` 与 `simulated`，用于区分 Demo 和 Live 的数据来源。客户端按 `sequence` 幂等地更新状态，并结合 generation/traceId 防止旧运行污染当前 Trace。

## 可靠性与取消

- 运行中显示“取消诊断”。用户取消会立即 abort 当前 Fetch、失效 run generation，并将未完成步骤收敛为 `CANCELLED`；已收到的 Trace 保留。
- SSE 在没有收到 `trace.completed`、`trace.failed` 或 `trace.cancelled` 时提前 EOF，会被识别为异常断流，不会继续停留在 `RUNNING`。
- 客户端连续 30 秒没有领域事件，或整体运行超过 120 秒，会 abort 请求并以明确原因结束。
- Live 服务端对单次模型调用、单次工具调用和整体诊断分别设置 25 秒、10 秒和 110 秒 deadline，并尽量将客户端断开传播到编排器、模型和工具。
- 每次诊断最终只能是 `COMPLETED`、`FAILED` 或 `CANCELLED`。客户端断流、客户端 timeout、模型 timeout、工具 timeout 和整体 deadline 都进入 `FAILED`，并记录结构化终止原因。
- 不使用 SSE heartbeat、独立取消 endpoint、断线续传或自动重试整个诊断。

## 安全与真实性

- DeepSeek Key 只由 Node 服务读取，不进入 Vite 构建参数或浏览器请求。
- Demo Mode 是显式选择的固定 SSE replay，不是 Live 失败后的自动降级；Live 失败时不会自动切换到 Demo。
- Demo fixture 中的工具事件只是模拟调用；只有 Live 模式才会真正执行仓储工具。
- Live 模式使用真实模型和仓储工具，数据为完全虚构的本地演示数据。
- 证据链只能来自成功的 Tool Output。
- 模型返回不存在的证据 ID 时会得到一次纠正机会，再次失败则终止 Trace。
- 页面不展示模型思考过程、完整 Prompt 或 API Key。

## 测试

```bash
npm test
npm run build
```

自动化测试从最高层 HTTP/SSE 边界覆盖：

- 正常诊断的有序事件流和完整证据引用
- 业务空数据与系统故障的语义区分
- 工具超时只自动重试一次
- 非法证据引用被拒绝
- 客户端忽略重复或过期事件
- `BLOCKED` 状态可见且不会被误判为成功
- Demo 三个 fixture 的确定性 SSE replay、模式 metadata 和错误边界
- Demo/Live endpoint 选择、traceId 隔离与旧事件丢弃

## 项目结构

```text
src/        React 页面、组件、SSE 客户端与状态更新
server/     Agent 编排、DeepSeek 适配、Mock 工具、Demo replay 与 API
shared/     前后端共享的事件和诊断协议
docs/       Agent 配置、演示截图与 Demo GIF
```

## 明确的非目标

本 Demo 不接入真实 WMS、数据库、登录权限、多用户并发、Trace 持久化、断线续传、多模型路由或完整移动端设计。它聚焦于一个可审阅、可运行、可追溯的仓储 Agent 诊断链路。
