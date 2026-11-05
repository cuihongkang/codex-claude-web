import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { normalizeChatMessages, streamChat } from "./chat-adapter.mjs";
import { MAX_RPC_MESSAGE_BYTES } from "../rpc-transport.mjs";
import { portableInput } from "./context-summary.mjs";
import { fetchDeferredChat } from "./deferred-chat.mjs";

export function createModelGateway(registry, options = {}) {
  const token = options.token || randomBytes(32).toString("hex");
  let base;
  const controllers = new Set();
  const server = createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization || "");
    const expected = Buffer.from("Bearer " + token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      response.writeHead(401).end();
      return;
    }
    if (request.method === "GET" && request.url === "/healthz") {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ready: true }));
      return;
    }
    const match =
      /^\/([^/]+)\/v1\/(responses(?:\/compact)?|chat\/completions)$/.exec(
        request.url,
      );
    if (request.method !== "POST" || !match) {
      response.writeHead(404).end();
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    response.on("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const provider = await registry.get(match[1]);
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_RPC_MESSAGE_BYTES)
          throw new Error("模型请求超过 64 MiB");
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks));
      if (Array.isArray(input.input)) {
        const compacted = input.input.findLast((item) =>
          ["compaction", "context_compaction"].includes(item.type),
        );
        const threadId =
          request.headers["thread-id"] || request.headers["session_id"];
        const summary =
          compacted &&
          options.context &&
          (await options.context.read(threadId, compacted));
        input.input = portableInput(input.input, summary);
      }
      if (Array.isArray(input.input))
        input.input = input.input.filter(
          (item) => item.type !== "reasoning" || !item.encrypted_content,
        );
      const model = provider.models.find((m) => m.id === input.model);
      if (!model) {
        response.writeHead(400, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            error: { message: "供应商未配置此模型：" + input.model },
          }),
        );
        return;
      }
      if (provider.protocol === "chat" && match[2] === "responses") {
        await streamChat({
          input,
          provider,
          model,
          token,
          signal: controller.signal,
          response,
          captureUrl: base + "/" + provider.id + "/v1/chat/completions",
        });
        return;
      }
      if (provider.protocol === "chat" && match[2] !== "chat/completions")
        throw new Error("此模型通过对话摘要整理上下文");
      if (provider.protocol === "chat")
        input.messages = normalizeChatMessages(input.messages);
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey && {
            Authorization: "Bearer " + provider.apiKey,
          }),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      };
      const upstream =
        provider.protocol === "chat"
          ? await fetchDeferredChat(
              provider.baseUrl + "/" + match[2],
              input,
              options,
            )
          : await fetch(provider.baseUrl + "/" + match[2], options);
      response.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      });
      for await (const chunk of upstream.body) {
        if (response.destroyed) break;
        if (!response.write(Buffer.from(chunk)))
          await once(response, "drain", { signal: controller.signal });
      }
      response.end();
    } catch (error) {
      if (!response.headersSent)
        response.writeHead(502, { "Content-Type": "application/json" });
      if (!response.destroyed)
        response.end(JSON.stringify({ error: { message: error.message } }));
    } finally {
      controllers.delete(controller);
    }
  });
  server.requestTimeout = 0;
  return {
    token,
    get port() {
      return server.address()?.port;
    },
    url(id) {
      if (!base) throw new Error("模型网关尚未启动");
      return base + "/" + id + "/v1";
    },
    async start() {
      server.listen(options.port ?? 0, "127.0.0.1");
      await once(server, "listening");
      base = "http://127.0.0.1:" + server.address().port;
    },
    async close() {
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
    },
  };
}
