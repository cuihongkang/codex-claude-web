import {
  textReferences,
  threadReferenceInstructions,
} from "./inline-references.js";
import { planApprovalLabel } from "./plans.js";
import { parseAnnotations } from "./annotations.js";

export function fileReferenceInput(file) {
  return {
    type: "text",
    text: `引用本机${file.directory ? "目录" : "文件"}：${file.path}\n请根据任务按需读取。`,
    text_elements: [],
  };
}

// 只识别完整的引用封装，普通正文中的路径和协议示例保持原样。
export function parseUserMessage(content = []) {
  const texts = [],
    annotations = [],
    references = [],
    attachments = [];
  const inline = content
    .filter((part) => part.type === "text")
    .flatMap((part) => textReferences(part.text || ""));
  for (const part of content) {
    if (part.type !== "text") {
      attachments.push(part);
      continue;
    }
    if (
      inline.some((ref) => ref.kind === "thread") &&
      part.text === threadReferenceInstructions(inline)
    )
      continue;
    const snapshot =
      /^引用会话：([^\n]+)\n会话 ID：([^\n]+)\n以下为(?:选择引用|提交)时的已保存对话正文：\n/.exec(
        part.text || "",
      );
    if (
      snapshot &&
      inline.some(
        (ref) =>
          ref.kind === "thread" &&
          ref.threadId === snapshot[2] &&
          (ref.name === snapshot[1] ||
            JSON.stringify(ref.name) === snapshot[1]),
      )
    )
      continue;
    const parsed = parseAnnotations(part.text);
    annotations.push(...parsed.annotations);
    let text = parsed.text || "";
    const command = /^\/([^\s]+) /.exec(text);
    if (
      command &&
      inline.some(
        (ref) => ref.kind === "skill" && ref.native && ref.name === command[1],
      )
    )
      text = text.slice(command[0].length);
    const desktop =
      /^\s*# Files mentioned by the user:\r?\n([\s\S]*?)\r?\n## My request(?: for Codex)?:\r?\n/.exec(
        text,
      );
    if (desktop) {
      const lines = desktop[1].split(/\r?\n/).filter((line) => line.trim());
      const files = lines.map((line) => /^## (.+): (\/[^\r\n]+)$/.exec(line));
      if (files.length && files.every(Boolean)) {
        references.push(
          ...files.map(([, name, path]) => ({
            name,
            path,
            directory: path.endsWith("/"),
          })),
        );
        text = text.slice(desktop[0].length);
      }
    }
    const legacyPattern =
      /(?:^|\r?\n)引用本机(目录|文件)：([^\r\n]+)\r?\n请根据任务按需读取。\s*$/;
    const files = [];
    let legacy;
    while ((legacy = legacyPattern.exec(text))) {
      const path = legacy[2];
      files.unshift({
        name: path.replace(/\/$/, "").split("/").at(-1),
        path,
        directory: legacy[1] === "目录",
      });
      text = text.slice(0, legacy.index);
    }
    references.push(...files);
    if (text.trim()) texts.push(text.trimEnd());
  }
  return { text: texts.join("\n"), annotations, references, attachments };
}

export function userMessageText(content) {
  const { text, annotations, references } = parseUserMessage(content);
  return [
    planApprovalLabel(text),
    ...annotations.map(
      (entry, index) => `注释 ${index + 1}：${entry.annotation || entry.text}`,
    ),
    ...references
      .filter((file) => !text.includes("@" + file.name))
      .map((file) => "@" + file.name),
  ]
    .filter(Boolean)
    .join("\n");
}
