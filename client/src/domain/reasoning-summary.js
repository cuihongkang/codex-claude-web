// 原生摘要保留首行标题；带显式标题的完整思考正文独立展开。
export function reasoningSummaries(summary = []) {
  return summary.flatMap((part) => {
    const text = (typeof part === "string" ? part : part?.text || "").trim();
    if (!text) return [];
    if (typeof part === "object" && part.title)
      return [{ title: part.title, body: text }];
    const [first, ...rest] = text.split(/\r?\n/);
    const title = first
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(\*\*|__)(.*?)\1$/, "$2")
      .trim();
    if (!title.replace(/[\s*_#`]/g, "")) return [];
    return [{ title, body: rest.join("\n").trim() }];
  });
}

export function appendReasoningSummary(summary, index, delta, title) {
  const result = [...(summary || [])];
  const previous = result[index];
  const text =
    (typeof previous === "string" ? previous : previous?.text || "") + delta;
  const heading = title || previous?.title;
  result[index] = heading ? { title: heading, text } : text;
  return result;
}
