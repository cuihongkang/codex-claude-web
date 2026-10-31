import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { ClaudeSessions } from "../src/claude-sessions.mjs";
import { scanSessions, readTranscript } from "../src/claude-history.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "claude-web-test-"));
  const children = [],
    events = [];
  function launch(binary, args, options) {
    const child = new EventEmitter();
    child.pid = 99999999;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.received = [];
    let buffer = "";
    child.stdin.on("data", (chunk) => {
      buffer += chunk;
      let pos;
      while ((pos = buffer.indexOf("\n")) >= 0) {
        const m = JSON.parse(buffer.slice(0, pos));
        buffer = buffer.slice(pos + 1);
        child.received.push(m);
        if (m.type === "control_request")
          queueMicrotask(() =>
            child.stdout.write(
              JSON.stringify({
                type: "control_response",
                response: {
                  subtype: "success",
                  request_id: m.request_id,
                  response: {},
                },
              }) + "\n",
            ),
          );
      }
    });
    child.stdin.on("finish", () =>
      queueMicrotask(() => child.emit("close", 0, null)),
    );
    child.kill = () => child.emit("close", null, "SIGTERM");
    children.push({ child, args, options });
    return child;
  }
  const manager = new ClaudeSessions({
    home: root,
    stateFile: join(root, "web.json"),
    executable: process.execPath,
    defaultCwd: root,
    launch,
    emit: (e) => events.push(e),
  });
  t.after(async () => {
    manager.close();
    await manager.saveChain.catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return { root, children, manager, events };
}
async function savedSession(root, id = randomUUID()) {
  const path = join(root, "projects", "-project");
  await mkdir(path, { recursive: true });
  const records = [
    {
      type: "user",
      uuid: randomUUID(),
      cwd: root,
      message: { content: "Old prompt" },
    },
    {
      type: "assistant",
      uuid: randomUUID(),
      message: { content: [{ type: "text", text: "Old response" }] },
    },
  ];
  await writeFile(
    join(path, id + ".jsonl"),
    records.map(JSON.stringify).join("\n") + "\n{partial",
  );
  return id;
}
test("historical sessions preserve roles and ignore incomplete trailing records", async (t) => {
  const { root } = await fixture(t),
    id = await savedSession(root);
  const sessions = await scanSessions(root);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, id);
  assert.equal(sessions[0].title, "Old prompt");
  assert.equal((await readTranscript(sessions[0].path)).length, 2);
});
test("concurrent sends share one process and duplicate messages are not re-sent", async (t) => {
  const { manager, children, root } = await fixture(t);
  const { session } = await manager.create({ cwd: root });
  const a = { id: session.id, text: "hello", messageId: randomUUID() },
    b = { id: session.id, text: "follow-up", messageId: randomUUID() };
  await Promise.all([manager.send(a), manager.send(b)]);
  await manager.send(a);
  assert.equal(children.length, 1);
  assert.equal(
    children[0].child.received.filter((m) => m.type === "user").length,
    2,
  );
  assert.equal(manager.busy, true);
  assert(children[0].args.includes("--permission-prompt-tool=stdio"));
  assert(!children[0].args.includes("--dangerously-skip-permissions"));
  await assert.rejects(manager.release(session.id), /停止/);
});
test("external live owner blocks writes while history stays readable", async (t) => {
  const { manager, root, children } = await fixture(t),
    id = await savedSession(root);
  await mkdir(join(root, "sessions"));
  await writeFile(
    join(root, "sessions", "owner.json"),
    JSON.stringify({
      sessionId: id,
      pid: process.pid,
      entrypoint: "claude-vscode",
    }),
  );
  const opened = await manager.open(id);
  assert.equal(opened.session.status, "external");
  assert.equal(opened.messages.length, 2);
  await assert.rejects(
    manager.send({ id, text: "do not send", messageId: randomUUID() }),
    /持有/,
  );
  assert.equal(children.length, 0);
});
test("permission decisions and interruption target the owning session", async (t) => {
  const { manager, root, children } = await fixture(t),
    { session } = await manager.create({ cwd: root });
  await manager.send({ id: session.id, text: "read", messageId: randomUUID() });
  manager.event(session.id, {
    type: "control_request",
    request_id: "permission",
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      input: { command: "pwd" },
    },
  });
  assert.equal((await manager.open(session.id)).permissions.length, 1);
  await manager.answer({
    id: session.id,
    requestId: "permission",
    allow: false,
  });
  assert.equal(
    children[0].child.received.at(-1).response.response.behavior,
    "deny",
  );
  await assert.rejects(
    manager.answer({ id: session.id, requestId: "permission", allow: true }),
    /结束/,
  );
  await manager.interrupt(session.id);
  assert.equal(children[0].child.received.at(-1).request.subtype, "interrupt");
});
test("streamed partials are replaced by completed messages, and idle release exits the process", async (t) => {
  const { manager, root } = await fixture(t),
    { session } = await manager.create({ cwd: root });
  await manager.send({
    id: session.id,
    text: "hello",
    messageId: randomUUID(),
  });
  manager.event(session.id, {
    type: "stream_event",
    event: { type: "message_start", message: { id: "m1" } },
  });
  manager.event(session.id, {
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
  });
  manager.event(session.id, {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "hello" },
    },
  });
  assert.equal(
    (await manager.open(session.id)).messages.at(-1).content[0].text,
    "hello",
  );
  manager.event(session.id, {
    type: "assistant",
    uuid: "completed",
    message: { content: [{ type: "text", text: "hello" }] },
  });
  manager.event(session.id, { type: "result", is_error: false });
  assert.equal(manager.busy, false);
  const opened = await manager.open(session.id);
  assert(!opened.messages.some((m) => m.partial));
  assert.equal(opened.messages.filter((m) => m.role === "assistant").length, 1);
  await manager.release(session.id);
  assert.equal(manager.runtime.size, 0);
});
test("saved sessions resume by UUID and arbitrary paths cannot be used as session IDs", async (t) => {
  const { manager, root, children } = await fixture(t),
    id = await savedSession(root);
  await manager.send({ id, text: "continue", messageId: randomUUID() });
  assert(children[0].args.includes("--resume"));
  await assert.rejects(manager.open("../../secret"), /无效/);
});

