import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { providerSession } from "./provider-session.mjs";
import { createLedger, dynamicTools } from "./provider-tools.mjs";

if (!process.env.MODEL_BASE_URL || !process.env.MODEL_ID)
  throw new Error("需要 MODEL_BASE_URL 和 MODEL_ID");
const padding = Array.from(
  { length: 250 },
  (_, i) =>
    `diagnostic_${i} obsolete_reference_${i * 7919} discard_after_reading`,
).join("\n");
const ledger = createLedger({ padding });
const session = await providerSession(ledger.handle);
try {
  const model = process.env.MODEL_ID;
  await session.call("lan/providers/set", {
    id: "automatic",
    name: "自动整理测试供应商",
    baseUrl: process.env.MODEL_BASE_URL,
    protocol: "chat",
    apiKey: process.env.MODEL_API_KEY || "",
    models: [{ id: model, contextWindow: 32768, maxOutputTokens: 2048 }],
  });
  const { thread } = await session.call("thread/start", {
    providerId: "automatic",
    model,
    cwd: session.home,
    dynamicTools,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    baseInstructions:
      "This is a synthetic ledger test. Always use ledger_read, ledger_add with the exact returned revision, then ledger_read. Keep the ledger balance, revision and tool names in compaction summaries. Do not use shell or other tools. Give a concise answer.",
    config: {
      "features.shell_tool": false,
    },
  });
  await session.call("thread/name/set", {
    threadId: thread.id,
    name: "自动整理集成验证（临时）",
  });
  const selection = { providerId: "automatic", model };
  console.log("START 自动整理前依赖工具链");
  await session.turn(thread.id, "请读取账本，加 37，再读取验证。", selection);
  assert.equal(ledger.state.balance, 174);
  console.log("PASS 自动整理前依赖工具链");
  console.log("START 工具上下文触发原生自动整理并继续依赖调用");
  const result = await session.turn(
    thread.id,
    "用账本工具反复执行：ledger_read、ledger_add（每次只加 11）、ledger_read 核对，直到余额达到 218。每次必须使用刚读取的 revision。诊断日志可在整理时丢弃，保留目标余额和进度。",
    selection,
  );
  assert.equal(ledger.state.balance, 218);
  const compactions = result.filter(
    (e) =>
      e.method === "item/completed" &&
      e.params.item.type === "contextCompaction",
  ).length;
  assert.ok(compactions >= 1, "真实自动整理完成事件");
  assert.ok(compactions <= 8, "自动整理应在有限次数内结束");
  console.log("PASS 工具上下文触发原生自动整理并继续依赖调用");
  await session.turn(
    thread.id,
    "再次使用账本工具：读取、加 5、读取验证。",
    selection,
  );
  assert.equal(ledger.state.balance, 223);
  const report = {
    status: "passed",
    compactions,
    dynamicToolCalls: ledger.calls.length,
    balance: ledger.state.balance,
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
