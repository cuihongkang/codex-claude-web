import { createInterface } from "node:readline";
import { createUpstream } from "./upstream.mjs";
import { readThreadTool, readReferenceThread } from "./reference-tools.mjs";
import { readVersion } from "../../version.mjs";

const version = readVersion();
let completeConnection;
const connected = new Promise((resolve) => {
  completeConnection = resolve;
});
let initializationTimer;
const transport = createUpstream({
  config: { upstreamUrl: process.env.CLAUDEX_REFERENCE_UPSTREAM },
  version,
  send() {},
  onReady() {
    completeConnection();
  },
  onEvent() {},
  onResponse() {},
  onSettled() {},
  onDisconnect() {},
});
transport.connect();
const input = createInterface({ input: process.stdin });
function reply(id, result, error) {
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      ...(error ? { error } : { result }),
    }) + "\n",
  );
}
async function handle(message) {
  if (message.id === undefined) return;
  const { id, method, params = {} } = message;
  try {
    if (method === "initialize") {
      try {
        await Promise.race([
          connected,
          new Promise((_, reject) => {
            initializationTimer = setTimeout(
              () => reject(new Error("连接 Codex 后端超时。")),
              12000,
            );
          }),
        ]);
      } finally {
        clearTimeout(initializationTimer);
      }
      return reply(id, {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "claudex-references", version: version.version },
      });
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") return reply(id, { tools: [readThreadTool] });
    if (method !== "tools/call")
      return reply(id, null, { code: -32601, message: "不支持此 MCP 方法" });
    if (params.name !== readThreadTool.name) throw new Error("不支持此工具。");
    if (!transport.ready)
      throw new Error("Codex 后端尚未就绪，请重试读取引用。");
    const result = await readReferenceThread(
      (method, args) => transport.call(method, args, { trackThread: false }),
      params.arguments,
    );
    reply(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
  } catch (error) {
    if (method !== "tools/call")
      return reply(id, null, { code: -32000, message: error.message });
    reply(id, {
      isError: true,
      content: [{ type: "text", text: error.message }],
    });
  }
}
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    reply(null, null, { code: -32700, message: "无效的 JSON" });
    return;
  }
  handle(message).catch((error) => console.error(error.message));
});
input.on("close", () => {
  clearTimeout(initializationTimer);
  transport.close();
});
process.on("SIGTERM", () => {
  input.close();
  transport.close();
});