test("corrupt Claude metadata reports an error without an unhandled startup rejection", async (t) => {
  const { root } = await fixture(t);
  await writeFile(join(root, "bad.json"), "{bad");
  const manager = new ClaudeSessions({
    home: root,
    stateFile: join(root, "bad.json"),
  });
  await manager.initialized;
  await assert.rejects(manager.list(), /无法读取/);
  manager.close();
});

test("status retries never read history and settings persist with live controls", async (t) => {
  const { manager, children, root } = await fixture(t);
  const { session } = await manager.create({
    cwd: root,
    model: "sonnet",
    effort: "high",
  });
  await manager.configure({ id: session.id, model: "opus", effort: "low" });
  assert(children[0].args.includes("--effort"));
  assert.equal(
    children[0].child.received
      .filter((m) => m.request?.subtype === "set_model")
      .at(-1).request.model,
    "opus",
  );
  manager.sessions.get(session.id).path = join(root, "missing-history.jsonl");
  const status = await manager.status(session.id);
  assert.equal(status.session.model, "opus");
  assert.equal(status.session.effort, "low");
  await assert.rejects(
    manager.configure({ id: session.id, effort: "invalid" }),
    /无效/,
  );
  manager.event(session.id, { type: "result", is_error: false });
  await manager.send({
    id: session.id,
    text: "running",
    messageId: randomUUID(),
  });
  await assert.rejects(
    manager.configure({ id: session.id, model: "sonnet" }),
    /等待/,
  );
});

test("generated user records retain their origin and never become ordinary prompts", async () => {
  const { transcriptMessage } = await import("../src/claude-history.mjs");
  const record = {
    type: "user",
    uuid: randomUUID(),
    message: { content: "echo example\n".repeat(200) },
  };
  assert.equal(
    transcriptMessage(record).kind,
    "user",
    "long commands typed by a user stay user messages",
  );
  assert.equal(
    transcriptMessage({
      ...record,
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    }).kind,
    "context",
  );
  for (const flag of ["isMeta", "is_meta", "isVisibleInTranscriptOnly"])
    assert.equal(transcriptMessage({ ...record, [flag]: true }).kind, "system");
  assert.equal(
    transcriptMessage({
      ...record,
      message: {
        content: [
          { type: "tool_result", tool_use_id: "demo", content: "output" },
          { type: "text", text: "tool context" },
        ],
      },
    }).kind,
    "tool",
  );
});

test("old shared snapshots recover context markers from disk without restarting the owner", async (t) => {
  const { manager, root } = await fixture(t),
    id = await savedSession(root);
  await manager.send({ id, text: "continue", messageId: randomUUID() });
  const messageId = randomUUID(),
    path = manager.sessions.get(id).path;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(
    path,
    "\n" +
      JSON.stringify({
        type: "user",
        uuid: messageId,
        isCompactSummary: true,
        message: { content: "generated summary" },
      }) +
      "\n",
  );
  manager.runtime.get(id).messages.set(messageId, {
    id: messageId,
    role: "user",
    content: [{ type: "text", text: "generated summary" }],
  });
  const opened = await manager.open(id);
  assert.equal(opened.messages.find((m) => m.id === messageId).kind, "context");
  assert.equal(
    (await manager.status(id)).messages.find((m) => m.id === messageId).kind,
    "context",
  );
});
