import { appendReasoningSummary } from "./reasoning-summary.js";

const actions = {
  started: "启动子代理",
  interacted: "更新子代理",
  interrupted: "中断子代理",
  completed: "子代理完成",
  spawnAgent: "创建子代理",
  sendInput: "补充子代理任务",
  resumeAgent: "恢复子代理",
  wait: "等待子代理",
  closeAgent: "关闭子代理",
  sendMessage: "向子代理发送消息",
  followupTask: "追加子代理任务",
  interruptAgent: "中断子代理",
  listAgents: "查看子代理列表",
};

export const agentStatusLabels = {
  pendingInit: "正在启动",
  running: "运行中",
  inProgress: "运行中",
  interrupted: "已中断",
  completed: "已完成",
  errored: "出错",
  failed: "失败",
  shutdown: "已关闭",
  notFound: "未找到",
  unknown: "有活动记录",
};

export function isSubAgentItem(item) {
  return ["subAgentActivity", "collabAgentToolCall"].includes(item.type);
}

export function subAgentAction(item) {
  return actions[item.kind || item.tool] || "子代理活动";
}

export function subAgents(items) {
  const agents = new Map();
  for (const item of items) {
    if (!isSubAgentItem(item)) continue;
    const ids = item.agentThreadId
      ? [item.agentThreadId]
      : [
          ...new Set([
            ...(item.receiverThreadIds || []),
            ...Object.keys(item.agentsStates || {}),
          ]),
        ];
    for (const id of ids) {
      const previous = agents.get(id);
      const path = item.agentPath || previous?.path;
      const state = item.agentsStates?.[id];
      const eventStatus = {
        started: "running",
        interacted: "running",
        interrupted: "interrupted",
        completed: "completed",
      }[item.kind];
      agents.set(id, {
        id,
        path,
        name:
          path?.split("/").filter(Boolean).at(-1) ||
          previous?.name ||
          `子代理 ${agents.size + 1}`,
        status: state?.status || eventStatus || previous?.status || "unknown",
        message: state?.message || previous?.message,
        prompt: item.prompt || previous?.prompt,
        model: item.model || previous?.model,
        reasoningEffort: item.reasoningEffort || previous?.reasoningEffort,
      });
    }
  }
  return [...agents.values()];
}

export function applyAgentEvent(items, method, params) {
  const id = params.item?.id || params.itemId;
  const entries = new Map(items.map((item) => [item.id, item]));
  let item = entries.get(id);
  if (params.item) item = { ...item, ...params.item, turnId: params.turnId };
  else if (method === "item/agentMessage/delta")
    item = {
      ...item,
      id,
      turnId: params.turnId,
      type: "agentMessage",
      text: (item?.text || "") + params.delta,
    };
  else if (item && method === "item/commandExecution/outputDelta")
    item = {
      ...item,
      aggregatedOutput: (item.aggregatedOutput || "") + params.delta,
    };
  else if (method === "item/reasoning/summaryTextDelta") {
    const summary = appendReasoningSummary(
      item?.summary,
      params.summaryIndex,
      params.delta,
      params.summaryTitle,
    );
    item = { ...item, id, turnId: params.turnId, type: "reasoning", summary };
  }
  if (item) entries.set(id, item);
  return [...entries.values()];
}

export function withParentMessages(items, messages) {
  const result = [...items];
  const matched = new Set();
  for (const message of messages) {
    const text = message.content
      .map((part) => part.text || "")
      .join("\n")
      .trim();
    if (result.some((item) => item.id === message.id)) continue;
    const native = items.find(
      (item) =>
        !matched.has(item.id) &&
        !item.authorLabel &&
        item.type === "userMessage" &&
        item.turnId === message.turnId &&
        item.content
          ?.map((part) => part.text || "")
          .join("\n")
          .trim() === text,
    );
    if (native) {
      matched.add(native.id);
      result[result.indexOf(native)] = {
        ...native,
        authorLabel: message.authorLabel,
      };
      continue;
    }
    let index = result.findIndex((item) => item.id === message.beforeItemId);
    if (index < 0 && message.turnId) {
      const first = items.find((item) => item.turnId === message.turnId);
      index = result.findIndex((item) => item.id === first?.id);
    }
    result.splice(index < 0 ? result.length : index, 0, message);
  }
  return result;
}

// 分页快照可能已包含读取期间的部分流式文字，按最长前后缀重叠合并。
function mergeStreamText(snapshot = "", delta = "") {
  for (
    let length = Math.min(snapshot.length, delta.length);
    length > 0;
    length--
  )
    if (snapshot.endsWith(delta.slice(0, length)))
      return snapshot + delta.slice(length);
  return snapshot + delta;
}

export function mergeAgentHistory(items, events) {
  const history = new Map(items.map((item) => [item.id, item]));
  const full = new Set();
  let updates = [];
  for (const { method, params } of events) {
    const id = params.item?.id || params.itemId;
    if (params.item) full.add(id);
    if (
      method === "item/commandExecution/outputDelta" &&
      !updates.some((item) => item.id === id)
    )
      updates.push({ id, type: "commandExecution", turnId: params.turnId });
    updates = applyAgentEvent(updates, method, params);
  }
  for (const update of updates) {
    const snapshot = history.get(update.id);
    const item = { ...snapshot, ...update };
    if (snapshot && !full.has(update.id)) {
      if (update.text !== undefined)
        item.text = mergeStreamText(snapshot.text, update.text);
      if (update.aggregatedOutput !== undefined)
        item.aggregatedOutput = mergeStreamText(
          snapshot.aggregatedOutput,
          update.aggregatedOutput,
        );
      if (update.summary) {
        item.summary = [...(snapshot.summary || [])];
        update.summary.forEach((delta, index) => {
          const previous = item.summary[index];
          const text = mergeStreamText(
            typeof previous === "string" ? previous : previous?.text,
            typeof delta === "string" ? delta : delta.text,
          );
          const title = delta?.title || previous?.title;
          item.summary[index] = title ? { title, text } : text;
        });
      }
    }
    history.set(item.id, item);
  }
  return [...history.values()];
}
