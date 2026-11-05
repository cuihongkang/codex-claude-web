export const summaryTag = "切换模型所用的对话摘要：";

export function portableInput(items, summary) {
  const compacted = items.findLastIndex((item) =>
    ["compaction", "context_compaction"].includes(item.type),
  );
  if (compacted < 0) return items;
  if (!summary)
    throw new Error(
      "此对话包含原生加密整理，请先在网页完成供应商切换以导出上下文摘要。",
    );
  return items.flatMap((item, index) =>
    index === compacted
      ? [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: summaryTag + "\n" + summary },
            ],
          },
        ]
      : ["compaction", "context_compaction"].includes(item.type)
        ? []
        : [item],
  );
}
