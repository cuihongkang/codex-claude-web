import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authenticationFixture } from "./auth.mjs";

import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { WebSocketServer } from "ws";

export async function waitFor(read) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = read();
    if (value) return value;
    await delay(10);
  }
  assert.fail("未收到预期的桥接请求");
}

export async function bridge(t, handle = () => undefined) {
  const backend = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(backend, "listening");
  const requests = [],
    sockets = [];
  let upstream,
    sequence = 1;
  const respond = (request, result, { closed = true } = {}) => {
    upstream.send(JSON.stringify({ id: request.id, result }));
    if (
      request.method === "thread/unsubscribe" &&
      result.status === "unsubscribed" &&
      closed
    )
      upstream.send(
        JSON.stringify({
          method: "thread/closed",
          params: { threadId: request.params.threadId },
        }),
      );
  };
  backend.on("connection", (socket) => {
    upstream = socket;
    socket.on("message", (bytes) => {
      const request = JSON.parse(bytes);
      if (request.id === undefined) return;
      requests.push(request);
      if (handle(request, socket)) return;
      respond(
        request,
        ["thread/start", "thread/resume", "thread/fork"].includes(
          request.method,
        )
          ? {
              thread: {
                id:
                  request.method === "thread/resume"
                    ? request.params.threadId
                    : `${request.method}-${request.id}`,
                status: { type: "idle" },
              },
            }
          : request.method === "thread/unsubscribe"
            ? { status: "unsubscribed" }
            : {},
      );
    });
  });
  const directory = await mkdtemp(join(tmpdir(), "claudex-web-subscriptions-"));
  const auth = await authenticationFixture(directory);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../../server/src/server.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        CODEX_HOME: directory,
        CLAUDEX_WEB_CONFIG_DIR: directory,
        PORT: "0",
        CODEX_APP_SERVER_URL: `ws://127.0.0.1:${backend.address().port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (bytes) => (stderr += bytes));
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    const exit = once(child, "exit");
    child.kill();
    await exit;
    for (const socket of backend.clients) socket.terminate();
    await new Promise((resolve) => backend.close(resolve));
  });
  const url = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (bytes) => {
      const match = bytes.toString().match(/https:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0].replace("https:", "wss:") + "/rpc");
    });
  });
  return {
    requests,
    respond,
    logs: () => stderr,
    disconnect: () => upstream.terminate(),
    unsubscribed: () =>
      requests.filter((request) => request.method === "thread/unsubscribe"),
    notify(method, params) {
      upstream.send(JSON.stringify({ method, params }));
    },
    async connect() {
      const socket = new WebSocket(url, {
        ca: auth.tls.cert,
        headers: {
          Cookie: auth.cookie,
          Origin: new URL(url).origin.replace("wss:", "https:"),
        },
      });
      sockets.push(socket);
      await new Promise((resolve) =>
        socket.on("message", (bytes) => {
          const message = JSON.parse(bytes);
          if (message.method === "lan/state" && message.params.ready) {
            socket.initialState = message.params;
            resolve();
          }
        }),
      );
      return socket;
    },
    rpc(socket, method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = sequence++;
        function receive(bytes) {
          const message = JSON.parse(bytes);
          if (message.id !== id || message.method) return;
          socket.off("message", receive);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        }
        socket.on("message", receive);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

export async function close(socket) {
  const closed = once(socket, "close");
  socket.close();
  await closed;
}
