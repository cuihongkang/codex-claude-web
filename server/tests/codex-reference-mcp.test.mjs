import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";

test("引用 MCP 在原生握手完成后就绪，首次调用直接读取且退出清理连接", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  let release;
  let nativeReady;
  const handshake = new Promise((resolve) => {
    nativeReady = resolve;
  });
  server.on("connection", (socket) =>
    socket.on("message", (raw) => {
      const request = JSON.parse(raw);
      if (request.method === "initialize") {
        assert.equal(typeof request.params.clientInfo.version, "string");
        release = () =>
          socket.send(JSON.stringify({ id: request.id, result: {} }));
        nativeReady();
      } else if (request.method === "thread/read")
        socket.send(
          JSON.stringify({
            id: request.id,
            result: { thread: { id: "fixture", name: "引用测试" } },
          }),
        );
      else if (request.method === "thread/turns/list")
        socket.send(
          JSON.stringify({
            id: request.id,
            result: { data: [], nextCursor: null },
          }),
        );
    }),
  );
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../src/backends/codex/reference-mcp.mjs", import.meta.url),
      ),
    ],
    {
      env: {
        ...process.env,
        CLAUDEX_REFERENCE_UPSTREAM: `ws://127.0.0.1:${server.address().port}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stderr.resume();
  const messages = [];
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    messages.push(message);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  function request(id, method, params) {
    return new Promise((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }
  try {
    const initialized = request(1, "initialize", {
      protocolVersion: "2024-11-05",
    });
    await handshake;
    await delay(30);
    assert.equal(messages.length, 0);
    release();
    assert.equal(
      (await initialized).result.capabilities.tools.constructor,
      Object,
    );
    const read = await request(2, "tools/call", {
      name: "read_thread",
      arguments: { threadId: "fixture" },
    });
    assert.equal(read.result.isError, undefined);
    assert.equal(JSON.parse(read.result.content[0].text).threadId, "fixture");
    const exit = once(child, "exit");
    child.stdin.end();
    await exit;
  } finally {
    lines.close();
    child.kill("SIGTERM");
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});
