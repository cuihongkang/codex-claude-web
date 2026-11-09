import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, mkdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeWorkerAdapter } from "../src/backends/claude/worker-client.mjs";
import { workerRevision } from "../src/backends/claude/worker-revision.mjs";
import { workerLocation } from "../src/backends/claude/worker-launcher.mjs";

async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("IPC test condition timed out");
}

test("independent bridge connections preserve active snapshots and close without stopping the worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-ipc-client-"));
  const previousRuntimeDir = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = root;
  const backend = {
    id: "claude",
    type: "claude",
    enabled: true,
    dataDir: join(root, "config"),
    stateDir: join(root, "web-state"),
    executable: "test-claude",
    args: [],
  };
  const location = workerLocation(backend);
  const revision = await workerRevision();
  let reportedRevision = revision,
    workerBusy = false;
  await mkdir(dirname(location.socket), { recursive: true, mode: 0o700 });
  const clients = new Set(),
    packets = [];
  const state = {
    method: "lan/state",
    params: {
      ready: true,
      runtimeVersion: "test-cli",
      activeTurns: { thread: "turn" },
      executionStatuses: { thread: { kind: "working", turnId: "turn" } },
      questions: [
        {
          id: "question",
          method: "item/tool/requestUserInput",
          params: { threadId: "thread", turnId: "turn", questions: [] },
        },
      ],
      compactions: {},
      terminals: {},
      undoneFiles: [],
      backgroundTasks: {
        thread: [{ task_id: "background", status: "running" }],
      },
      nativePid: 4321,
    },
  };
  const server = net.createServer((socket) => {
    clients.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("close", () => clients.delete(socket));
    socket.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const packet = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        packets.push(packet);
        if (packet.kind === "initialize")
          socket.write(
            JSON.stringify({
              kind: "response",
              id: packet.id,
              result: {
                pid: 2147483647,
                state,
                revision: reportedRevision,
                busy: workerBusy,
              },
            }) + "\n",
          );
        if (packet.kind === "rpc" && packet.message.method === "thread/read")
          socket.write(
            JSON.stringify({
              kind: "response",
              id: packet.id,
              result: {
                id: packet.message.id,
                result: { thread: { id: "thread" } },
              },
            }) + "\n",
          );
        if (packet.kind === "rpc" && !packet.message.method)
          socket.write(
            JSON.stringify({ kind: "response", id: packet.id, result: null }) +
              "\n",
          );
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(location.socket, resolve);
  });
  await chmod(location.socket, 0o600);
  const delivered = [],
    events = [];
  const options = {
    backend,
    config: {
      configDir: root,
      claudeHome: join(root, ".claude"),
      codexHome: root,
      defaultCwd: root,
      projectlessRoot: root,
    },
    send: (_client, message) => delivered.push(message),
    broadcast: (message) => events.push(message),
    workspace: { handles: () => false },
  };
  const first = createClaudeWorkerAdapter(options),
    second = createClaudeWorkerAdapter(options);
  try {
    await Promise.all([first.connect(), second.connect()]);
    assert.equal(clients.size, 2);
    assert.equal(first.workerPid, second.workerPid);
    assert.deepEqual(second.state(), state);
    assert.equal(second.state().params.questions[0].id, "question");
    assert.equal(second.state().params.executionStatuses.thread.turnId, "turn");
    assert.equal(second.state().params.nativePid, 4321);
    reportedRevision = {
      ...revision,
      loadedAt: revision.loadedAt - 1,
      hash: "older-worker-code",
    };
    workerBusy = true;
    const upgrading = createClaudeWorkerAdapter(options);
    try {
      await upgrading.connect();
      assert.equal(
        upgrading.ready,
        true,
        "a busy worker remains connected during code replacement",
      );
      assert.equal(upgrading.state().params.pendingUpdate, true);
      assert.equal(upgrading.state().params.activeTurns.thread, "turn");
      assert.equal(
        packets.filter((packet) => packet.kind === "shutdown").length,
        0,
      );
    } finally {
      upgrading.close();
    }
    await until(() => clients.size === 2);
    reportedRevision = revision;
    workerBusy = false;
    await first.receive({}, { id: "question", result: { answers: {} } });
    assert.equal(
      packets.filter(
        (packet) => packet.kind === "rpc" && packet.message.id === "question",
      ).length,
      1,
    );
    const submitting = first.receive(
      {},
      {
        id: 9,
        method: "turn/start",
        params: { threadId: "thread", input: [{ type: "text", text: "Once" }] },
      },
    );
    await until(() => packets.some((packet) => packet.message?.id === 9));
    first.close();
    await submitting;
    await until(() => clients.size === 1);
    assert.equal(
      packets.filter((packet) => packet.kind === "shutdown").length,
      0,
    );
    assert.equal(
      packets.filter((packet) => packet.message?.method === "turn/start")
        .length,
      1,
    );
    assert.match(
      delivered.find((message) => message.id === 9).error.message,
      /连接中断/,
    );
    await second.receive(
      {},
      { id: 10, method: "thread/read", params: { threadId: "thread" } },
    );
    assert.equal(
      delivered.find((message) => message.id === 10).result.thread.id,
      "thread",
    );
    for (const socket of clients)
      socket.write(
        JSON.stringify({
          kind: "event",
          message: {
            method: "item/completed",
            params: {
              threadId: "thread",
              turnId: "turn",
              item: {
                id: "native-item",
                type: "agentMessage",
                text: "Still running",
              },
            },
          },
        }) + "\n",
      );
    await until(() =>
      events.some((event) => event.method === "item/completed"),
    );
  } finally {
    first.close();
    second.close();
    for (const socket of clients) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    if (previousRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previousRuntimeDir;
    await rm(root, { recursive: true, force: true });
  }
});
