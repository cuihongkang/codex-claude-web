import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { providerSession } from "./provider-session.mjs";
import { responsesProvider } from "../helpers/responses-provider.mjs";
import { chatProvider } from "../helpers/chat-provider.mjs";

const chat = process.env.CHAT_PROVIDER === "1";
const upstream = await (chat ? chatProvider() : responsesProvider());
const session = await providerSession();
try {
  await session.call("lan/providers/set", {
    id: "user-provider",
    name: "独立供应商",
    protocol: chat ? "chat" : "responses",
    baseUrl: upstream.baseUrl,
    apiKey: "fixture-key",
    models: [
      { id: "provider-model", contextWindow: 32768, maxOutputTokens: 2048 },
    ],
  });
  const config = await readFile(join(session.home, "config.toml"), "utf8");
  assert.match(config, /\[model_providers\.user-provider\]/);
  assert.equal(config.includes("codex_web_"), false);
  const selection = { providerId: "user-provider", model: "provider-model" };
  const { thread } = await session.call("thread/start", {
    ...selection,
    cwd: session.home,
    baseInstructions: "Answer briefly. Do not use tools.",
    config: { "features.shell_tool": false },
  });
  assert.equal(thread.modelProvider, "user-provider");
  await session.call("thread/name/set", {
    threadId: thread.id,
    name: "原生供应商配置验证",
  });
  await session.turn(thread.id, "What is 17 times 19?", selection);
  assert.equal(
    upstream.requests[0].headers.authorization,
    "Bearer fixture-key",
  );
  await session.stopWeb();
  await session.stopBackend();
  await session.restartAdapter();
  const child = spawn(
    "codex",
    [
      "exec",
      "-c",
      'model_provider="user-provider"',
      "-m",
      "provider-model",
      "resume",
      "--skip-git-repo-check",
      "--json",
      thread.id,
      "Reply with the result.",
    ],
    {
      cwd: session.home,
      env: { ...process.env, CODEX_HOME: session.home },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (bytes) => (stdout += bytes));
  child.stderr.on("data", (bytes) => (stderr += bytes));
  assert.equal(
    await new Promise((resolve) => child.once("exit", resolve)),
    0,
    stdout.slice(-3000) + stderr.slice(-2000),
  );
  assert.ok(stdout.includes("323"));
  assert.ok(upstream.requests.length >= 2);
  const report = {
    status: "passed",
    provider: thread.modelProvider,
    configOwnedByCodex: true,
    webStopped: true,
    cliResumed: true,
    credentialsPreserved: true,
    chatAdapter: chat,
    adapterRestarted: true,
  };
  if (process.env.PROVIDER_RESULT)
    await writeFile(
      process.env.PROVIDER_RESULT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify(report));
} finally {
  await session.close();
  await upstream.close();
}
