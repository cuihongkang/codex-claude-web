import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendManager } from "../src/backends/manager.mjs";
import { resourceId } from "../../shared/backend-identity.mjs";

test("拖拽迁移通过真实管理器保存归属，恢复与发送按后端传递目标目录", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "backend-routing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "backends.json");
  await writeFile(
    path,
    JSON.stringify({
      backends: [
        { id: "codex", type: "codex", enabled: true },
        { id: "claude", type: "claude", enabled: true },
      ],
      providers: [],
    }),
  );
  const seen = [],
    adapters = new Map(),
    notifications = [];
  const factory = ({ backend, send, broadcast }) => {
    const adapter = {
      ready: true,
      capabilities: {},
      workspaceOwner: "backend",
      releaseClient(client) {
        seen.push([backend.id, { released: client }]);
      },
      state: () => ({
        params: { activeTurns: { same: "turn" }, questions: [] },
      }),
      connect() {},
      close() {},
      releaseUnusedThreads() {},
      receive(client, message) {
        seen.push([backend.id, message]);
        if (!adapter.ready)
          return send(client, {
            id: message.id,
            error: { message: "offline" },
          });
        send(client, {
          id: message.id,
          result:
            message.method === "thread/list"
              ? { data: [{ id: "same", cwd: directory }], nextCursor: null }
              : { thread: { id: message.params.threadId, cwd: directory } },
        });
      },
      notify: broadcast,
    };
    adapters.set(backend.id, adapter);
    return adapter;
  };
  const manager = createBackendManager({
    config: {
      configDir: directory,
      upstreamUrl: "ws://127.0.0.1:8765",
      claudeHome: join(directory, ".claude"),
      codexHome: directory,
      backendsFile: path,
    },
    version: {},
    send: (client, message) => client.deliver(message),
    broadcast: (message) => notifications.push(message),
    factories: { codex: factory, claude: factory },
  });
  t.after(() => manager.close());
  await manager.connect();
  let sequence = 0;
  const call = (method, params) =>
    new Promise((resolve, reject) =>
      manager
        .receive(
          {
            readyState: 1,
            deliver: (m) =>
              m.error ? reject(new Error(m.error.message)) : resolve(m.result),
          },
          { id: ++sequence, method, params },
        )
        .catch(reject),
    );

  const moved = await call("lan/thread/move", {
    threadId: resourceId("claude", "same"),
    folderPath: directory,
  });
  assert.equal(moved.thread.id, resourceId("claude", "same"));
  assert.equal(moved.thread.folderPath, directory);
  assert.equal(
    (await call("thread/read", { threadId: "same" })).thread.folderPath,
    undefined,
  );
  assert.equal(
    (await call("thread/read", { threadId: moved.thread.id })).thread
      .folderPath,
    directory,
  );
  await call("turn/start", { threadId: moved.thread.id, input: [] });
  assert.equal(seen.at(-1)[0], "claude");
  assert.equal(seen.at(-1)[1].params.cwd, directory);
  await call("thread/resume", { threadId: moved.thread.id });
  assert.equal(seen.at(-1)[1].params.cwd, directory);
  const restored = await call("lan/thread/move", {
    threadId: moved.thread.id,
    folderPath: "",
  });
  assert.equal(restored.thread.cwd, directory);
  assert.equal(restored.thread.folderPath, "");
  assert.equal(restored.thread.folderRevision, 2);
  assert.equal(notifications.at(-1).params.thread.id, moved.thread.id);
  await assert.rejects(
    call("lan/thread/move", {
      threadId: "same",
      folderPath: directory + "/missing",
    }),
  );
  const first = await call("thread/list", {});
  const second = await call("thread/list", { cursor: first.nextCursor });
  assert.equal(first.data[0].folderPath, undefined);
  assert.equal(second.data[0].folderPath, "");
});
