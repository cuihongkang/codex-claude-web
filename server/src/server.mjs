import http from "node:http";
import { attachClaude } from "./claude-web.mjs";
import { createSummaryTranslationHandler } from "./summary-translation.mjs";
import { serveFile } from "./file-content.mjs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import WebSocket, { WebSocketServer } from "ws";
import { readConfig } from "./config.mjs";
import { readVersion } from "./version.mjs";
import { createCompactions } from "./compaction.mjs";
import { findCompactionTurn, recoverCompaction } from "./compaction-state.mjs";
import { MAX_RPC_MESSAGE_BYTES, sendRpcText } from "./rpc-transport.mjs";
import { createThreadNaming, generateThreadName } from "./thread-names.mjs";
import { changesForPath, undoFileChanges } from "./file-undo.mjs";
import {
  prepareProjectlessDirectory,
  readProjectlessDirectories,
} from "./thread-projects.mjs";

const config = readConfig();
const version = readVersion();
const threadNaming = createThreadNaming({
  call: callUpstream,
  generate: (params) =>
    generateThreadName({
      ...params,
      url: config.upstreamUrl,
      version: version.displayVersion,
    }),
  onError: (error) => console.error("Thread title:", error.message),
});
const clients = new WebSocketServer({ noServer: true });
const pending = new Map();
const questions = new Map();
const activeTurns = new Map();
const terminals = new Map();
const subscriptions = new Map();
const releasing = new Map();
const resuming = new Map();
const activeThreads = new Set();
const unwrittenThreads = new Set();
const compactions = createCompactions(broadcast);
const undoing = new Set();
const undoneFiles = new Map();
const threadMethods = new Set(["thread/start", "thread/resume", "thread/fork"]);
const loadedThreadMethods = new Set([
  "turn/start",
  "thread/compact/start",
  "review/start",
  "thread/goal/get",
  "thread/goal/set",
  "thread/goal/clear",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/clean",
]);
let upstream;
let ready = false;
let sequence = 1;

