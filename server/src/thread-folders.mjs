import { mkdir, readFile, rename, writeFile, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";

// 网页项目归属与待应用目录由桥接保存；原生会话在下次恢复或开始轮次时应用目录。
export function createThreadFolders(directory) {
  const path = join(directory, "thread-folders.json");
  let entries = {};
  let loaded = false;
  let writing = Promise.resolve();
  async function read() {
    await writing;
    if (!loaded) {
      try {
        entries = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      loaded = true;
    }
    return entries;
  }
  function move(thread, folderPath) {
    if (
      typeof folderPath !== "string" ||
      (folderPath && !isAbsolute(folderPath))
    )
      throw new Error("请选择有效的项目文件夹");
    const operation = writing.then(async () => {
      if (folderPath && !(await stat(folderPath)).isDirectory())
        throw new Error("目标路径须为文件夹");
      const previous = entries[thread.id];
      const entry = {
        folderPath,
        cwd: folderPath || previous?.cwd || thread.cwd,
        folderRevision: (previous?.folderRevision || 0) + 1,
      };
      const next = { ...entries, [thread.id]: entry };
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      entries = next;
      return { ...thread, ...entry };
    });
    writing = operation.catch(() => {});
    return operation;
  }
  function project(thread) {
    return thread ? { ...thread, ...entries[thread.id] } : thread;
  }
  function result(value, method) {
    if (!value) return value;
    if (method === "thread/list")
      return { ...value, data: value.data.map(project) };
    if (value.thread) {
      const thread = project(value.thread);
      return { ...value, thread, ...(value.cwd && { cwd: thread.cwd }) };
    }
    return value;
  }
  function params(method, input) {
    const entry = entries[input.threadId];
    return entry && ["thread/resume", "turn/start"].includes(method)
      ? { ...input, cwd: entry.cwd }
      : input;
  }
  return { read, move, project, result, params };
}
