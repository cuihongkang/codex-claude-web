// 标准 Messages 端点通过顶层 system 接收系统上下文，指令优先级保持为系统级。
export function messagesRequest(value) {
  if (!Array.isArray(value.messages)) return value;
  const system =
    typeof value.system === "string"
      ? [{ type: "text", text: value.system }]
      : [...(value.system || [])];
  const messages = [];
  for (const message of value.messages) {
    if (message.role !== "system") {
      messages.push(message);
      continue;
    }
    const blocks =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content;
    for (const block of blocks) {
      if (block.type !== "text")
        throw new Error(
          `标准 Messages 系统上下文包含未适配的内容类型：${block.type}`,
        );
      system.push(block);
    }
  }
  // Anthropic 省略 thinking 表示关闭；明确传递该语义，保留原生主请求的 adaptive。
  const result = {
    ...value,
    messages,
    ...(value.thinking === undefined && { thinking: { type: "disabled" } }),
    ...(system.length && { system }),
  };
  return result;
}
