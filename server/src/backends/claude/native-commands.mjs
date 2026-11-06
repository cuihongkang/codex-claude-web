import { randomUUID } from "node:crypto";

// 原生本地命令共用输入流，按独立 UUID 结算；命令确认与用户轮次、模型输入分别处理。
export function createNativeCommands(input, sessionId, record) {
  const pending = new Map();
  return {
    get busy() {
      return pending.size > 0;
    },
    async run(text) {
      const uuid = randomUUID();
      await record(uuid);
      return new Promise((resolve, reject) => {
        pending.set(uuid, { resolve, reject });
        input.push({
          type: "user",
          uuid,
          session_id: sessionId,
          parent_tool_use_id: null,
          isSynthetic: true,
          message: { role: "user", content: text },
        });
      });
    },
    accept(message) {
      if (message.type === "result") {
        const ids = message.user_message_uuids || [message.user_message_uuid];
        const matches = ids.filter((id) => pending.has(id));
        if (!matches.length) return false;
        for (const id of matches) {
          const request = pending.get(id);
          pending.delete(id);
          if (message.is_error || message.subtype !== "success")
            request.reject(
              new Error(message.result || message.errors?.join("\n")),
            );
          else request.resolve(message);
        }
        return true;
      }
      return message.type === "user" && pending.has(message.uuid);
    },
    close(error) {
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    },
  };
}
