import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAgentMessages } from "../src/agent-messages.mjs";
import { bridge } from "../../tests/helpers/bridge.mjs";

test("接收记录落盘前隐藏完整加密封包，接收后保持状态和定位，保留明文及无效封包", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "agent-queued-"));
  const parent = { id: "parent", path: join(directory, "parent.jsonl") };
  const child = {
    id: "child",
    parentThreadId: parent.id,
    path: join(directory, "child.jsonl"),
    source: { subAgent: { thread_spawn: { agent_path: "/root/check" } } },
  };
  // 人工构造 Fernet 的版本、时间戳、IV、整块正文及 HMAC 布局。
  const packet = Buffer.alloc(57 + 16 * 8, 7);
  packet[0] = 0x80;
  packet.writeBigUInt64BE(1793544144n, 1);
  const token = packet.toString("base64url");
  const padded = packet
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
  const wrongVersion = Buffer.from(packet);
  wrongVersion[0] = 0x81;
  const plaintext = [
    "请解释 gAAAAA 前缀。",
    "gAAAAA" + "plain-text_".repeat(20),
    "示例封包：" + token,
    token + "\n请检查这个示例。",
    wrongVersion.toString("base64url"),
    packet.subarray(0, -1).toString("base64url"),
    packet.subarray(0, 57).toString("base64url"),
    token + "!",
    token + "A",
    token + "==",
  ];
  const texts = ["首次检查", token, padded, token, ...plaintext];
  const save = (path, rows) =>
    writeFile(path, rows.map(JSON.stringify).join("\n"));
  const received = (id, text, encrypted = false) => ({
    type: "response_item",
    payload: {
      type: "agent_message",
      id,
      author: "/root",
      recipient: "/root/check",
      content: [
        encrypted
          ? { type: "encrypted_content", encrypted_content: text }
          : { type: "input_text", text },
      ],
      internal_chat_message_metadata_passthrough: { turn_id: "turn" },
    },
  });
  const read = () =>
    readAgentMessages(
      async (_, { threadId }) => ({
        thread: threadId === child.id ? child : parent,
      }),
      child.id,
    );
  try {
    await save(
      parent.path,
      texts.flatMap((message, index) => [
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
      ]),
    );
    const initial = received("initial", texts[0]);
    await save(child.path, [initial]);
    const queued = await read();
    const expected = [
      "首次检查",
      ...Array(3).fill("消息内容已加密"),
      ...plaintext,
    ];
    assert.deepEqual(
      queued.messages.map((m) => m.content[0].text),
      expected,
    );
    assert.equal(queued.messages[1].turnId, undefined);
    assert.equal(queued.messages[2].turnId, undefined);
    assert.equal(queued.messages[3].turnId, undefined);
    const app = await bridge(t, (request, socket) => {
      if (request.method !== "thread/read") return false;
      socket.send(
        JSON.stringify({
          id: request.id,
          result: {
            thread: request.params.threadId === child.id ? child : parent,
          },
        }),
      );
      return true;
    });
    const socket = await app.connect();
    const readOverWss = () =>
      app.rpc(socket, "lan/agents/messages", { threadId: child.id });
    assert.deepEqual(await readOverWss(), queued);
    await save(child.path, [
      initial,
      received("queued", token, true),
      received("queued", token, true),
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "turn",
          item: { id: "answer-after-delivery" },
        },
      },
    ]);
    const delivered = await read();
    assert.deepEqual(
      delivered.messages.map((m) => m.content[0].text),
      expected,
    );
    assert.equal(delivered.messages.length, texts.length);
    assert.equal(delivered.messages[1].turnId, "turn");
    assert.equal(delivered.messages[1].beforeItemId, "answer-after-delivery");
    assert.equal(delivered.messages[2].turnId, undefined);
    assert.deepEqual(await readOverWss(), delivered);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
