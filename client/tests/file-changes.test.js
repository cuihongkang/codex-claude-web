import test from "node:test";
import assert from "node:assert/strict";
import {
  changePath,
  diffStats,
  unifiedFiles,
  turnFileChanges,
  diffRows,
} from "../src/domain/file-changes.js";

const change = (path, diff, type = "update", move_path = null) => ({
  path,
  diff,
  kind: { type, move_path },
});
const item = (changes, status = "completed") => ({
  type: "fileChange",
  status,
  changes,
});
const patch =
  "--- a/main.js\n+++ b/main.js\n@@ -1,2 +1,3 @@\n-old\n+new\n+++literal\n same\n";

test("差异行号从区块坐标开始，删除仅推进原行号，新增仅推进新行号", () => {
  const rows = diffRows(
    "--- a/test\n+++ b/test\n@@ -100,4 +100,3 @@\n same\n-removed\n-removed again\n+added\n tail\n@@ -200 +199 @@\n-old\n+new\n\\ No newline at end of file\n",
  );
  assert.deepEqual(
    rows.map((row) => [row.text, row.oldLine, row.newLine]),
    [
      ["--- a/test", null, null],
      ["+++ b/test", null, null],
      [" same", 100, 100],
      ["-removed", 101, null],
      ["-removed again", 102, null],
      ["+added", null, 101],
      [" tail", 103, 102],
      ["-old", 200, null],
      ["+new", null, 199],
      ["\\ No newline at end of file", null, null],
    ],
  );
});
test("新增、删除和多文件差异分别使用各自坐标，代码中的加减号保留高亮", () => {
  const rows = diffRows(
    "diff --git a/new b/new\n--- /dev/null\n+++ b/new\n@@ -0,0 +1,2 @@\n+++ code\n+second\ndiff --git a/old b/old\n--- a/old\n+++ /dev/null\n@@ -7,2 +0,0 @@\n--- code\n-old\n",
  );
  assert.deepEqual(
    rows
      .filter((row) => row.className === "diff-add")
      .map((row) => [row.oldLine, row.newLine]),
    [
      [null, 1],
      [null, 2],
    ],
  );
  assert.deepEqual(
    rows
      .filter((row) => row.className === "diff-remove")
      .map((row) => [row.oldLine, row.newLine]),
    [
      [7, null],
      [8, null],
    ],
  );
  assert.deepEqual(
    diffRows("raw source").map((row) => [row.oldLine, row.newLine]),
    [[null, null]],
  );
});

test("文件统计只计算差异正文，保留以加减号开头的代码行", () => {
  assert.deepEqual(diffStats(patch), { added: 2, removed: 1 });
  assert.deepEqual(diffStats("hello\nworld\n", "add"), {
    added: 2,
    removed: 0,
  });
  assert.deepEqual(diffStats("hello", "delete"), { added: 0, removed: 1 });
  assert.deepEqual(diffStats("@@ -1 +1 @@\n-text\n+text\n", "add"), {
    added: 3,
    removed: 0,
  });
  assert.match(
    turnFileChanges(
      [item([change("new.txt", "@@ -1 +1 @@\n-text\n+text\n", "add")])],
      undefined,
      "/repo",
    )[0].diff,
    /\+@@ -1 \+1 @@\n\+-text\n\+\+text/,
  );
});
test("路径按对话目录解析，统一绝对和相对引用", () => {
  assert.equal(
    changePath("../src/./main.js", "/repo/docs"),
    "/repo/src/main.js",
  );
  assert.equal(changePath("/repo/src/main.js", "/other"), "/repo/src/main.js");
});
test("统一差异区分新增、删除和 Git 引号路径", () => {
  const files = unifiedFiles(
    'diff --git a/new b/new\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+x\ndiff --git a/old b/old\n--- a/old\n+++ /dev/null\n@@ -1 +0,0 @@\n-y\ndiff --git "a/\\346\\226\\207.txt" "b/\\346\\226\\207.txt"\n--- "a/\\346\\226\\207.txt"\n+++ "b/\\346\\226\\207.txt"\n@@ -1 +1 @@\n-a\n+b\n',
    "/repo",
  );
  assert.deepEqual(
    files.map((f) => [f.path, f.kind, f.added, f.removed]),
    [
      ["/repo/new", "add", 1, 0],
      ["/repo/old", "delete", 0, 1],
      ["/repo/文.txt", "update", 1, 1],
    ],
  );
});
test("同轮重复修改合并，排除运行中、失败和拒绝的记录", () => {
  const files = turnFileChanges(
    [
      item([change("main.js", patch)]),
      item([change("/repo/main.js", patch)]),
      ...["failed", "declined", "inProgress"].map((status) =>
        item([change("other", patch)], status),
      ),
    ],
    undefined,
    "/repo",
  );
  assert.equal(files.length, 1);
  assert.equal(files[0].changes.length, 2);
  assert.equal(files[0].added, 4);
  assert.equal(files[0].removed, 2);
});
test("实时轮次净差异覆盖累计统计，空净差异隐藏已抵消的修改", () => {
  const items = [
    item([change("main.js", patch)]),
    item([change("main.js", patch)]),
  ];
  const files = turnFileChanges(
    items,
    "diff --git a/main.js b/main.js\n" + patch,
    "/repo",
  );
  assert.equal(files[0].added, 2);
  assert.equal(files[0].changes.length, 2);
  assert.deepEqual(turnFileChanges(items, "", "/repo"), []);
});
test("文件移动与后续修改合并在目标文件中", () => {
  const files = turnFileChanges(
    [
      item([change("old", patch, "update", "new")]),
      item([change("new", patch)]),
    ],
    undefined,
    "/repo",
  );
  assert.equal(files.length, 1);
  assert.equal(files[0].oldPath, "/repo/old");
  assert.equal(files[0].path, "/repo/new");
  assert.equal(files[0].changes.length, 2);
});
test("纯重命名与带空格的路径保留汇总，未知净差异使用历史记录", () => {
  const renamed = unifiedFiles(
    "diff --git a/old name b/new name\nsimilarity index 100%\nrename from old name\nrename to new name\n",
    "/repo",
  );
  assert.equal(renamed[0].oldPath, "/repo/old name");
  assert.equal(renamed[0].path, "/repo/new name");
  assert.equal(renamed[0].added, 0);
  assert.equal(
    turnFileChanges(
      [item([change("test", patch)])],
      "Binary files differ",
      "/repo",
    ).length,
    1,
  );
});
