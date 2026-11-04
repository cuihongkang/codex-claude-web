import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { providerSession } from "./provider-session.mjs";

if (!process.env.MODEL_BASE_URL || !process.env.MODEL_ID)
  throw new Error("需要 MODEL_BASE_URL 和 MODEL_ID");
const session = await providerSession();
const code = "LEGACY-" + Math.random().toString(36).slice(2, 12);
const textOf = (events) =>
  events
    .filter(
      (m) =>
        m.method === "item/completed" && m.params.item.type === "agentMessage",
    )
    .map((m) => m.params.item.text)
    .join("\n");
async function encryptedCompactions(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += await encryptedCompactions(path);
    else if (entry.name.endsWith(".jsonl")) {
      for (const line of (await readFile(path, "utf8"))
        .split("\n")
        .filter(Boolean)) {
        const record = JSON.parse(line);
        const inspect = (value) => {
          if (!value || typeof value !== "object") return;
          if (
            ["compaction", "context_compaction"].includes(value.type) &&
            value.encrypted_content
          )
            count++;
          for (const child of Object.values(value)) inspect(child);
        };
        inspect(record);
      }
    }
  }
  return count;
}
try {
  const gpt = process.env.GPT_MODEL || "gpt-6-luna",
    model = process.env.MODEL_ID;
  await session.call("lan/providers/set", {
    id: "third-party",
    name: "已有对话测试供应商",
    baseUrl: process.env.MODEL_BASE_URL,
    protocol: "chat",
    apiKey: process.env.MODEL_API_KEY || "",
    models: [{ id: model, contextWindow: 196608, maxOutputTokens: 2048 }],
  });
  // 省略网页供应商选择，建立按 Codex 原始默认配置生成的既有对话。
  const { thread } = await session.call("thread/start", {
    model: gpt,
    cwd: session.home,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  await session.turn(
    thread.id,
    `记住本次任务代号 ${code}。请直接复述代号，后续上下文整理也要保留这个代号。`,
    { model: gpt },
  );
  console.log("START 已有 GPT 对话的原生整理");
  const mark = session.events.length;
  await session.call("thread/compact/start", { threadId: thread.id });
  const ended = await session.event(
    "turn/completed",
    (p) => p.threadId === thread.id,
    mark,
  );
  assert.equal(
    ended.turn.status,
    "completed",
    JSON.stringify(ended.turn.error)?.slice(0, 1000),
  );
  const encrypted = await encryptedCompactions(join(session.home, "sessions"));
  console.log("PASS 已有 GPT 对话的原生整理，密文记录数=" + encrypted);
  console.log("START 已整理对话切换第三方并回忆上下文");
  const result = await session.turn(
    thread.id,
    "请复述此前约定的任务代号。只给出代号。",
    { providerId: "third-party", model },
  );
  assert.ok(textOf(result).includes(code), "保留整理前的任务代号");
  const migrationCompactions = result.filter(
    (e) =>
      e.method === "item/completed" &&
      e.params.item.type === "contextCompaction",
  ).length;
  const report = {
    status: "passed",
    migrationCompactions,
    encryptedCompactions: encrypted,
    preservedContext: true,
  };
  if (process.env.PROVIDER_RESULT)
    await writeFile(
      process.env.PROVIDER_RESULT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify(report));
} finally {
  await session.close();
}
