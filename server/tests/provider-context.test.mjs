import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContextStorage } from "../src/providers/context-storage.mjs";
import { portableInput } from "../src/providers/context-summary.mjs";
import { createContextExport } from "../src/providers/context-export.mjs";

test("迁移摘要按对话与加密整理隔离，转换程序重建后恢复，原始输入保持完整", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "codex-context-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const storage = createContextStorage(home);
  const compacted = { type: "compaction", encrypted_content: "encrypted-a" };
  await storage.save("thread-a", "Remember marker TEST-17.");
  const summary = await storage.read("thread-a", compacted);
  const input = [
    compacted,
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Continue" }],
    },
  ];
  const output = portableInput(input, summary);
  assert.equal(output[0].role, "assistant");
  assert.match(output[0].content[0].text, /TEST-17/);
  assert.equal(output[1], input[1]);
  assert.equal(input[0], compacted);
  assert.equal(
    await createContextStorage(home).read("thread-a", compacted),
    summary,
  );
  assert.equal(await storage.read("thread-b", compacted), null);
  assert.equal(
    await storage.read("thread-a", {
      ...compacted,
      encrypted_content: "encrypted-b",
    }),
    null,
  );
  assert.throws(() => portableInput(input), /加密整理/);
  assert.equal(
    (await stat(join(home, "codex-web/model-adapter/context/thread-a.json")))
      .mode & 0o777,
    0o600,
  );
  await storage.remove("thread-a");
  assert.equal(await storage.read("thread-a", compacted), null);
});

test("原生临时分支导出摘要，保留供应商身份，隔离工具请求与完成早于确认的结果", async () => {
  const requests = [],
    sent = [];
  const exporter = createContextExport({
    send: (message) => sent.push(message),
    async call(method, params) {
      requests.push({ method, params });
      if (method === "config/read")
        return { config: { mcp_servers: { fixture: {} } } };
      if (method === "thread/fork") return { thread: { id: "temporary" } };
      if (method === "turn/start") {
        assert.equal(
          exporter.event({
            id: 17,
            method: "item/tool/call",
            params: { threadId: "temporary" },
          }),
          true,
        );
        exporter.event({
          method: "item/completed",
          params: {
            threadId: "temporary",
            item: { type: "agentMessage", text: "summary" },
          },
        });
        exporter.event({
          method: "turn/completed",
          params: {
            threadId: "temporary",
            turn: { id: "turn", status: "completed" },
          },
        });
        return { turn: { id: "turn" } };
      }
      return {};
    },
  });
  assert.equal(
    await exporter.run("original", {
      modelProvider: "openai",
      model: "native-model",
    }),
    "summary",
  );
  const fork = requests.find(
    (request) => request.method === "thread/fork",
  ).params;
  assert.equal(fork.modelProvider, "openai");
  assert.equal(fork.ephemeral, true);
  assert.equal(fork.config.model_providers, undefined);
  assert.equal(fork.config.features.shell_tool, false);
  assert.equal(fork.config.mcp_servers.fixture.enabled, false);
  assert.equal(sent[0].error.code, -32601);
  assert.equal(
    requests.some((request) => request.method === "turn/interrupt"),
    false,
  );
  assert.equal(
    exporter.event({ method: "turn/started", params: { threadId: "other" } }),
    false,
  );
});
