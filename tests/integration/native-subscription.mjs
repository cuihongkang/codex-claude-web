import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { providerSession } from "./provider-session.mjs";

const session = await providerSession();
try {
  const configBefore = await readFile(
    join(session.home, "config.toml"),
    "utf8",
  );
  const marker = "NATIVE-" + Math.random().toString(36).slice(2, 12);
  const { thread } = await session.call("thread/start", {
    providerId: "codex",
    model: process.env.GPT_MODEL || "gpt-6.1-terra",
    cwd: session.home,
    baseInstructions: "Answer briefly. Do not use tools.",
  });
  assert.equal(thread.modelProvider, "openai");
  await session.call("thread/name/set", {
    threadId: thread.id,
    name: "原生订阅归属验证",
  });
  await session.turn(
    thread.id,
    `Remember ${marker}. Reply with the marker only.`,
    { providerId: "codex", effort: "low" },
  );
  assert.equal(
    await readFile(join(session.home, "config.toml"), "utf8"),
    configBefore,
  );
  await session.stopWeb();
  await session.stopBackend();
  const child = spawn(
    "codex",
    [
      "exec",
      "resume",
      "--skip-git-repo-check",
      "--json",
      thread.id,
      "Reply with the remembered marker only. Do not use tools.",
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
  const exit = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exit, 0, stderr.slice(-2000));
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(
    events.some(
      (event) =>
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        event.item.text.includes(marker),
    ),
    "Web 和 app-server 停止后 CLI 原生恢复同一会话及记忆",
  );
  const result = {
    status: "passed",
    provider: thread.modelProvider,
    globalConfigUnchanged: true,
    webStopped: true,
    backendStopped: true,
    cliResumed: true,
    markerRestored: true,
  };
  if (process.env.PROVIDER_RESULT)
    await writeFile(
      process.env.PROVIDER_RESULT,
      JSON.stringify(result, null, 2) + "\n",
    );
  console.log(JSON.stringify(result));
} finally {
  await session.close();
}
