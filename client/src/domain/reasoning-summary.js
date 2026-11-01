// app-server 的每个摘要段落独立显示标题和可选正文。
export function reasoningSummaries(summary = []) {
  return summary.flatMap((part) => {
    const text = (typeof part === "string" ? part : part?.text || "").trim();
    if (!text) return [];
    const [first, ...rest] = text.split(/\r?\n/);
    const title = first
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(\*\*|__)(.*?)\1$/, "$2")
      .trim();
    if (!title.replace(/[\s*_#`]/g, "")) return [];
    return [{ title, body: rest.join("\n").trim() }];
  });
}
