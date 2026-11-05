import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// 只读追溯尚未整理的明文推理属于哪个已配置模型，修复中断切换后的旧会话。
export async function reasoningSource(path, providers, resolveParent) {
  if (!path) return null;
  let model, candidate;
  const visiting = new Set();
  async function inspect(file, end) {
    if (end === 0) return;
    if (visiting.has(file))
      throw new Error("Codex 分支历史存在循环引用，请检查对话记录。");
    visiting.add(file);
    const lines = createInterface({
      input: createReadStream(file, end === undefined ? {} : { end: end - 1 }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (
        record.type === "session_meta" &&
        record.payload.history_base &&
        resolveParent
      ) {
        const base = record.payload.history_base;
        const parent = await resolveParent(base.thread_id);
        await inspect(parent, base.end_byte_offset);
      }
      if (record.type === "turn_context") model = record.payload.model;
      if (record.type === "compacted") candidate = undefined;
      if (
        record.type === "response_item" &&
        record.payload.type === "reasoning" &&
        record.payload.content?.some(
          (part) => part.type === "reasoning_text" && part.text?.trim(),
        )
      )
        candidate = model;
    }
    visiting.delete(file);
  }
  await inspect(path);
  const matches = providers.filter(
    (provider) =>
      !provider.builtin &&
      !provider.requiresMigration &&
      provider.models.some((model) => model.id === candidate),
  );
  return matches.length === 1
    ? { providerId: matches[0].id, model: candidate }
    : null;
}
