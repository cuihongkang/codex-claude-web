import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAgentMessages } from "../src/agent-messages.mjs";

test("从主对话调用恢复初始任务和后续消息，按子代理接收记录定位并隔离其他代理", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-messages-"));
  const parent = { id: "parent", path: join(directory, "parent.jsonl") };
  const child = {
    id: "child",
    parentThreadId: parent.id,
    path: join(directory, "child.jsonl"),
    source: { subAgent: { thread_spawn: { agent_path: "/root/review" } } },
  };
  const row = (type, payload) => ({ type, payload });
  const call = (id, name, message) =>
    row("response_item", {
      type: "function_call",
      namespace: "collaboration",
      name,
      call_id: id,
      arguments: JSON.stringify({ message }),
    });
  const activity = (id, agent_thread_id, kind) =>
    row("event_msg", {
      item: { type: "SubAgentActivity", id, agent_thread_id, kind },
    });
  const incoming = (id, turn_id, author = "/root") =>
    row("response_item", {
      type: "agent_message",
      id,
      author,
      recipient: "/root/review",
      internal_chat_message_metadata_passthrough: { turn_id },
    });
  const completed = (id, turn_id) =>
    row("event_msg", { type: "item_completed", turn_id, item: { id } });
  const save = (path, rows) =>
    writeFile(path, rows.map(JSON.stringify).join("\n") + '\n{"partial":');
  const requests = [];
  const rpc = async (method, params) => {
    requests.push({ method, params });
    return { thread: params.threadId === child.id ? child : parent };
  };
  try {
    await save(parent.path, [
      call("spawn", "spawn_agent", "检查接口"),
      activity("spawn", child.id, "started"),
      call("other", "spawn_agent", "其他代理内容"),
      activity("other", "other", "started"),
      call("follow", "followup_task", "继续检查"),
      activity("follow", child.id, "interacted"),
      call("failed", "send_message", "失败的消息"),
      call("queued", "send_message", "等待接收"),
      activity("queued", child.id, "interacted"),
    ]);
    await save(child.path, [
      incoming("incoming-1", "turn-1"),
      incoming("incoming-1", "turn-1"),
      completed("reasoning-1", "turn-1"),
      incoming("sibling", "turn-1", "/root/other"),
      incoming("incoming-2", "turn-2"),
      completed("answer-2", "turn-2"),
    ]);
    const { messages } = await readAgentMessages(rpc, child.id);
    assert.deepEqual(
      messages.map((m) => [m.content[0].text, m.turnId, m.beforeItemId]),
      [
        ["检查接口", "turn-1", "reasoning-1"],
        ["继续检查", "turn-2", "answer-2"],
        ["等待接收", undefined, undefined],
      ],
    );
    assert(messages.every((m) => m.authorLabel === "主代理"));
    assert(
      requests.every(
        (r) => r.method === "thread/read" && r.params.includeTurns === false,
      ),
    );
    child.path = join(directory, "missing.jsonl");
    await assert.rejects(readAgentMessages(rpc, child.id), /ENOENT/);
    delete child.parentThreadId;
    assert.deepEqual(await readAgentMessages(rpc, child.id), { messages: [] });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("加密接收记录替换为状态文字，保留明文和重复发送并隔离其他发送者", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-encryption-"));
  const parent = { id: "parent", path: join(directory, "parent.jsonl") };
  const child = {
    id: "child",
    parentThreadId: parent.id,
    path: join(directory, "child.jsonl"),
    source: { subAgent: { thread_spawn: { agent_path: "/root/check" } } },
  };
  const ciphertext = "gAAAAA" + "isolated-ciphertext_".repeat(40);
  const plaintext = "请检查接口，并解释 gAAAAA 前缀。";
  const opaque = "opaque-encrypted-payload";
  const messages = [ciphertext, plaintext, opaque, opaque];
  const parentRows = messages.flatMap((message, index) => [
    {
      type: "response_item",
      payload: {
        type: "function_call",
        namespace: "collaboration",
        name: index ? "send_message" : "spawn_agent",
        call_id: "call-" + index,
        arguments: JSON.stringify({ message }),
      },
    },
    {
      type: "event_msg",
      payload: {
        item: {
          type: "SubAgentActivity",
          id: "call-" + index,
          kind: index ? "interacted" : "started",
          agent_thread_id: child.id,
        },
      },
    },
  ]);
  const incoming = (index, content, author = "/root") => ({
    type: "response_item",
    payload: {
      type: "agent_message",
      id: "incoming-" + index,
      author,
      recipient: "/root/check",
      content,
      internal_chat_message_metadata_passthrough: { turn_id: "turn-" + index },
    },
  });
  const received = messages.map((text, index) =>
    incoming(index, [
      { type: "input_text", text: "Message Type: NEW_TASK\nPayload:\n" },
      index === 1
        ? { type: "input_text", text }
        : { type: "encrypted_content", encrypted_content: text },
    ]),
  );
  received.splice(
    1,
    0,
    received[0],
    incoming(
      "sibling",
      [{ type: "encrypted_content", encrypted_content: plaintext }],
      "/root/other",
    ),
  );
  try {
    await writeFile(parent.path, parentRows.map(JSON.stringify).join("\n"));
    await writeFile(child.path, received.map(JSON.stringify).join("\n"));
    const result = await readAgentMessages(
      async (_, { threadId }) => ({
        thread: threadId === child.id ? child : parent,
      }),
      child.id,
    );
    assert.deepEqual(
      result.messages.map((message) => [
        message.content[0].text,
        message.turnId,
      ]),
      [
        ["消息内容已加密", "turn-0"],
        [plaintext, "turn-1"],
        ["消息内容已加密", "turn-2"],
        ["消息内容已加密", "turn-3"],
      ],
    );
    assert(!JSON.stringify(result).includes(ciphertext));
    assert(!JSON.stringify(result).includes(opaque));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
