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
  for (const part of content) {
    if (part.type !== "text") {
      attachments.push(part);
      continue;
    }
    const parsed = parseAnnotations(part.text);
    annotations.push(...parsed.annotations);
    let text = parsed.text || "";
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
    text,
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
