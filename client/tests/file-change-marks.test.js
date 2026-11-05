import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
  fileChangeHighlights,
  turnFileChanges,
} from "../src/domain/file-changes.js";
import { fileChangeMarks } from "../src/features/workspace/file-change-marks.js";

const text = "before\nnew content\nafter\n";
const diff =
  "--- a/test\n+++ b/test\n@@ -2 +2 @@\n-old content\n+new content\n";

test("完整文件标记新增行并保留删除内容的原位置", () => {
  assert.deepEqual(fileChangeHighlights(text, diff), {
    added: [2],
    removed: [{ line: 2, oldLine: 2, lines: ["old content"] }],
    matches: true,
    firstLine: 2,
  });
  const field = fileChangeMarks(diff);
  let state = EditorState.create({ doc: text, extensions: [field] });
  const decorations = () => {
    const result = [];
    state.field(field).between(0, state.doc.length, (from, to, value) => {
      result.push({ from, to, value });
    });
    return result;
  };
  assert.equal(
    decorations().find(
      (range) => range.value.spec.class === "cm-file-change-added",
    ).from,
    state.doc.line(2).from,
  );
  assert.deepEqual(
    decorations().find((range) => range.value.spec.widget).value.spec.widget
      .group.lines,
    ["old content"],
  );
  assert.equal(state.doc.toString(), text);
  state = state.update({ changes: { from: 0, insert: "inserted\n" } }).state;
  assert.equal(
    decorations().find(
      (range) => range.value.spec.class === "cm-file-change-added",
    ).from,
    state.doc.line(3).from,
  );
  assert.equal(state.doc.toString(), "inserted\n" + text);
});

test("仅删除的区块标记删除后的间隙，覆盖文件开头和末尾", () => {
  const start = fileChangeHighlights("after\n", "@@ -1 +0,0 @@\n-deleted\n");
  assert.equal(start.removed[0].line, 1);
  const endDiff = "@@ -2 +1,0 @@\n-deleted\n";
  const end = fileChangeHighlights("before", endDiff);
  assert.equal(end.removed[0].line, 2);
  const field = fileChangeMarks(endDiff);
  const state = EditorState.create({ doc: "before", extensions: [field] });
  assert.equal(state.field(field).iter().from, state.doc.length);
});

test("当前文件与差异内容不匹配时保留完整内容并省略错位标记", () => {
  assert.deepEqual(fileChangeHighlights("before\nlater\nafter\n", diff), {
    added: [],
    removed: [],
    matches: false,
    firstLine: null,
  });
  assert.deepEqual(fileChangeHighlights("before", ""), {
    added: [],
    removed: [],
    matches: true,
    firstLine: null,
  });
  assert.equal(
    fileChangeHighlights(
      "recreated content",
      "--- a/test\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted content\n",
    ).matches,
    false,
  );
});

test("历史逐次补丁合成为净标记，中间版本和已抵消修改省略", () => {
  const records = [
    "@@ -2 +2,2 @@\n-original\n+intermediate\n+temporary\n",
    "@@ -2,2 +2 @@\n-intermediate\n-temporary\n+final\n",
  ].map((diff) => ({
    type: "fileChange",
    status: "completed",
    changes: [{ path: "test", kind: { type: "update" }, diff }],
  }));
  const file = turnFileChanges(records, undefined, "/fixture")[0];
  assert.deepEqual(
    fileChangeHighlights("before\nfinal\nafter\n", file.diff, file.patches),
    {
      added: [2],
      removed: [{ line: 2, oldLine: 2, lines: ["original"] }],
      matches: true,
      firstLine: 2,
    },
  );
  const reverted = file.patches.slice();
  reverted[1] = reverted[1].replace("+final", "+original");
  assert.deepEqual(
    fileChangeHighlights("before\noriginal\nafter\n", "", reverted),
    { added: [], removed: [], matches: true, firstLine: null },
  );
});

test("新增后再次编辑的文件保留全部新增标记，行号偏移按内容定位", () => {
  const file = turnFileChanges(
    [
      {
        type: "fileChange",
        status: "completed",
        changes: [
          { path: "test", kind: { type: "add" }, diff: "first\nold\nlast\n" },
        ],
      },
      {
        type: "fileChange",
        status: "completed",
        changes: [
          {
            path: "test",
            kind: { type: "update" },
            diff: "@@ -2 +2 @@\n-old\n+new\n",
          },
        ],
      },
    ],
    undefined,
    "/fixture",
  )[0];
  assert.deepEqual(
    fileChangeHighlights("first\nnew\nlast\n", file.diff, file.patches),
    { added: [1, 2, 3], removed: [], matches: true, firstLine: 1 },
  );
  const shifted = fileChangeHighlights(
    "later\nbefore\nnew content\nafter\n",
    diff,
  );
  assert.equal(shifted.matches, true);
  assert.deepEqual(shifted.added, [3]);
  assert.deepEqual(shifted.removed[0].lines, ["old content"]);
});
