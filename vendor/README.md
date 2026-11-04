# 模型协议转换依赖

本目录保存运行时所需的第三方 JavaScript 源码子集，随 npm 安装包交付。

- `anyresponses`：来自 [AnyResponses](https://github.com/anyresponses/anyresponses)，提交 `5f1160533f91d97d5932eb4446ed54cf1a216b25`，核心包版本 `0.0.3`，上游包声明 ISC 许可证。保留 OpenAI Chat 请求、响应、SSE 与必要依赖。修订 `src/providers/openai/request.js`、`src/adapters/openai-chat.js` 和 `src/client/openai.js`，支持 Codex 原生工具历史、命名空间、流式参数聚合、并行调用和缓存用量；把 `reasoning_content`、`reasoning` 字段转为原生推理正文和增量事件，保持条目标识、完成记录与历史一致；保留上游错误码，使 Codex 能识别上下文超限；其余代码仅作格式整理。
- `pi-ai`：来自 [pi 的 AI 包](https://github.com/earendil-works/pi/tree/main/packages/ai)，版本 `0.87.1`，MIT 许可证正文见 `pi-ai/LICENSE`。复用 `transcript.js` 与 `text.js` 的系统消息折叠能力，代码仅作格式整理。

上游升级时以服务器的供应商回归检查转换行为，并验证真实 Codex 的工具调用、上下文整理及供应商往返切换。模型历史始终由 Codex 保存；对其他接口的映射只处理发出的请求副本。
