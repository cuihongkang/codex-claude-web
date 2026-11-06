import { findCli } from "../cli-installation.mjs";
import net from "node:net";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { claudeCapabilities } from "../../../../shared/backend-capabilities.mjs";
import { hasBackendWork } from "../../../../shared/backend-activity.mjs";
import { launchWorker, workerLocation } from "./worker-launcher.mjs";
import { workerRevision } from "./worker-revision.mjs";
import {
  captureNativeProcesses,
  nativeProcessesAlive,
} from "./process-ownership.mjs";
import {
  prepareWorkerDirectory,
  verifyWorkerSocket,
} from "./worker-location.mjs";

export function createClaudeWorkerAdapter({
  backend,
  config,
  send,
  broadcast,
}) {
  const location = workerLocation(backend);
  const options = {
    generation: Date.now(),
    backend,
    runtimeEnv: Object.fromEntries(
      [
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "CLAUDE_CODE_EFFORT_LEVEL",
        "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
        "NODE_USE_ENV_PROXY",
        "LANG",
        "LC_ALL",
      ]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
    config: Object.fromEntries(
      [
        "codexHome",
        "claudeHome",
        "configDir",
        "backendsFile",
        "defaultCwd",
        "projectlessRoot",
      ].map((key) => [key, config[key]]),
    ),
  };
  const pending = new Map();
  let socket,
    reconnect,
    connecting,
    closed = false,
    workerPid,
    workerIdentity,
    stopping = false,
    outdated = false,
    upgrading = false,
    mayUpgrade = true;
  let snapshot = {
    method: "lan/state",
    params: {
      ready: false,
      error: null,
      activeTurns: {},
      questions: [],
      compactions: {},
      terminals: {},
      undoneFiles: [],
      backgroundTasks: {},
    },
  };
  function publish() {
    if (outdated && mayUpgrade)
      snapshot = {
        ...snapshot,
        params: { ...snapshot.params, pendingUpdate: true },
      };
    broadcast(snapshot);
  }
  function busy() {
    return hasBackendWork(snapshot.params);
  }
  function upgradeWhenIdle() {
    if (!outdated || !mayUpgrade || upgrading || busy() || closed) return;
    upgrading = true;
    shutdownWorker(options)
      .then(async () => {
        if (connecting) await connecting.catch(() => {});
        await connect();
      })
      .catch(() => {})
      .finally(() => {
        upgrading = false;
      });
  }
  function accept(packet) {
    if (packet.kind === "state") {
      snapshot = packet.message;
      publish();
      upgradeWhenIdle();
    }
    if (packet.kind === "event") broadcast(packet.message);
    if (packet.kind === "response") {
      const request = pending.get(packet.id);
      if (!request) return;
      pending.delete(packet.id);
      clearTimeout(request.timer);
      if (packet.error) request.reject(new Error(packet.error));
      else request.resolve(packet.result);
    }
  }
  function request(kind, value = {}) {
    if (!socket || socket.destroyed)
      return Promise.reject(new Error("Claude 后端连接已断开"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Claude 后端请求超时，请核对实际任务状态。"));
      }, 120000);
      pending.set(id, { resolve, reject, timer });
      socket.write(JSON.stringify({ kind, id, ...value }) + "\n");
    });
  }
  async function open() {
    stopping = false;
    await prepareWorkerDirectory(location.directory);
    await verifyWorkerSocket(location.socket);
    const connection = net.connect(location.socket);
    await new Promise((resolve, reject) => {
      connection.once("connect", resolve);
      connection.once("error", reject);
    });
    socket = connection;
    let input = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk) => {
      input += chunk;
      if (Buffer.byteLength(input) > 128 * 1024 * 1024)
        return connection.destroy(new Error("Claude IPC 响应超过限制"));
      let index;
      while ((index = input.indexOf("\n")) >= 0) {
        const line = input.slice(0, index);
        input = input.slice(index + 1);
        try {
          accept(JSON.parse(line));
        } catch (error) {
          connection.destroy(error);
        }
      }
    });
    connection.on("error", () => {});
    connection.on("close", () => {
      if (socket !== connection) return;
      socket = null;
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("Claude 后端连接中断，请核对实际任务状态。"));
      }
      pending.clear();
      snapshot = {
        ...snapshot,
        params: {
          ...snapshot.params,
          ready: false,
          error: "正在重新连接 Claude 后端…",
        },
      };
      if (!closed && !stopping) {
        publish();
        reconnect = setTimeout(() => connect().catch(() => {}), 1000);
      }
    });
    options.revision = await workerRevision();
    let initialized;
    try {
      initialized = await request("initialize", { options });
    } catch (error) {
      connection.destroy();
      throw error;
    }
    workerPid = initialized.pid;
    workerIdentity = (await captureNativeProcesses(workerPid)).owner;
    snapshot = initialized.state;
    outdated =
      initialized.revision?.entry !== options.revision.entry ||
      initialized.revision?.hash !== options.revision.hash ||
      (initialized.configuration &&
        !isDeepStrictEqual(initialized.configuration, {
          backend: options.backend,
          config: options.config,
          runtimeEnv: options.runtimeEnv,
        }));
    mayUpgrade =
      !initialized.generation || options.generation > initialized.generation;
    publish();
    if (outdated && mayUpgrade && !initialized.busy) {
      await shutdownWorker(options);
      const error = new Error("Claude 后端代码更新，正在重新启动。");
      error.code = "EWORKERUPDATE";
      throw error;
    }
  }
  async function connect() {
    options.backend = {
      ...backend,
      executable:
        backend.executable === "claude"
          ? await findCli("claude")
          : backend.executable,
    };
    if (closed) return;
    if (connecting) return connecting;
    if (socket && !socket.destroyed) return;
    connecting = (async () => {
      try {
        await open();
        return;
      } catch (error) {
        if (
          !["ENOENT", "ECONNREFUSED", "ECONNRESET", "EWORKERUPDATE"].includes(
            error.code,
          )
        )
          throw error;
      }
      await launchWorker(backend, options);
      let lastError;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (closed) return;
        try {
          await open();
          return;
        } catch (error) {
          lastError = error;
        }
        await delay(100);
      }
      throw lastError;
    })();
    try {
      await connecting;
    } catch (error) {
      snapshot = {
        ...snapshot,
        params: { ...snapshot.params, ready: false, error: error.message },
      };
      publish();
      if (!closed)
        reconnect = setTimeout(() => connect().catch(() => {}), 1000);
      throw error;
    } finally {
      connecting = null;
    }
  }
  async function shutdownWorker(replacement) {
    if (!socket || socket.destroyed) return;
    const connection = socket;
    let onClose;
    const ended = new Promise((resolve) => {
      onClose = resolve;
      connection.once("close", onClose);
    });
    stopping = true;
    try {
      await request("shutdown", replacement ? { replacement } : {});
      await ended;
      for (let attempt = 0; attempt < 250; attempt++) {
        if (
          !workerIdentity ||
          !(await nativeProcessesAlive({ nativeProcess: workerIdentity }))
        )
          return;
        await delay(20);
      }
      throw new Error("Claude 后端停止超时，请核对后端服务状态。");
    } catch (error) {
      connection.removeListener("close", onClose);
      stopping = false;
      if (!closed && (!socket || socket.destroyed))
        reconnect = setTimeout(() => connect().catch(() => {}), 1000);
      throw error;
    }
  }
  return {
    capabilities: claudeCapabilities,
    workspaceOwner: "bridge",
    releaseClient() {},
    state: () => snapshot,
    get ready() {
      return Boolean(socket && !socket.destroyed && snapshot.params.ready);
    },
    get workerPid() {
      return workerPid;
    },
    connect,
    async receive(client, message) {
      try {
        const response = await request("rpc", { message });
        if (response) send(client, response);
      } catch (error) {
        if (message.method)
          send(client, {
            id: message.id,
            error: { code: -32000, message: error.message },
          });
      }
    },
    releaseUnusedThreads() {
      if (socket && !socket.destroyed)
        socket.write(JSON.stringify({ kind: "release" }) + "\n");
    },
    shutdown: shutdownWorker,
    close() {
      closed = true;
      clearTimeout(reconnect);
      socket?.destroy();
    },
  };
}
