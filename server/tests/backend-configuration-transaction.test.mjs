import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  rm,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendManager } from "../src/backends/manager.mjs";

async function fixture(t, shutdown = async () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "backend-transaction-"));
  const settingsDirectory = join(directory, "settings");
  await mkdir(settingsDirectory);
  const path = join(settingsDirectory, "backends.json");
  const initial = {
    id: "claude",
    type: "claude",
    enabled: true,
    executable: "old-claude",
    dataDir: join(directory, "claude"),
    args: [],
  };
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      backends: [{ id: "codex", type: "codex", enabled: false }, initial],
      providers: [],
    }),
  );
  const events = [],
    adapters = [];
  const factory = ({ backend, send }) => {
    const generation = adapters.length + 1;
    events.push(`construct:${generation}`);
    assert.equal(
      JSON.parse(readFileSync(path, "utf8")).backends.find(
        (item) => item.id === "claude",
      ).executable,
      backend.executable,
    );
    const adapter = {
      ready: false,
      capabilities: {},
      subscriptions: new Map(),
      snapshot: { activeTurns: {}, compactions: {}, questions: [] },
      state: () => ({ params: adapter.snapshot }),
      connect() {
        events.push(`connect:${generation}`);
        adapter.ready = true;
      },
      async shutdown() {
        events.push(`shutdown:start:${generation}`);
        await shutdown(adapter);
        adapter.ready = false;
        events.push(`shutdown:finished:${generation}`);
      },
      close() {
        events.push(`close:${generation}`);
        adapter.ready = false;
      },
      releaseUnusedThreads() {},
      receive(client, message) {
        events.push(`request:${generation}:${message.method}`);
        send(client, {
          id: message.id,
          result: { generation, executable: backend.executable },
        });
      },
    };
    adapters.push(adapter);
    return adapter;
  };
  const manager = createBackendManager({
    config: {
      configDir: directory,
      claudeHome: join(directory, ".claude"),
      codexHome: directory,
      backendsFile: path,
      upstreamUrl: "ws://127.0.0.1:1",
    },
    version: {},
    send: (client, message) => client.deliver(message),
    broadcast() {},
    factories: { claude: factory },
  });
  t.after(async () => {
    manager.close();
    await chmod(settingsDirectory, 0o700);
    await rm(directory, { recursive: true, force: true });
  });
  await manager.connect();
  let sequence = 0;
  const call = (method, params) =>
    new Promise((resolve, reject) =>
      manager
        .receive(
          {
            readyState: 1,
            deliver: (message) =>
              message.error
                ? reject(new Error(message.error.message))
                : resolve(message.result),
          },
          { id: ++sequence, method, params },
        )
        .catch(reject),
    );
  const originalBytes = await readFile(path, "utf8");
  events.length = 0;
  return {
    manager,
    call,
    initial,
    path,
    settingsDirectory,
    events,
    adapters,
    originalBytes,
  };
}

test("starting整理任务拒绝修改配置，持久文件和运行实例保持原值", async (t) => {
  const f = await fixture(t);
  f.adapters[0].snapshot.compactions.thread = { status: "starting" };
  await assert.rejects(
    f.call("lan/backends/save", { ...f.initial, executable: "new-claude" }),
    /任务结束/,
  );
  assert.equal(await readFile(f.path, "utf8"), f.originalBytes);
  assert.equal(f.adapters.length, 1);
  assert.deepEqual(f.events, []);
  assert.equal(
    (await f.call("model/list", { backendId: "claude" })).generation,
    1,
  );
});

test("worker拒绝忙时shutdown，配置和原实例继续可用", async (t) => {
  const f = await fixture(t, async () => {
    throw new Error("原生后台任务仍在运行");
  });
  await assert.rejects(
    f.call("lan/backends/save", { ...f.initial, executable: "new-claude" }),
    /后台任务仍在运行/,
  );
  assert.equal(await readFile(f.path, "utf8"), f.originalBytes);
  assert.deepEqual(f.events, ["shutdown:start:1"]);
  assert.equal(f.adapters.length, 1);
  assert.equal(f.adapters[0].ready, true);
  assert.equal(
    (await f.call("model/list", { backendId: "claude" })).generation,
    1,
  );
});

for (const enabled of [true, false])
  test(`空闲后端${enabled ? "修改" : "停用"}先确认shutdown，再保存并替换实例`, async (t) => {
    let f;
    f = await fixture(t, async () => {
      assert.equal(await readFile(f.path, "utf8"), f.originalBytes);
    });
    const result = await f.call(
      enabled ? "lan/backends/save" : "lan/backends/disable",
      enabled ? { ...f.initial, executable: "new-claude" } : { id: "claude" },
    );
    const persisted = JSON.parse(await readFile(f.path, "utf8")).backends.find(
      (backend) => backend.id === "claude",
    );
    assert.equal(persisted.enabled, enabled);
    assert.deepEqual(f.events, [
      "shutdown:start:1",
      "shutdown:finished:1",
      "close:1",
      ...(enabled ? ["construct:2", "connect:2"] : []),
    ]);
    assert.equal(
      result.backends.find((backend) => backend.id === "claude").ready,
      enabled,
    );
    if (enabled)
      assert.equal(
        (await f.call("model/list", { backendId: "claude" })).executable,
        "new-claude",
      );
    else
      await assert.rejects(
        f.call("turn/start", {
          backendId: "claude",
          threadId: "backend:claude:thread",
          input: [],
        }),
        /未启用/,
      );
  });

test("等待shutdown时新轮次被拒绝，尚未保存的新配置保持隔离", async (t) => {
  let enter, finish;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const f = await fixture(t, async () => {
    enter();
    await gate;
  });
  const saving = f.call("lan/backends/save", {
    ...f.initial,
    executable: "new-claude",
  });
  await entered;
  try {
    await assert.rejects(
      f.call("turn/start", {
        backendId: "claude",
        threadId: "backend:claude:thread",
        input: [{ type: "text", text: "new input" }],
      }),
      /配置正在更新/,
    );
    assert.equal(await readFile(f.path, "utf8"), f.originalBytes);
    assert.deepEqual(f.events, ["shutdown:start:1"]);
  } finally {
    finish();
  }
  await saving;
  assert.equal(
    (await f.call("model/list", { backendId: "claude" })).generation,
    2,
  );
});

test("配置文件写入失败后恢复旧配置实例，并允许再次保存", async (t) => {
  if (process.getuid() === 0) {
    t.skip("权限拒绝场景需要非root用户");
    return;
  }
  let f,
    failWrite = true;
  f = await fixture(t, async () => {
    if (failWrite) await chmod(f.settingsDirectory, 0o500);
  });
  await assert.rejects(
    f.call("lan/backends/save", { ...f.initial, executable: "new-claude" }),
    /EACCES/,
  );
  assert.equal(await readFile(f.path, "utf8"), f.originalBytes);
  assert.equal(f.adapters.length, 2);
  assert.equal(
    (await f.call("model/list", { backendId: "claude" })).executable,
    "old-claude",
  );
  failWrite = false;
  await chmod(f.settingsDirectory, 0o700);
  await f.call("lan/backends/save", { ...f.initial, executable: "new-claude" });
  assert.equal(
    (await f.call("model/list", { backendId: "claude" })).executable,
    "new-claude",
  );
});
