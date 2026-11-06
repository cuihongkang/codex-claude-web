import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  lstat,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changesForPath, undoFileChanges } from "../src/file-undo.mjs";

const change = (path, diff, type = "update", move_path = null) => ({
  path,
  diff,
  kind: { type, move_path },
});
const patch = (before, after) =>
  `--- a/test\n+++ b/test\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
async function directory(t) {
  const cwd = await mkdtemp(join(tmpdir(), "claudex-web-undo-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}
test("非 Git 目录中逆序撤销同文件多次修改，保留其他行和文件", async (t) => {
  const cwd = await directory(t);
  await writeFile(join(cwd, "test"), "third\nunrelated\n", { mode: 0o755 });
  await chmod(join(cwd, "test"), 0o755);
  await writeFile(join(cwd, "other"), "keep");
  await undoFileChanges({
    cwd,
    changes: [
      change("test", patch("first", "second")),
      change("test", patch("second", "third")),
    ],
  });
  assert.equal(await readFile(join(cwd, "test"), "utf8"), "first\nunrelated\n");
  assert.equal((await lstat(join(cwd, "test"))).mode & 0o777, 0o755);
  assert.equal(await readFile(join(cwd, "other"), "utf8"), "keep");
});
test("冲突和运行中任务保留当前内容", async (t) => {
  const cwd = await directory(t);
  const changes = [change("test", patch("first", "second"))];
  await writeFile(join(cwd, "test"), "later\n");
  await assert.rejects(undoFileChanges({ cwd, changes }), /冲突/);
  assert.equal(await readFile(join(cwd, "test"), "utf8"), "later\n");
  await writeFile(join(cwd, "test"), "second\n");
  await assert.rejects(
    undoFileChanges({ cwd, changes, isActive: () => true }),
    /任务正在运行/,
  );
  assert.equal(await readFile(join(cwd, "test"), "utf8"), "second\n");
});
test("新增和删除补丁支持无末尾换行，新增文件冲突时保留", async (t) => {
  const cwd = await directory(t);
  const add = change(
    "test",
    "--- /dev/null\n+++ b/test\n@@ -0,0 +1 @@\n+hello\n\\ No newline at end of file\n",
    "add",
  );
  await writeFile(join(cwd, "test"), "hello");
  await undoFileChanges({ cwd, changes: [add] });
  await assert.rejects(readFile(join(cwd, "test")), { code: "ENOENT" });
  await undoFileChanges({
    cwd,
    changes: [
      change(
        "test",
        "--- a/test\n+++ /dev/null\n@@ -1 +0,0 @@\n-hello\n\\ No newline at end of file\n",
        "delete",
      ),
    ],
  });
  assert.equal(await readFile(join(cwd, "test"), "utf8"), "hello");
  await writeFile(join(cwd, "test"), "later");
  await assert.rejects(undoFileChanges({ cwd, changes: [add] }), /冲突/);
  assert.equal(await readFile(join(cwd, "test"), "utf8"), "later");
});
test("移动恢复原路径，保护原路径新文件和符号链接", async (t) => {
  const cwd = await directory(t);
  const changes = [change("old", patch("first", "second"), "update", "new")];
  await writeFile(join(cwd, "new"), "second\n");
  await writeFile(join(cwd, "old"), "keep");
  await assert.rejects(undoFileChanges({ cwd, changes }), /原路径已有文件/);
  await rm(join(cwd, "old"));
  await undoFileChanges({ cwd, changes });
  assert.equal(await readFile(join(cwd, "old"), "utf8"), "first\n");
  await assert.rejects(readFile(join(cwd, "new")), { code: "ENOENT" });
  await symlink(join(cwd, "old"), join(cwd, "link"));
  await assert.rejects(
    undoFileChanges({
      cwd,
      changes: [change("link", patch("first", "second"))],
    }),
    /普通文本文件/,
  );
});
test("服务端从完成记录提取目标文件，忽略失败修改并合并移动链", () => {
  const items = [
    {
      type: "fileChange",
      status: "completed",
      changes: [change("old", "", "update", "new")],
    },
    {
      type: "fileChange",
      status: "failed",
      changes: [change("new", "failed")],
    },
    {
      type: "fileChange",
      status: "completed",
      changes: [change("new", "edit")],
    },
  ];
  assert.equal(changesForPath(items, "/repo", "/repo/new").length, 2);
  assert.deepEqual(changesForPath(items, "/repo", "/other"), []);
});
test("完整内容记录支持新增和删除，原路径已有内容时保留", async (t) => {
  const cwd = await directory(t);
  await writeFile(join(cwd, "test"), "hello\n");
  await undoFileChanges({ cwd, changes: [change("test", "hello\n", "add")] });
  await assert.rejects(readFile(join(cwd, "test")), { code: "ENOENT" });
  await undoFileChanges({
    cwd,
    changes: [change("test", "hello\n", "delete")],
  });
  assert.equal(await readFile(join(cwd, "test"), "utf8"), "hello\n");
  await assert.rejects(
    undoFileChanges({ cwd, changes: [change("test", "other\n", "delete")] }),
    /原路径已有文件/,
  );
  assert.equal(await readFile(join(cwd, "test"), "utf8"), "hello\n");
  const content = "@@ -1 +1 @@\n-old\n+new\n";
  await writeFile(join(cwd, "test"), content);
  await undoFileChanges({ cwd, changes: [change("test", content, "add")] });
  await undoFileChanges({ cwd, changes: [change("test", content, "delete")] });
  assert.equal(await readFile(join(cwd, "test"), "utf8"), content);
});
