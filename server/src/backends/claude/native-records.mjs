import {
  importSessionToStore,
  InMemorySessionStore,
} from "@anthropic-ai/claude-agent-sdk";

// SDK 负责记录发现、解析及消息链选择；临时原生快照补回 SessionMessage 省略的生命周期字段。
async function nativeRecords(operation, args) {
  const store = new InMemorySessionStore();
  const keys = new Map();
  const append = store.append.bind(store);
  store.append = (key, entries) => {
    keys.set(JSON.stringify(key), key);
    return append(key, entries);
  };
  const subagent = operation === "getSubagentMessages";
  await importSessionToStore(args[0], store, {
    ...args[subagent ? 2 : 1],
    includeSubagents: subagent,
  });
  const selected = [...keys.values()].filter((key) =>
    subagent
      ? key.subpath?.split("/").at(-1) === `agent-${args[1]}`
      : !key.subpath,
  );
  if (!selected.length)
    throw new Error("Claude 原生会话记录不存在，请刷新历史后重试");
  return selected.flatMap((key) => store.getEntries(key));
}

export async function enrichSessionMessages(operation, args, messages) {
  const raw = new Map(
    (await nativeRecords(operation, args))
      .filter((entry) => entry.uuid)
      .map((entry) => [entry.uuid, entry]),
  );
  return messages.map((message) => ({ ...raw.get(message.uuid), ...message }));
}

// 按 CLI 规则读取最后一条目标状态；sentinel 区分显式设置、清除及原生评估结果。
export async function readNativeGoalStatus(sessionId, options) {
  const records = await nativeRecords("getSessionMessages", [
    sessionId,
    options,
  ]);
  const entry = records.findLast(
    (entry) =>
      entry.type === "attachment" && entry.attachment?.type === "goal_status",
  );
  const failure =
    entry &&
    records
      .slice(records.indexOf(entry) + 1)
      .findLast(
        (record) =>
          record.type === "attachment" &&
          ["hook_non_blocking_error", "hook_error_during_execution"].includes(
            record.attachment?.type,
          ) &&
          record.attachment.hookEvent === "Stop" &&
          record.attachment.command === entry.attachment.condition,
      );
  return entry
    ? {
        ...entry.attachment,
        nativeRecordId: entry.uuid,
        nativeTimestamp: entry.timestamp,
        ...(failure && {
          evaluationError: {
            ...failure.attachment,
            nativeRecordId: failure.uuid,
            nativeTimestamp: failure.timestamp,
          },
        }),
      }
    : null;
}
