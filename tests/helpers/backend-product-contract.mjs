import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { createCodexAdapter } from "../../server/src/backends/codex/adapter.mjs";
import { createClaudeAdapter } from "../../server/src/backends/claude/adapter.mjs";
import { readConfig } from "../../server/src/config.mjs";

// 使用真实适配器、模拟 app-server；Claude 仅检查进程版本，不提交模型请求。
export async function backendProductFixture(t, backendId) {
  const root = await mkdtemp(join(tmpdir(), "backend-product-contract-"));
  const config = readConfig({
    CODEX_HOME: join(root, "codex"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    CLAUDEX_WEB_CONFIG_DIR: join(root, "web"),
    DEFAULT_CWD: root,
  });
  const stateDir = join(config.configDir, "backends", "claude");
  const projectDirectory = backendId === "codex" ? config.configDir : stateDir;
  const existingDirectory =
    backendId === "codex" ? join(config.codexHome, "codex-web") : stateDir;
  await mkdir(existingDirectory, { recursive: true });
  const existingProjects = { [root]: { model: "saved-model", effort: "high" } };
  await writeFile(
    join(existingDirectory, "project-models.json"),
    JSON.stringify(existingProjects),
  );
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(stateDir, "claudex-web-index.json"),
    JSON.stringify({
      sessions: {
        thread: {
          id: "thread",
          cwd: root,
          initialized: false,
          turns: {},
          queue: [],
          compaction: { id: "compact", status: "reconnecting" },
        },
      },
    }),
  );
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  let upstream;
  const requests = [],
    events = [];
  server.on("connection", (socket) => {
    upstream = socket;
    socket.on("message", (bytes) => {
      const message = JSON.parse(bytes);
      requests.push(message);
      if (message.id === undefined) return;
      socket.send(
        JSON.stringify({
          id: message.id,
          result:
            message.method === "thread/resume"
              ? {
                  thread: {
                    id: message.params.threadId,
                    status: { type: "idle" },
                  },
                }
              : {},
        }),
      );
    });
  });
  const adapter = (
    backendId === "codex" ? createCodexAdapter : createClaudeAdapter
  )({
    config,
    backend: {
      id: backendId,
      url: `ws://127.0.0.1:${server.address().port}`,
      dataDir: backendId === "codex" ? config.codexHome : config.claudeHome,
      stateDir,
      executable: process.execPath,
    },
    version: { displayVersion: "contract-test" },
    providers: { get: async () => null, list: async () => [] },
    send: (client, message) => client.deliver(message),
    broadcast: (message) => events.push(message),
  });
  t.after(async () => {
    adapter.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  let sequence = 0;
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      Promise.resolve(
        adapter.receive(
          {
            readyState: 1,
            deliver: (message) =>
              message.error
                ? reject(new Error(message.error.message))
                : resolve(message.result),
          },
          { id: ++sequence, method, params },
        ),
      ).catch(reject);
    });
  return {
    root,
    config,
    adapter,
    events,
    requests,
    call,
    projectDirectory,
    existingProjects,
    async connect() {
      const ready = new Promise((resolve) => {
        const poll = setInterval(() => {
          if (adapter.ready) {
            clearInterval(poll);
            resolve();
          }
        }, 5);
        t.after(() => clearInterval(poll));
      });
      await adapter.connect();
      await ready;
    },
    notify(method, params) {
      upstream.send(JSON.stringify({ method, params }));
    },
  };
}
