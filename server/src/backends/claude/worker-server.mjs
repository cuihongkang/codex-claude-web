import net from "node:net";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  chmod,
  lstat,
  unlink,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createClaudeAdapter } from "./adapter.mjs";
import { createBackendConfiguration } from "../configuration.mjs";
import { createProviders } from "../providers.mjs";
import { workerRevision } from "./worker-revision.mjs";
import { hasBackendWork } from "../../../../shared/backend-activity.mjs";
import {
  prepareWorkerDirectory,
  verifyWorkerSocket,
} from "./worker-location.mjs";

const [socketPath, dataDir, environmentPath] = process.argv.slice(2);
if (!socketPath || !dataDir)
  throw new Error("Claude worker requires a socket and data directory");
process.umask(0o077);
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await prepareWorkerDirectory(dirname(socketPath));
const optionsPath = join(dataDir, "worker-options.json");
const clients = new Set();
const revision = await workerRevision();
let adapter;
let options;
let initializing;
let closing = false;
let inflight = 0;
let stopping = false;
async function currentState() {
  let sessions = {};
  try {
    sessions = JSON.parse(
      await readFile(join(dataDir, "claudex-web-index.json"), "utf8"),
    ).sessions;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const state = adapter.state();
  return {
    ...state,
    params: {
      ...state.params,
      backgroundTasks: Object.fromEntries(
        Object.entries(sessions)
          .map(([id, session]) => [
            id,
            Object.values(session.backgroundTasks || {}).filter((task) =>
              ["running", "pending", "unknown"].includes(task.status),
            ),
          ])
          .filter(([, tasks]) => tasks.length),
      ),
      queuedInputs: Object.fromEntries(
        Object.entries(sessions)
          .filter(([, session]) => session.queue?.length)
          .map(([id, session]) => [id, session.queue.length]),
      ),
    },
  };
}
async function isBusy() {
  const { params } = await currentState();
  return Boolean(inflight || hasBackendWork(params));
}
function send(socket, value) {
  if (!socket.destroyed) socket.write(JSON.stringify(value) + "\n");
}
function broadcast(message) {
  if (message.method !== "lan/state")
    for (const socket of clients)
      if (socket.initialized) send(socket, { kind: "event", message });
  if (message.method === "lan/state" || !/delta$/i.test(message.method))
    queueMicrotask(() => {
      if (adapter)
        for (const socket of clients)
          if (socket.initialized)
            currentState()
              .then((message) => send(socket, { kind: "state", message }))
              .catch((error) =>
                send(socket, { kind: "error", error: error.message }),
              );
    });
}
async function initialize(value) {
  if (initializing) {
    await initializing;
  }
  if (adapter) {
    if (
      resolve(value.backend.stateDir) !== resolve(dataDir) ||
      value.backend.id !== "claude"
    )
      throw new Error("Claude 后端目录或标识不匹配");
    return;
  }
  initializing = (async () => {
    if (
      resolve(value.backend.stateDir) !== resolve(dataDir) ||
      value.backend.id !== "claude"
    )
      throw new Error("Claude 后端目录或标识不匹配");
    options = { ...value, revision, preferredEntry: revision.entry };
    Object.assign(process.env, value.runtimeEnv || {});
    const temporary = `${optionsPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(options), { mode: 0o600 });
    await rename(temporary, optionsPath);
    const providers = createProviders(createBackendConfiguration(value.config));
    adapter = createClaudeAdapter({
      ...value,
      providers,
      send: (client, message) => client.deliver(message),
      broadcast,
      workspace: { handles: () => false, snapshot: () => ({}) },
    });
    await adapter.connect();
  })();
  try {
    await initializing;
  } finally {
    initializing = null;
  }
}
const server = net.createServer((socket) => {
  clients.add(socket);
  let input = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    input += chunk;
    if (Buffer.byteLength(input) > 128 * 1024 * 1024)
      return socket.destroy(new Error("Claude IPC 请求超过限制"));
    let index;
    while ((index = input.indexOf("\n")) >= 0) {
      const line = input.slice(0, index);
      input = input.slice(index + 1);
      handle(socket, line).catch((error) =>
        send(socket, { kind: "error", error: error.message }),
      );
    }
  });
  socket.on("error", () => {});
  socket.on("close", () => clients.delete(socket));
});
async function handle(socket, line) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.kind === "initialize") {
      await initialize(request.options);
      socket.initialized = true;
      send(socket, {
        kind: "response",
        id: request.id,
        result: {
          pid: process.pid,
          state: await currentState(),
          revision,
          busy: await isBusy(),
          configuration: {
            backend: options.backend,
            config: options.config,
            runtimeEnv: options.runtimeEnv || {},
          },
          generation: options.generation,
        },
      });
      return;
    }
    if (!socket.initialized) throw new Error("Claude IPC 尚未初始化");
    if (request.kind === "state")
      return send(socket, {
        kind: "response",
        id: request.id,
        result: await currentState(),
      });
    if (request.kind === "release") {
      adapter.releaseUnusedThreads();
      return;
    }
    if (request.kind === "shutdown") {
      if (stopping) throw new Error("Claude 后端正在停止。");
      stopping = true;
      if (await isBusy()) {
        stopping = false;
        throw new Error(
          "Claude 后端仍有运行任务、排队输入或待答提问，请结束后再停止。",
        );
      }
      if (request.replacement) {
        if (
          resolve(request.replacement.backend.stateDir) !== resolve(dataDir)
        ) {
          stopping = false;
          throw new Error("Claude 更新目录不匹配");
        }
        const temporary = `${optionsPath}.${process.pid}.tmp`;
        await writeFile(
          temporary,
          JSON.stringify({
            ...request.replacement,
            preferredEntry: request.replacement.revision.entry,
          }),
          { mode: 0o600 },
        );
        await rename(temporary, optionsPath);
      }
      send(socket, { kind: "response", id: request.id, result: {} });
      return shutdown();
    }
    if (request.kind !== "rpc") throw new Error("未知 Claude IPC 操作");
    if (stopping) throw new Error("Claude 后端正在停止，请稍后重试。");
    let replied = false;
    inflight++;
    try {
      await adapter.receive(
        {
          deliver(message) {
            replied = true;
            send(socket, { kind: "response", id: request.id, result: message });
          },
        },
        request.message,
      );
    } finally {
      inflight--;
    }
    if (!replied)
      send(socket, { kind: "response", id: request.id, result: null });
  } catch (error) {
    send(socket, { kind: "response", id: request?.id, error: error.message });
  }
}
async function listen() {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
}
try {
  await listen();
} catch (error) {
  if (error.code !== "EADDRINUSE") throw error;
  await verifyWorkerSocket(socketPath);
  const active = await new Promise((resolve) => {
    const socket = net.connect(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  if (active) process.exit(0);
  const info = await lstat(socketPath);
  if (!info.isSocket() || info.uid !== process.getuid())
    throw new Error("Claude IPC socket 归属异常");
  await unlink(socketPath);
  await listen();
}
try {
  await initialize(JSON.parse(await readFile(optionsPath, "utf8")));
} catch (error) {
  if (error.code !== "ENOENT") console.error("Claude 后端恢复失败", error);
}
const housekeeping = setInterval(() => adapter?.releaseUnusedThreads(), 30000);
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(housekeeping);
  adapter?.close();
  for (const socket of clients) socket.end();
  server.close();
  await unlink(socketPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (environmentPath)
    await unlink(environmentPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
