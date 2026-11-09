import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendManager } from "../src/backends/manager.mjs";

test("Codex 文件、模糊搜索与终端请求保持原生参数、结果和错误", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "native-workspace-routing-"));
  const calls = [];
  const marker = {
    files: [{ path: "remote/only", score: 871, indices: [1, 3] }],
    nativeMetadata: { preserved: true },
  };
  const failure = {
    code: -32041,
    message: "native filesystem unavailable",
    data: { remote: true },
  };
  let fail = false;
  const manager = createBackendManager({
    config: {
      configDir: root,
      claudeHome: join(root, ".claude"),
      codexHome: root,
      upstreamUrl: "ws://127.0.0.1:1",
    },
    version: {},
    send: (client, message) => client.deliver(message),
    broadcast() {},
    factories: {
      codex: ({ send }) => ({
        ready: true,
        state: () => ({ params: {} }),
        connect() {},
        close() {},
        receive(client, message) {
          calls.push(message);
          send(client, {
            id: message.id,
            ...(fail ? { error: failure } : { result: marker }),
          });
        },
      }),
    },
  });
  t.after(async () => {
    manager.close();
    await rm(root, { recursive: true, force: true });
  });
  await manager.connect();
  let id = 0;
  const request = (method, params) =>
    new Promise((resolve, reject) =>
      manager
        .receive(
          { readyState: 1, deliver: resolve },
          { id: ++id, method, params },
        )
        .catch(reject),
    );
  for (const [method, params] of [
    [
      "fs/readDirectory",
      { path: "/remote-only/workspace", includeHidden: true },
    ],
    [
      "fs/readFile",
      { path: "/remote-only/workspace/file", encoding: "base64" },
    ],
    [
      "fs/writeFile",
      { path: "/remote-only/workspace/file", dataBase64: "AA==" },
    ],
    [
      "fuzzyFileSearch",
      {
        query: "nrm",
        roots: ["/remote-only/workspace"],
        cancellationToken: "opaque-native-token",
      },
    ],
    [
      "command/exec",
      {
        command: ["remote-program", "--flag"],
        cwd: "/remote-only/workspace",
        tty: true,
        cols: 121,
        rows: 33,
      },
    ],
    [
      "command/exec/write",
      { processId: "native-process", deltaBase64: "AA==" },
    ],
    [
      "command/exec/resize",
      { processId: "native-process", cols: 72, rows: 21 },
    ],
    ["command/exec/terminate", { processId: "native-process" }],
  ]) {
    const result = await request(method, { ...params, backendId: "codex" });
    assert.deepEqual(calls.at(-1), { id, method, params });
    assert.strictEqual(result.result, marker);
  }
  fail = true;
  const response = await request("fuzzyFileSearch", {
    backendId: "codex",
    query: "native",
    roots: [root],
  });
  assert.strictEqual(response.error, failure);
  assert.equal(response.result, undefined);
  assert.equal(calls.length, 9);
});
