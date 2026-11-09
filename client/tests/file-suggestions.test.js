import test from "node:test";
import assert from "node:assert/strict";
import { rankFileSuggestions } from "../src/domain/file-suggestions.js";
const file = (path) => ({
  path: "/work/" + path,
  name: path.split("/").at(-1),
});
const rank = (paths, query) =>
  rankFileSuggestions(paths.map(file), query, "/work").map((f) =>
    f.path.slice(6),
  );

test("跨目录按名称相关性排序，父目录匹配的子文件后置", () => {
  assert.deepEqual(
    rank(
      ["target/a.js", "target/b.js", "z/target.js", "target-extra", "target"],
      "target",
    ),
    ["target", "z/target.js", "target-extra", "target/a.js", "target/b.js"],
  );
});
test("相关性先于数量限制，遍历后部的精确结果进入首屏", () => {
  const files = [
    ...Array.from({ length: 80 }, (_, i) => file(`target/${i}.js`)),
    file("z/target"),
  ];
  assert.equal(
    rankFileSuggestions(files, "target", "/work").slice(0, 60)[0].path,
    "/work/z/target",
  );
});
test("路径输入按完整路径匹配，支持大小写、中文和跳字", () => {
  assert.deepEqual(rank(["src/target-old", "src/target"], "src/target"), [
    "src/target",
    "src/target-old",
  ]);
  assert.deepEqual(rank(["a/分析目录/x", "b/分析.md"], "分析"), [
    "b/分析.md",
    "a/分析目录/x",
  ]);
  assert.deepEqual(rank(["a/T---a---r---g---e---t", "b/Target"], "tgt"), [
    "b/Target",
    "a/T---a---r---g---e---t",
  ]);
});
test("同分保持原生顺序，目录浏览保持原有顺序且不修改输入", () => {
  const files = [file("b/target"), file("a/target")];
  const snapshot = structuredClone(files);
  assert.deepEqual(rankFileSuggestions(files, "target", "/work"), files);
  assert.equal(rankFileSuggestions(files, "", "/work"), files);
  assert.equal(rankFileSuggestions(files, "src/", "/work"), files);
  assert.deepEqual(files, snapshot);
});

test("精确、短前缀、长前缀、连续与跳字匹配依次排序", () => {
  assert.deepEqual(
    rank(["t-a-r", "x-target", "target-long", "target", "tar"], "tar"),
    ["tar", "target", "target-long", "x-target", "t-a-r"],
  );
});
