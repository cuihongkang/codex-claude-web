import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  lstat,
  readFile,
  writeFile,
  unlink,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const exec = promisify(execFile);

export function changesForPath(items, cwd, path) {
  const files = new Map();
  for (const item of items) {
    if (item.type !== "fileChange" || item.status !== "completed") continue;
    for (const change of item.changes || []) {
      const before = resolve(cwd, change.path);
      const after = resolve(cwd, change.kind?.move_path || change.path);
      const changes = files.get(before) || [];
      if (before !== after) files.delete(before);
      files.set(after, [...changes, change]);
    }
  }
  return files.get(resolve(cwd, path)) || [];
}

async function snapshot(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error("仅支持撤销普通文本文件的修改。");
    const data = await readFile(path);
    if (data.includes(0) || !Buffer.from(data.toString("utf8")).equals(data))
      throw new Error("此文件包含二进制内容，请在文件面板检查。");
    return { data, mode: info.mode };
  } catch (error) {
    if (error.code === "ENOENT") return { data: null };
    throw error;
  }
}

function equal(a, b) {
  return a === null ? b === null : b !== null && a.equals(b);
}

// 在临时文件上逆序校验每次补丁，再核对源文件快照，最后写回单个文件的结果。
export async function undoFileChanges({
  cwd,
  changes,
  isActive = () => false,
}) {
  if (!changes.length) throw new Error("此轮没有可撤销的文件修改。");
  const paths = [
    ...new Set(
      changes.flatMap((c) => [
        resolve(cwd, c.path),
        resolve(cwd, c.kind?.move_path || c.path),
      ]),
    ),
  ];
  const snapshots = new Map();
  for (const path of paths) snapshots.set(path, await snapshot(path));
  const last = changes.at(-1);
  const currentPath = resolve(cwd, last.kind?.move_path || last.path);
  let path = currentPath;
  let data = snapshots.get(currentPath).data;
  const scratch = await mkdtemp(join(tmpdir(), "claudex-web-undo-"));
  try {
    for (const change of changes.slice().reverse()) {
      const before = resolve(cwd, change.path);
      const after = resolve(cwd, change.kind?.move_path || change.path);
      if (path !== after)
        throw new Error("文件移动记录不完整，请重新加载对话。");
      const kind = change.kind?.type;
      const hunk =
        kind === "update" || /^--- .+\n\+\+\+ .+\n/m.test(change.diff)
          ? change.diff.search(/^@@ /m)
          : -1;
      if (hunk >= 0) {
        const oldName = kind === "add" ? "/dev/null" : "a/file";
        const newName = kind === "delete" ? "/dev/null" : "b/file";
        await rm(join(scratch, "file"), { force: true });
        if (data !== null) await writeFile(join(scratch, "file"), data);
        await writeFile(
          join(scratch, "patch"),
          `--- ${oldName}\n+++ ${newName}\n${change.diff.slice(hunk)}`,
        );
        try {
          await exec(
            "git",
            [
              "apply",
              "--reverse",
              "--unidiff-zero",
              "--whitespace=nowarn",
              "patch",
            ],
            { cwd: scratch, timeout: 30000 },
          );
        } catch (error) {
          if (error.code === "ENOENT")
            throw new Error("服务环境缺少 Git，请安装 Git 后重试。");
          throw new Error(
            "撤销补丁校验失败，差异格式或当前内容存在冲突。已保留当前文件，请查看变更后处理。",
          );
        }
        data = (await snapshot(join(scratch, "file"))).data;
      } else if (kind === "add") {
        if (!equal(data, Buffer.from(change.diff)))
          throw new Error("新增文件已有后续修改，已保留当前内容。");
        data = null;
      } else if (kind === "delete") {
        if (data !== null) throw new Error("原路径已有文件，已保留当前内容。");
        data = Buffer.from(change.diff);
      } else if (before === after || change.diff.trim()) {
        throw new Error("此修改缺少可撤销的统一差异，请在文件面板检查。");
      }
      path = before;
    }
    if (path !== currentPath && snapshots.get(path).data !== null)
      throw new Error("原路径已有文件，已保留当前内容。");
    if (isActive()) throw new Error("任务正在运行，请在结束后撤销修改。");
    for (const [file, saved] of snapshots) {
      if (!equal(saved.data, (await snapshot(file)).data))
        throw new Error("校验期间文件发生变化，请检查内容后重试。");
    }
    if (data !== null)
      await writeFile(path, data, {
        flag: snapshots.get(path).data === null ? "wx" : "w",
        mode: snapshots.get(currentPath).mode,
      });
    if (currentPath !== path || data === null) {
      if (snapshots.get(currentPath).data !== null) await unlink(currentPath);
    }
    return { path, currentPath };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
