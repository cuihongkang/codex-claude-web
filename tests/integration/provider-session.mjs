import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createWebApplication } from "../../server/src/application.mjs";
import { createAuthentication } from "../../server/src/auth.mjs";
import { readConfig } from "../../server/src/config.mjs";
import { authenticationFixture } from "../helpers/auth.mjs";
import { isolatedCodex } from "./codex-backend.mjs";
import { createPersistentAdapter } from "../../server/src/providers/adapter.mjs";

export async function providerSession(
  onRequest = () => {},
  createApplication = createWebApplication,
  { backendConfig = "", prepareHome = async () => {} } = {},
) {
  const home = await mkdtemp(join(tmpdir(), "codex-web-provider-session-"));
  await prepareHome(home);
  const backend = await isolatedCodex(home, backendConfig);
  let adapter = await createPersistentAdapter({ codexHome: home, port: 0 });
  const adapterPort = adapter.port;
  const auth = await authenticationFixture(home);
  const config = readConfig({
    ...process.env,
    CODEX_HOME: home,
    CODEX_APP_SERVER_URL: backend.url,
    HOST: "127.0.0.1",
    PORT: "0",
    MODEL_ADAPTER_PORT: String(adapterPort),
  });
  const app = createApplication({
    config,
    tls: auth.tls,
    authentication: await createAuthentication(config),
    version: { displayVersion: "3.1.0" },
  });
  const events = [],
    pending = new Map(),
    threads = new Set();
  let sequence = 0;
  let webClosed = false;
  let backendClosed = false;
  await app.start();
  const origin = `https://127.0.0.1:${app.server.address().port}`;
  const socket = new WebSocket(origin.replace("https:", "wss:") + "/rpc", {
    ca: auth.tls.cert,
    headers: { Cookie: auth.cookie, Origin: origin },
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.method) {
      events.push(message);
      if (message.id !== undefined) onRequest(socket, message);
    } else {
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timer);
        message.error
          ? entry.reject(new Error(message.error.message))
          : entry.resolve(message.result);
      }
    }
  });
  async function call(method, params = {}) {
    const result = await new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("请求超时：" + method));
      }, 180000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    if (method === "thread/start" || method === "thread/fork")
      threads.add(result.thread.id);
    return result;
  }
  async function event(method, match, mark = 0) {
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      const value = events
        .slice(mark)
        .find((m) => m.method === method && match(m.params));
      if (value) return value.params;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("事件超时：" + method);
  }
  await event("lan/state", (p) => p.ready);
  return {
    home,
    origin,
    cookie: auth.cookie,
    backendUrl: backend.url,
    call,
    event,
    events,
    async restartAdapter() {
      await adapter.close();
      adapter = await createPersistentAdapter({
        codexHome: home,
        port: adapterPort,
      });
    },
    async stopWeb() {
      if (webClosed) return;
      webClosed = true;
      socket.terminate();
      await app.close();
    },
    async stopBackend() {
      if (backendClosed) return;
      backendClosed = true;
      await backend.close();
    },
    async turn(threadId, text, selection = {}) {
      const mark = events.length;
      const start = await call("turn/start", {
        threadId,
        ...selection,
        input: [{ type: "text", text }],
      });
      const end = await event(
        "turn/completed",
        (p) => p.threadId === threadId && p.turn.id === start.turn.id,
        mark,
      );
      if (end.turn.status !== "completed")
        throw new Error(JSON.stringify(end.turn.error)?.slice(0, 2000));
      return events.slice(mark);
    },
    async close() {
      for (const threadId of webClosed ? [] : threads) {
        try {
          await call("thread/archive", { threadId });
        } catch {}
      }
      await this.stopWeb();
      await this.stopBackend();
      await adapter.close();
      await rm(home, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}
