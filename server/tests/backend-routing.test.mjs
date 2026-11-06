import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendManager } from "../src/backends/manager.mjs";
import { resourceId } from "../../shared/backend-identity.mjs";

test("相同原生会话 ID 按实例路由，单实例故障保留另一实例和配置入口", async (t) => {
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
      subscriptions: new Map(),
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
  assert.deepEqual(Object.keys(manager.state().params.activeTurns), [
    "same",
    resourceId("claude", "same"),
  ]);
  await call("thread/read", {
    threadId: resourceId("claude", "same"),
    backendId: "codex",
  });
  assert.equal(seen.at(-1)[0], "claude");
  assert.equal(seen.at(-1)[1].params.threadId, "same");
  const first = await call("thread/list", {}),
    second = await call("thread/list", { cursor: first.nextCursor });
  assert.equal(first.data[0].id, "same");
  assert.equal(second.data[0].id, resourceId("claude", "same"));
  adapters.get("claude").ready = false;
  assert.equal(
    (await call("thread/read", { threadId: "same" })).thread.id,
    "same",
  );
  assert.equal((await call("lan/backends/list", {})).backends.length, 2);
  adapters.get("claude").notify({
    method: "item/completed",
    params: {
      threadId: "same",
      item: {
        id: "i",
        type: "dynamicToolCall",
        arguments: { threadId: "literal" },
      },
    },
  });
  assert.equal(
    notifications.at(-1).params.threadId,
    resourceId("claude", "same"),
  );
  assert.equal(notifications.at(-1).params.item.arguments.threadId, "literal");
});
