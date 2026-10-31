// Opt-in probe: isolated new conversation, never resumes existing work.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { ClaudeSessions } from "../../server/src/claude-sessions.mjs";
import { findSharedBridge } from "../../server/src/claude-shared-client.mjs";
const wait = async (fn) => {
  for (let i = 0; i < 1800; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("timeout");
};
const root = await mkdtemp(join(tmpdir(), "claude-shared-live-"));
const manager = new ClaudeSessions({
  stateFile: join(root, "state.json"),
  defaultCwd: root,
});
const { session } = await manager.create({ cwd: root });
const home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const host = spawn(
  process.execPath,
  [
    resolve("bin/claude-shared.mjs"),
    process.env.CLAUDE_TEST_BIN || join(homedir(), ".local/bin/claude"),
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--replay-user-messages",
    "--include-partial-messages",
    "--permission-prompt-tool=stdio",
    "--session-id",
    session.id,
  ],
  { cwd: root, stdio: ["pipe", "pipe", "pipe"], env: process.env },
);
const events = [];
let stderr = "";
host.stderr.on("data", (b) => (stderr += b));
createInterface({ input: host.stdout }).on("line", (s) => {
  try {
    events.push(JSON.parse(s));
  } catch {}
});
try {
  host.stdin.write(
    JSON.stringify({
      type: "control_request",
      request_id: "host-init",
      request: { subtype: "initialize" },
    }) + "\n",
  );
  const bridge = await wait(() => findSharedBridge(home, session.id));
  await manager.status(session.id);
  await manager.configure({ id: session.id, model: "sonnet", effort: "high" });
  const settings = await manager.status(session.id);
  assert.equal(settings.session.actualEffort, "high");
  console.log("PASS native shared controls, effort high");
  const messageId = randomUUID();
  await manager.send({
    id: session.id,
    messageId,
    text: "Do not use tools. Reply exactly SHARED_WEB_OK.",
  });
  await wait(() => events.some((m) => m.type === "result"));
  assert(
    events.some((m) => m.type === "user" && m.uuid === messageId),
    "host must see browser user replay",
  );
  assert(
    events.some(
      (m) =>
        m.type === "assistant" &&
        JSON.stringify(m.message).includes("SHARED_WEB_OK"),
    ),
    "host must see response",
  );
  assert.equal(manager.runtime.get(session.id).child.pid, bridge.childPid);
  console.log(
    "PASS real native CLI: browser input replayed to host and shared response",
  );
  await manager.release(session.id);
  process.kill(bridge.childPid, 0);
  console.log("PASS web detach preserves native host process");
} finally {
  manager.close();
  host.stdin.end();
  await new Promise((r) => host.once("close", r));
}
