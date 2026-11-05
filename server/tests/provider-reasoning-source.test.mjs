import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reasoningSource } from "../src/providers/reasoning-source.mjs";

test("中断切换从真实记录追溯模型，尊重分支边界、后续整理与同名模型歧义", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reasoning-source-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const providers = [
    { id: "source", models: [{ id: "source-model" }] },
    { id: "other", models: [{ id: "other-model" }] },
  ];
  const first =
    [
      { type: "turn_context", payload: { model: "source-model" } },
      {
        type: "response_item",
        payload: {
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "Plain reasoning" }],
        },
      },
    ]
      .map(JSON.stringify)
      .join("\n") + "\n";
  const later =
    [
      { type: "turn_context", payload: { model: "other-model" } },
      {
        type: "response_item",
        payload: {
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "Later reasoning" }],
        },
      },
    ]
      .map(JSON.stringify)
      .join("\n") + "\n";
  const parent = join(dir, "parent.jsonl"),
    fork = join(dir, "fork.jsonl");
  await writeFile(parent, first + later);
  await writeFile(
    fork,
    JSON.stringify({
      type: "session_meta",
      payload: {
        history_base: {
          thread_id: "parent",
          end_byte_offset: Buffer.byteLength(first),
        },
      },
    }) + "\n",
  );
  assert.deepEqual(await reasoningSource(fork, providers, async () => parent), {
    providerId: "source",
    model: "source-model",
  });
  assert.deepEqual(await reasoningSource(parent, providers), {
    providerId: "other",
    model: "other-model",
  });
  assert.equal(
    await reasoningSource(parent, [
      ...providers,
      { id: "duplicate", models: [{ id: "other-model" }] },
    ]),
    null,
  );
  await writeFile(
    fork,
    JSON.stringify({ type: "compacted", payload: {} }) + "\n",
  );
  assert.equal(await reasoningSource(fork, providers), null);
});
