import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { ClaudeSessions } from "../src/claude-sessions.mjs";
import { findSharedBridge } from "../src/claude-shared-client.mjs";
const wait = async (fn) => {
  for (let i = 0; i < 200; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("timeout");
};
test("plugin host and web share one process, controls and approvals; disconnect preserves host", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "claude-share-test-"));
  const id = randomUUID();
  const host = spawn(
    process.execPath,
    [
      "bin/claude-shared.mjs",
      process.execPath,
      resolve("tests/fixtures/claude-shared-fake.mjs"),
      "--input-format",
      "stream-json",
      "--session-id",
      id,
    ],
    {
      env: { ...process.env, CLAUDE_CONFIG_DIR: root },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const output = [];
  let stderr = "";
  host.stderr.on("data", (b) => (stderr += b));
  createInterface({ input: host.stdout }).on("line", (line) =>
    output.push(JSON.parse(line)),
  );
  const write = (m) => host.stdin.write(JSON.stringify(m) + "\n");
  const manager = new ClaudeSessions({
    home: root,
    stateFile: join(root, "state.json"),
    launch: () => {
      throw Error("must not spawn second Claude");
    },
  });
  t.after(async () => {
    manager.close();
    host.kill();
    await new Promise((r) => host.once("close", r));
    await manager.saveChain;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "projects", "demo"), { recursive: true });
  await writeFile(
    join(root, "projects", "demo", id + ".jsonl"),
    JSON.stringify({
      type: "user",
      uuid: randomUUID(),
      cwd: root,
      message: { content: "history" },
    }) + "\n",
  );
  write({
    type: "control_request",
    request_id: "init",
    request: { subtype: "initialize" },
  });
  const bridge = await wait(() => findSharedBridge(root, id));
  await mkdir(join(root, "sessions"));
  await writeFile(
    join(root, "sessions", "owner.json"),
    JSON.stringify({
      pid: bridge.childPid,
      sessionId: id,
      entrypoint: "claude-vscode",
    }),
  );
  const opened = await manager.open(id);
  assert.equal(opened.session.shared, true);
  assert.equal(opened.session.status, "idle");
  const browserId = randomUUID();
  await manager.send({ id, messageId: browserId, text: "web hello" });
  await wait(() =>
    output.some((m) => m.type === "user" && m.uuid === browserId),
  );
  await wait(() => manager.runtime.get(id).status === "idle");
  const pluginId = randomUUID();
  write({
    type: "user",
    uuid: pluginId,
    session_id: id,
    message: { role: "user", content: "plugin hello" },
  });
  await wait(() => manager.runtime.get(id).messages.has("reply-" + pluginId));
  await manager.configure({ id, model: "sonnet", effort: "high" });
  assert.equal((await manager.status(id)).session.actualEffort, "high");
  assert.equal(
    output.filter((m) => m.type === "control_response").length,
    1,
    "web controls must not leak to host",
  );
  await manager.send({ id, messageId: randomUUID(), text: "permission" });
  await wait(() => manager.runtime.get(id).permissions.has("approval"));
  await manager.answer({ id, requestId: "approval", allow: true });
  await wait(() => output.some((m) => m.type === "control_cancel_request"));
  write({
    type: "control_response",
    response: { request_id: "approval", response: { behavior: "deny" } },
  });
  await wait(() => manager.runtime.get(id).status === "idle");
  assert.equal(
    output.filter((m) => m.type === "result" && m.result === "deny").length,
    0,
  );
  await manager.release(id);
  process.kill(bridge.childPid, 0);
  write({
    type: "user",
    uuid: randomUUID(),
    session_id: id,
    message: { role: "user", content: "after web detach" },
  });
  await wait(() =>
    output.some(
      (m) => m.type === "user" && m.message.content === "after web detach",
    ),
  );
  assert.equal(stderr, "");
});
