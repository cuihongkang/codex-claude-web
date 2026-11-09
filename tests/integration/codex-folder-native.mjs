import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "codex-folder-native-"));
const source = join(root, "source");
const target = join(root, "target");
const home = join(root, "config");
for (const directory of [source, target, home]) await mkdir(directory);
const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
  env: { ...process.env, CODEX_HOME: home },
  stdio: ["pipe", "pipe", "pipe"],
});
let sequence = 0;
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const pending = new Map();
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
child.on("exit", () => {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(stderr));
  }
  pending.clear();
});
function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(
      () => reject(new Error(method + " timeout " + stderr)),
      30000,
    );
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
try {
  await call("initialize", {
    clientInfo: { name: "folder_probe", version: "1" },
    capabilities: { experimentalApi: true },
  });
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const day = timestamp.slice(0, 10);
  const sessions = join(home, "sessions", ...day.split("-"));
  await mkdir(sessions, { recursive: true });
  await writeFile(
    join(sessions, `rollout-${day}T00-00-00-${id}.jsonl`),
    [
      {
        type: "session_meta",
        payload: {
          id,
          timestamp,
          cwd: source,
          originator: "codex_cli_rs",
          cli_version: execFileSync("codex", ["--version"], {
            encoding: "utf8",
          })
            .trim()
            .split(" ")
            .at(-1),
          source: "cli",
          model_provider: "openai",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Folder history fixture" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Fixture completed" }],
        },
      },
    ]
      .map((record) => JSON.stringify({ timestamp, ...record }))
      .join("\n") + "\n",
  );
  const resumed = await call("thread/resume", {
    threadId: id,
    cwd: target,
    excludeTurns: true,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  assert.equal(resumed.cwd, target);
  console.log("PASS real Codex native directory override, zero model requests");
} finally {
  const exited = once(child, "exit");
  child.kill();
  await exited;
  lines.close();
  await rm(root, { recursive: true, force: true });
}
