import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const app = createApp();

app.listen(port, "0.0.0.0", () => {
  console.log(`入库诊断台 Agent 服务已启动：http://0.0.0.0:${port}`);
});
