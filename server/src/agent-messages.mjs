import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// 接收记录可能晚于发送调用落盘；完整 Fernet 封包按布局识别，避免暴露排队中的密文。
function isEncryptedEnvelope(text) {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(text)) return false;
  const packet = Buffer.from(text, "base64url");
  const encoded = packet.toString("base64url");
  // 版本 1 + 时间戳 8 + IV 16 + HMAC 32 字节；正文至少包含一个 16 字节块。
  return (
    packet[0] === 0x80 &&
    packet.length >= 73 &&
    (packet.length - 57) % 16 === 0 &&
    (text === encoded ||
      text === encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))
  );
}

// Rollout 中的调用正文补齐 app-server 子代理活动记录省略的发送内容。
async function scan(path, visit) {
  if (!path) throw new Error("对话记录路径暂不可用，请刷新重试。");
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    visit(record);
  }
}

export async function readAgentMessages(call, threadId) {
  const { thread } = await call("thread/read", {
    threadId,
    includeTurns: false,
  });
  const source = thread.source?.subAgent?.thread_spawn;
  const parentId = thread.parentThreadId || source?.parent_thread_id;
  if (!parentId) return { messages: [] };
  const { thread: parent } = await call("thread/read", {
    threadId: parentId,
    includeTurns: false,
  });
  const calls = new Map();
  const accepted = new Set();
  await scan(parent.path, ({ type, payload }) => {
    if (
      type === "response_item" &&
      payload.type === "function_call" &&
      payload.namespace === "collaboration" &&
      ["spawn_agent", "send_message", "followup_task"].includes(payload.name)
    ) {
      try {
        const args = JSON.parse(payload.arguments);
        if (typeof args.message === "string" && args.message.trim())
          calls.set(payload.call_id, args.message);
      } catch {
        /* 写入中的不完整调用在下一次读取时恢复。 */
      }
    }
    const item = payload?.item;
    if (
      type === "event_msg" &&
      item?.type === "SubAgentActivity" &&
      item.agent_thread_id === threadId &&
      ["started", "interacted"].includes(item.kind)
    )
      accepted.add(item.id);
  });
  const incoming = new Map();
  const encrypted = new Set();
  let current;
  const agentPath = source?.agent_path;
  const parentPath = agentPath?.slice(0, agentPath.lastIndexOf("/"));
  await scan(thread.path, ({ type, payload }) => {
    if (
      type === "response_item" &&
      payload.type === "agent_message" &&
      payload.recipient === agentPath &&
      payload.author === parentPath
    ) {
      for (const part of payload.content || [])
        if (part.type === "encrypted_content")
          encrypted.add(part.encrypted_content);
      current = incoming.get(payload.id) || {
        turnId: payload.internal_chat_message_metadata_passthrough?.turn_id,
      };
      incoming.set(payload.id, current);
    }
    if (
      current &&
      !current.beforeItemId &&
      type === "event_msg" &&
      payload.type === "item_completed" &&
      payload.turn_id === current.turnId
    )
      current.beforeItemId = payload.item.id;
  });
  const deliveries = [...incoming.values()];
  return {
    messages: [...calls]
      .filter(([id]) => accepted.has(id))
      .map(([id, text], index) => ({
        id: "parent-input-" + id,
        type: "userMessage",
        content: [
          {
            type: "text",
            text:
              encrypted.has(text) || isEncryptedEnvelope(text)
                ? "消息内容已加密"
                : text,
          },
        ],
        authorLabel: "主代理",
        ...deliveries[index],
      })),
  };
}