function send(client, message) {
  sendRpcText(client, JSON.stringify(message));
}
function broadcast(message) {
  for (const client of clients.clients) send(client, message);
}
function callUpstream(method, params) {
  return new Promise((resolve, reject) => {
    const id = sequence++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("恢复对话超时"));
    }, 120000);
    pending.set(id, {
      resolve,
      reject,
      timer,
      method,
      threadId: params.threadId,
    });
    send(upstream, { id, method, params });
  });
}
async function resumeForWrite(threadId) {
  if (subscriptions.has(threadId)) return;
  if (!resuming.has(threadId)) {
    const resume = callUpstream("thread/resume", {
      threadId,
      excludeTurns: true,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      config: { thread_unload_delay_secs: 0 },
    })
      .then(({ thread }) => {
        if (!subscriptions.has(thread.id))
          subscriptions.set(thread.id, new Set());
        if (thread.status?.type === "active") activeThreads.add(thread.id);
      })
      .finally(() => resuming.delete(threadId));
    resuming.set(threadId, resume);
  }
  await resuming.get(threadId);
}
const checkingCompactions = new Map();
function checkCompaction(threadId) {
  if (checkingCompactions.has(threadId))
    return checkingCompactions.get(threadId);
  const entry = compactions.entries.get(threadId);
  if (!compactions.busy(threadId)) return Promise.resolve(entry);
  if (
    [...pending.values()].some(
      (request) =>
        request.threadId === threadId &&
        request.method === "thread/compact/start",
    )
  )
    return Promise.resolve(entry);
  const current = () =>
    compactions.entries.get(threadId)?.id === entry.id &&
    compactions.busy(threadId);
  const checking = (async () => {
    try {
      const { thread } = await callUpstream("thread/read", {
        threadId,
        includeTurns: false,
      });
      let cursor;
      const turns = [];
      do {
        const page = await callUpstream("thread/turns/list", {
          threadId,
          limit: 100,
          itemsView: "full",
          ...(cursor ? { cursor } : {}),
        });
        if (!current()) return compactions.entries.get(threadId);
        turns.push(...page.data);
        cursor = page.nextCursor;
      } while (
        !findCompactionTurn(compactions.entries.get(threadId), turns) &&
        cursor
      );
      if (!current()) return compactions.entries.get(threadId);
      const recovered = recoverCompaction(
        compactions.entries.get(threadId),
        thread,
        turns,
      );
      if (recovered.status === "running") {
        await resumeForWrite(threadId);
      }
      if (current()) compactions.update(threadId, recovered);
      return compactions.entries.get(threadId);
    } catch (error) {
      if (current())
        compactions.update(threadId, {
          ...compactions.entries.get(threadId),
          status: "reconnecting",
          error: error.message,
        });
      throw error;
    } finally {
      checkingCompactions.delete(threadId);
      releaseUnusedThreads();
    }
  })();
  checkingCompactions.set(threadId, checking);
  return checking;
}
function releaseUnusedThreads() {
  for (const [threadId, owners] of subscriptions) {
    if (
      !ready ||
      compactions.busy(threadId) ||
      (unwrittenThreads.has(threadId) && owners.size) ||
      activeTurns.has(threadId) ||
      activeThreads.has(threadId) ||
      resuming.has(threadId) ||
      releasing.has(threadId) ||
      [...pending.values()].some((request) => request.threadId === threadId)
    )
      continue;
    const id = sequence++;
    const release = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("取消对话订阅超时"));
      }, 120000);
      pending.set(id, { resolve, reject, timer, method: "thread/unsubscribe" });
      send(upstream, {
        id,
        method: "thread/unsubscribe",
        params: { threadId },
      });
    })
      .then((result) => {
        if (subscriptions.get(threadId) === owners) {
          subscriptions.delete(threadId);
          unwrittenThreads.delete(threadId);
        }
        return result;
      })
      .catch((error) => console.error("Thread unsubscribe:", error.message))
      .finally(() => {
        if (releasing.get(threadId) === release) releasing.delete(threadId);
      });
    releasing.set(threadId, release);
  }
}
function state() {
  return {
    method: "lan/state",
    params: {
      ready,
      version,
      defaultCwd: config.defaultCwd,
      projectlessRoot: config.projectlessRoot,
      questions: [...questions.values()],
      activeTurns: Object.fromEntries(activeTurns),
      compactions: Object.fromEntries(compactions.entries),
      terminals: Object.fromEntries(terminals),
      undoneFiles: [...undoneFiles.values()],
    },
  };
}
function connect() {
  upstream = new WebSocket(config.upstreamUrl);
  upstream.on("open", () =>
    send(upstream, {
      id: 0,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex_lan_web",
          title: "Codex LAN Web",
          version: version.displayVersion,
        },
        capabilities: { experimentalApi: true },
      },
    }),
  );
  upstream.on("message", (bytes) => {
    const message = JSON.parse(bytes.toString());
    if (message.id === 0 && !message.method) {
      if (message.error) {
        console.error("Initialization failed:", message.error.message);
        upstream.close();
        return;
      }
      send(upstream, { method: "initialized" });
      ready = true;
      broadcast(state());
      for (const [threadId, entry] of compactions.entries)
        if (entry.status === "reconnecting")
          checkCompaction(threadId).catch(() => {});
      return;
    }
    if (message.method) {
      if (message.id !== undefined) questions.set(String(message.id), message);
      const p = message.params || {};
      if (
        ["thread/name/updated", "thread/deleted", "thread/archived"].includes(
          message.method,
        )
      )
        threadNaming.cancel(p.threadId);
      if (message.method === "turn/started") {
        activeTurns.set(p.threadId, p.turn.id);
        activeThreads.add(p.threadId);
        unwrittenThreads.delete(p.threadId);
      }
      if (
        message.method === "turn/completed" &&
        (!activeTurns.has(p.threadId) ||
          activeTurns.get(p.threadId) === p.turn.id)
      ) {
        activeTurns.delete(p.threadId);
        activeThreads.delete(p.threadId);
      }
      if (message.method === "thread/status/changed") {
        if (p.status.type === "active") activeThreads.add(p.threadId);
        else activeThreads.delete(p.threadId);
      }
      if (
        ["thread/closed", "thread/deleted", "thread/archived"].includes(
          message.method,
        )
      ) {
        subscriptions.delete(p.threadId);
        unwrittenThreads.delete(p.threadId);
        activeThreads.delete(p.threadId);
        activeTurns.delete(p.threadId);
        if (message.method !== "thread/closed")
          compactions.entries.delete(p.threadId);
      }
      if (
        message.method === "command/exec/outputDelta" &&
        terminals.has(p.processId)
      ) {
        const terminal = terminals.get(p.processId);
        terminal.buffer = (
          terminal.buffer +
          Buffer.from(p.deltaBase64, "base64").toString("utf8")
        ).slice(-200000);
      }
      if (message.method === "serverRequest/resolved") {
        questions.delete(String(p.requestId));
        broadcast(state());
      }
      broadcast(message);
      compactions.event(message.method, p);
      releaseUnusedThreads();
      if (message.method === "turn/completed")
        threadNaming.schedule({ id: p.threadId });
      return;
    }
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error && request.method === "thread/compact/start")
        compactions.reject(request.threadId, message.id, message.error.message);
      if (request.resolve) {
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
        releaseUnusedThreads();
        return;
      }
      if (
        !message.error &&
        threadMethods.has(request.method) &&
        message.result?.thread?.id
      ) {
        const thread = message.result.thread;
        if (!subscriptions.has(thread.id))
          subscriptions.set(thread.id, new Set());
        if (!request.timedOut && request.client.readyState === WebSocket.OPEN)
          subscriptions.get(thread.id).add(request.client);
        if (request.method === "thread/start") unwrittenThreads.add(thread.id);
        if (thread.status?.type === "active") activeThreads.add(thread.id);
      }
      if (request.threadId && message.result?.turn?.status === "inProgress") {
        activeTurns.set(request.threadId, message.result.turn.id);
        activeThreads.add(request.threadId);
      }
      if (
        !message.error &&
        ["turn/start", "thread/compact/start", "review/start"].includes(
          request.method,
        )
      )
        unwrittenThreads.delete(request.threadId);
      if (request.processId && terminals.has(request.processId)) {
        terminals.get(request.processId).running = false;
        broadcast({
          method: "lan/terminalExit",
          params: {
            processId: request.processId,
            exitCode: message.result?.exitCode,
          },
        });
      }
      if (!request.timedOut)
        send(request.client, { ...message, id: request.id });
      releaseUnusedThreads();
      if (!message.error && !request.timedOut) {
        if (request.method === "turn/start")
          threadNaming.schedule(
            { id: request.threadId },
            { text: request.nameText, model: request.model },
          );
        else if (["thread/read", "thread/resume"].includes(request.method))
          threadNaming.schedule(message.result?.thread);
      }
    }
  });
  upstream.on("error", (error) =>
    console.error("App-server connection:", error.message),
  );
  upstream.on("close", (code, reason) => {
    console.error(
      "App-server disconnected:",
      JSON.stringify({
        code,
        reason: reason.toString(),
        pendingMethods: [
          ...new Set([...pending.values()].map((request) => request.method)),
        ],
      }),
    );
    ready = false;
    compactions.disconnected();
    threadNaming.clear();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      if (request.reject) request.reject(new Error("Codex 后端连接中断"));
      else
        send(request.client, {
          id: request.id,
          error: { code: -32000, message: "Codex 后端连接中断，请重试。" },
        });
    }
    pending.clear();
    questions.clear();
    activeTurns.clear();
    activeThreads.clear();
    subscriptions.clear();
    unwrittenThreads.clear();
    releasing.clear();
    resuming.clear();
    for (const terminal of terminals.values()) terminal.running = false;
    broadcast(state());
    setTimeout(connect, 2000);
  });
}

