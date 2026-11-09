import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

async function instruction(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`读取项目指令失败（${path}）：${error.message}`, {
      cause: error,
    });
  }
}

// UserPromptSubmit calls this reader for each submission so /init and edits
// take effect immediately. Native CLAUDE.md loading remains owned by the CLI.
export async function readProjectInstructions(cwd) {
  const directories = [];
  let directory = resolve(cwd);
  while (true) {
    directories.unshift(directory);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const sections = [];
  for (const scope of directories) {
    let path = join(scope, "AGENTS.override.md");
    let content = await instruction(path);
    if (content === null) {
      path = join(scope, "AGENTS.md");
      content = await instruction(path);
    }
    if (content === null) continue;
    sections.push(
      `项目指令文件：${JSON.stringify(path)}\n适用范围：${JSON.stringify(scope)} 及其子目录。\n指令原文：\n\n${content}`,
    );
  }
  return `当前工作目录：${JSON.stringify(resolve(cwd))}\n本轮有效 AGENTS 项目指令以以下完整快照为准，本快照取代此前轮次中的 AGENTS 项目指令快照。文件按祖先目录到当前目录排列，分别约束其所在目录及子目录；同一事项存在冲突时，更具体目录中的规则优先。原生 CLAUDE.md 指令继续适用。\n\n${sections.length ? sections.join("\n\n---\n\n") : "当前有效 AGENTS 项目指令文件列表为空。"}`;
}
