import { executionError } from "./execution-errors.mjs";

function imageUrl(block) {
  return block.source?.type === "base64"
    ? `data:${block.source.media_type};base64,${block.source.data}`
    : block.source?.url;
}

export function contentBlocks(message) {
  const content = message.message?.content;
  return typeof content === "string"
    ? [{ type: "text", text: content }]
    : content || [];
}
export function visibleSessionMessages(messages, internalInputIds = {}) {
  const promptIds = new Set(
    messages
      .filter((message) => internalInputIds[message.uuid])
      .map((message) => message.promptId)
      .filter(Boolean),
  );
  return messages.filter(
    (message) =>
      !internalInputIds[message.uuid] &&
      !promptIds.has(message.promptId) &&
      !(
        message.type === "system" &&
        message.subtype === "local_command" &&
        internalInputIds[message.parentUuid]
      ),
  );
}
export function convertMessage(
  message,
  turnId,
  tools = new Map(),
  mode = "default",
  blockOffset = 0,
) {
  if (
    message.isApiErrorMessage ||
    message.isMeta ||
    message.is_meta ||
    message.isCompactSummary ||
    message.isVisibleInTranscriptOnly ||
    (message.type === "assistant" && message.error)
  )
    return [];
  const blocks = contentBlocks(message),
    items = [];
  const messageId = message.message?.id || message.uuid;
  if (message.type === "user") {
    const content = blocks
      .filter((b) => ["text", "image"].includes(b.type))
      .map((b) =>
        b.type === "text"
          ? b
          : {
              type: "image",
              url: imageUrl(b),
            },
      );
    if (content.length && isUserPrompt(message))
      items.push({ id: message.uuid, turnId, type: "userMessage", content });
    for (const block of blocks.filter((b) => b.type === "tool_result")) {
      const prior = tools.get(block.tool_use_id);
      if (prior) {
        const text =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content || []);
        const item = {
          ...prior,
          status: block.is_error ? "failed" : "completed",
          ...(prior.type === "commandExecution"
            ? { aggregatedOutput: text, exitCode: block.is_error ? 1 : 0 }
            : {
                result: block.content,
                contentItems:
                  typeof block.content === "string"
                    ? [{ type: "text", text: block.content }]
                    : (block.content || []).map((content) =>
                        content.type === "image"
                          ? { ...content, url: imageUrl(content) }
                          : content,
                      ),
                error: block.is_error ? text : null,
              }),
        };
        tools.set(item.id, item);
        items.push(item);
      }
    }
    return items;
  }
  if (message.type === "system" && message.subtype === "compact_boundary")
    return [
      {
        id: message.uuid,
        turnId,
        type: "contextCompaction",
        status: "completed",
      },
    ];
  if (message.type !== "assistant") return items;
  blocks.forEach((block, index) => {
    const id = `${messageId}-${blockOffset + index}`;
    if (block.type === "text")
      items.push({
        id,
        turnId,
        type:
          mode === "plan" && message.message?.stop_reason === "end_turn"
            ? "plan"
            : "agentMessage",
        text: block.text,
        phase:
          message.message?.stop_reason === "end_turn"
            ? "final_answer"
            : "commentary",
      });
    if (block.type === "thinking")
      items.push({
        id,
        turnId,
        type: "reasoning",
        summary: [{ title: "思考", text: block.thinking }],
      });
    if (block.type === "redacted_thinking")
      items.push({
        id,
        turnId,
        type: "reasoning",
        summary: [{ title: "思考", text: "思考内容已加密" }],
      });
    if (block.type === "tool_use") {
      const item =
        block.name === "Bash"
          ? {
              id: block.id,
              turnId,
              type: "commandExecution",
              command: block.input.command,
              cwd: "",
              status: "inProgress",
              aggregatedOutput: "",
            }
          : {
              id: block.id,
              turnId,
              type: "dynamicToolCall",
              tool: block.name,
              arguments: block.input,
              status: "inProgress",
              contentItems: [],
            };
      tools.set(block.id, item);
      items.push(item);
    }
  });
  return items;
}
export function isUserPrompt(message) {
  return (
    message.type === "user" &&
    !message.isMeta &&
    !message.is_meta &&
    !message.isCompactSummary &&
    !message.isVisibleInTranscriptOnly &&
    !message.isSynthetic &&
    message.origin?.kind !== "task-notification" &&
    contentBlocks(message).some((block) =>
      ["text", "image"].includes(block.type),
    )
  );
}
export function historyTurns(
  messages,
  savedTurns = {},
  turnIds = {},
  inputTurns = {},
) {
  const turns = [],
    tools = new Map(),
    blockOffsets = new Map();
  const anchors = new Map(
    Object.values(savedTurns).flatMap((saved) =>
      [saved.nativeAnchorId, ...(saved.nativeMessageIds || [])]
        .filter(Boolean)
        .map((id) => [id, saved.id]),
    ),
  );
  let turn;
  for (const message of messages) {
    const anchorId = anchors.get(message.uuid);
    if (isUserPrompt(message) || anchorId) {
      const id =
        anchorId ||
        turnIds[message.uuid] ||
        inputTurns[message.uuid] ||
        message.uuid;
      turn = turns.find((existing) => existing.id === id);
      if (!turn) {
        turn = {
          id,
          status: "completed",
          startedAt: message.timestamp
            ? Date.parse(message.timestamp) / 1000
            : undefined,
          ...savedTurns[id],
          items: [],
        };
        turns.push(turn);
      }
    }
    if (!turn) continue;
    if (
      message.isApiErrorMessage ||
      (message.type === "assistant" && message.error)
    ) {
      turn.status = "failed";
      turn.error = executionError({
        message: contentBlocks(message)
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n"),
      });
    }
    if (
      message.type === "assistant" &&
      !message.isApiErrorMessage &&
      !message.error &&
      message.message?.stop_reason === "end_turn" &&
      savedTurns[turn.id]?.status !== "failed"
    ) {
      turn.status = savedTurns[turn.id]?.status || "completed";
      delete turn.error;
    }
    const converted = convertMessage(
      message,
      turn.id,
      tools,
      turn.mode,
      blockOffsets.get(message.message?.id || message.uuid) || 0,
    );
    if (
      (converted.length || message.isApiErrorMessage || message.error) &&
      message.timestamp &&
      ["completed", "failed", "interrupted"].includes(turn.status) &&
      !Number.isFinite(savedTurns[turn.id]?.completedAt)
    )
      turn.completedAt = Date.parse(message.timestamp) / 1000;
    const messageId = message.message?.id || message.uuid;
    const blockOffset = blockOffsets.get(messageId) || 0;
    if (message.type === "assistant")
      blockOffsets.set(messageId, blockOffset + contentBlocks(message).length);
    for (const item of converted) {
      if (["agentMessage", "plan"].includes(item.type)) {
        const saved = savedTurns[turn.id]?.items?.find(
          (entry) => entry.id === item.id,
        );
        if (saved && ["agentMessage", "plan"].includes(saved.type)) {
          item.type = saved.type;
          item.phase = saved.phase;
        }
      }
      if (item.type === "userMessage" && turnIds[item.id])
        item.id = turnIds[item.id];
      const existing = turn.items.findIndex((i) => i.id === item.id);
      if (existing >= 0) turn.items[existing] = item;
      else turn.items.push(item);
    }
  }
  return turns;
}
export function inputMessage(input) {
  return input.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "image") {
      const match = /^data:([^;]+);base64,(.+)$/s.exec(part.url);
      if (!match) throw new Error("Claude 图片需要内嵌图片数据");
      return {
        type: "image",
        source: { type: "base64", media_type: match[1], data: match[2] },
      };
    }
    if (part.type === "skill")
      throw new Error("请移除旧技能附件，并从技能菜单重新选择原生命令。");
    throw new Error(`Claude 暂不支持此附件类型：${part.type}`);
  });
}