const files = new Map([
  [
    "/notification-worker.js",
    ["notification-worker.js", "text/javascript; charset=utf-8"],
  ],
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/favicon.ico", ["favicon.ico", "image/x-icon"]],
  ["/favicon.png", ["favicon.png", "image/png"]],
  ["/apple-touch-icon.png", ["apple-touch-icon.png", "image/png"]],
]);
const staticCache = new Map();
const translateSummary = createSummaryTranslationHandler();
const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (["/api/files", "/api/media"].includes(path)) {
    await serveFile(request, response);
    return;
  }
  if (path === "/api/translate") {
    await translateSummary(request, response);
    return;
  }
  if (path === "/healthz") {
    response.writeHead(ready ? 200 : 503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        ready,
        version,
        claude: { enabled: true, busy: claude.busy },
      }),
    );
    return;
  }
  const asset = path.match(/^\/([\w.-]+\.(js|css))$/);
  const file =
    files.get(path) ||
    (asset && [
      asset[1],
      asset[2] === "js"
        ? "text/javascript; charset=utf-8"
        : "text/css; charset=utf-8",
    ]);
  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  try {
    const metadata = await stat(join(config.staticDir, file[0]));
    if (staticCache.get(path)?.modified !== metadata.mtimeMs) {
      const raw = await readFile(join(config.staticDir, file[0]));
      staticCache.set(path, {
        raw,
        gzip: gzipSync(raw),
        modified: metadata.mtimeMs,
      });
    }
    const content = staticCache.get(path);
    const compressed = /\bgzip\b/.test(
      request.headers["accept-encoding"] || "",
    );
    response.writeHead(200, {
      "Content-Type": file[1],
      "Cache-Control": "no-store",
      Vary: "Accept-Encoding",
      ...(compressed ? { "Content-Encoding": "gzip" } : {}),
    });
    response.end(compressed ? content.gzip : content.raw);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      staticCache.delete(path);
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    console.error("Static file:", error.message);
    response.writeHead(500);
    response.end("Unable to load page");
  }
});
const claude = attachClaude(server, config);
server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url, "http://localhost").pathname === "/claude/rpc")
    return;
  if (new URL(request.url, "http://localhost").pathname !== "/rpc") {
    socket.destroy();
    return;
  }
  clients.handleUpgrade(request, socket, head, (client) =>
    clients.emit("connection", client),
  );
});
clients.on("connection", (client) => {
  client.alive = true;
  client.on("pong", () => {
    client.alive = true;
  });
  client.on("error", (error) =>
    console.error("Browser connection:", error.message),
  );
  client.on("close", () => {
    for (const owners of subscriptions.values()) owners.delete(client);
    releaseUnusedThreads();
  });
  send(client, state());
  client.on("message", async (bytes) => {
    let message;
    try {
      message = JSON.parse(bytes.toString());
    } catch {
      return;
    }
    if (message.method === "lan/projectless/read") {
      send(client, {
        id: message.id,
        result: {
          directories: await readProjectlessDirectories(config.codexHome),
        },
      });
      return;
    }
    const threadId = message.params?.threadId;
    if (threadId && releasing.has(threadId)) await releasing.get(threadId);
    if (!ready) {
      send(client, {
        id: message.id,
        error: { code: -32000, message: "正在连接 Codex，请稍后重试。" },
      });
      return;
    }
    if (message.method) {
      if (message.method === "lan/compaction/check") {
        try {
          send(client, {
            id: message.id,
            result: { compaction: await checkCompaction(threadId) },
          });
        } catch (error) {
          send(client, {
            id: message.id,
            error: { code: -32000, message: error.message },
          });
        }
        return;
      }
      if (
        [
          "turn/start",
          "turn/steer",
          "thread/compact/start",
          "review/start",
        ].includes(message.method) &&
        compactions.busy(threadId)
      ) {
        send(client, {
          id: message.id,
          error: {
            code: -32000,
            message: "正在整理上下文，完成后可继续发送。",
          },
        });
        return;
      }
      if (
        message.method === "thread/compact/start" &&
        (activeTurns.has(threadId) ||
          activeThreads.has(threadId) ||
          [...pending.values()].some(
            (request) =>
              request.threadId === threadId &&
              ["turn/start", "review/start"].includes(request.method),
          ))
      ) {
        send(client, {
          id: message.id,
          error: { code: -32000, message: "请等待当前任务结束后整理上下文。" },
        });
        return;
      }

      if (
        ["thread/name/set", "thread/delete", "thread/archive"].includes(
          message.method,
        )
      )
        threadNaming.cancel(threadId);
      if (message.method === "lan/projectless/prepare") {
        try {
          send(client, {
            id: message.id,
            result: {
              cwd: await prepareProjectlessDirectory(config.projectlessRoot),
              root: config.projectlessRoot,
            },
          });
        } catch (error) {
          send(client, {
            id: message.id,
            error: {
              code: -32000,
              message: "创建对话工作目录失败：" + error.message,
            },
          });
        }
        return;
      }
      if (message.method === "lan/files/undo") {
        try {
          const { turnId, path } = message.params;
          const key = JSON.stringify([threadId, turnId, path]);
          if (undoneFiles.has(key)) {
            const result = undoneFiles.get(key);
            broadcast({ method: "lan/files/undone", params: result });
            send(client, { id: message.id, result });
            return;
          }
          if (activeTurns.has(threadId) || activeThreads.has(threadId))
            throw new Error("任务正在运行，请在结束后撤销修改。");
          if (undoing.has(threadId))
            throw new Error("正在撤销文件修改，请稍候。");
          undoing.add(threadId);
          try {
            const { thread } = await callUpstream("thread/read", {
              threadId,
              includeTurns: true,
            });
            const turn = thread.turns.find((turn) => turn.id === turnId);
            if (!turn || turn.status === "inProgress")
              throw new Error("请重新加载此轮记录后再撤销。");
            await undoFileChanges({
              cwd: thread.cwd,
              changes: changesForPath(turn.items, thread.cwd, path),
              isActive: () =>
                activeTurns.has(threadId) || activeThreads.has(threadId),
            });
            const result = { threadId, turnId, path };
            undoneFiles.set(key, result);
            broadcast({ method: "lan/files/undone", params: result });
            send(client, { id: message.id, result });
          } finally {
            undoing.delete(threadId);
          }
        } catch (error) {
          send(client, {
            id: message.id,
            error: { code: -32000, message: error.message },
          });
        }
        return;
      }
      if (message.method === "thread/unsubscribe") {
        subscriptions.get(threadId)?.delete(client);
        releaseUnusedThreads();
        const result = await releasing.get(threadId);
        send(client, {
          id: message.id,
          result: result || { status: "unsubscribed" },
        });
        return;
      }
      if (undoing.has(threadId) && loadedThreadMethods.has(message.method)) {
        send(client, {
          id: message.id,
          error: {
            code: -32000,
            message: "正在撤销文件修改，完成后可继续发送。",
          },
        });
        return;
      }
      if (threadMethods.has(message.method))
        message.params = {
          ...message.params,
          config: { ...message.params?.config, thread_unload_delay_secs: 0 },
        };
      const id = sequence++;
      const forwarded = JSON.stringify({ ...message, id });
      if (Buffer.byteLength(forwarded) > MAX_RPC_MESSAGE_BYTES) {
        send(client, {
          id: message.id,
          error: {
            code: -32600,
            message: "单次消息过大（最多 64 MiB），请减少附件后重试。",
          },
        });
        return;
      }
      const processId =
        message.method === "command/exec" && message.params?.processId;
      if (processId) {
        terminals.set(processId, { buffer: "", running: true });
        broadcast({ method: "lan/terminalStarted", params: { processId } });
      }
      const timer = processId
        ? null
        : setTimeout(() => {
            if (threadMethods.has(message.method))
              pending.get(id).timedOut = true;
            else {
              pending.delete(id);
              releaseUnusedThreads();
            }
            send(client, {
              id: message.id,
              error: {
                code: -32000,
                message: "请求等待超时；任务可能仍在继续，请刷新会话查看。",
              },
            });
          }, 120000);
      pending.set(id, {
        client,
        id: message.id,
        timer,
        processId,
        method: message.method,
        threadId,
        ...(message.method === "turn/start" && {
          nameText: (message.params?.input || [])
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\n"),
          model: message.params?.model,
        }),
      });
      if (message.method === "thread/compact/start")
        compactions.start(threadId, id);
      if (threadId && loadedThreadMethods.has(message.method)) {
        try {
          await resumeForWrite(threadId);
        } catch (error) {
          if (message.method === "thread/compact/start")
            compactions.reject(threadId, id, error.message);
          clearTimeout(timer);
          if (pending.delete(id))
            send(client, {
              id: message.id,
              error: { code: -32000, message: error.message },
            });
          releaseUnusedThreads();
          return;
        }
        if (!pending.has(id)) {
          releaseUnusedThreads();
          return;
        }
      }
      sendRpcText(upstream, forwarded);
    } else if (message.id !== undefined && questions.has(String(message.id))) {
      send(upstream, message);
      questions.delete(String(message.id));
      broadcast({ method: "lan/questionResolved", params: { id: message.id } });
    }
  });
});
const heartbeat = setInterval(() => {
  for (const client of clients.clients) {
    if (!client.alive) client.terminate();
    else {
      client.alive = false;
      client.ping();
    }
  }
  releaseUnusedThreads();
}, 30000);
heartbeat.unref();
connect();
server.listen(config.port, config.host, () =>
  console.log(
    `Codex web listening on http://${config.host}:${server.address().port}`,
  ),
);
