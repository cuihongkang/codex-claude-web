import assert from "node:assert/strict";
import test from "node:test";
import { nextForkTitle } from "../src/fork-title.js";

const root = { id: "root", name: "汇总最新训练进展" };
const branch = (id, name, parent = root.id) => ({
  id,
  name,
  forkedFromId: parent,
});

test("同一家族的连续分支和并列分支使用最大编号加一", () => {
  const records = [root];
  let source = root;
  for (let number = 2; number <= 12; number++) {
    const name = nextForkTitle(source, records);
    assert.equal(name, `${root.name} (${number})`);
    source = branch(`fork-${number}`, name, source.id);
    records.push(source);
  }
  assert.equal(nextForkTitle(root, records), `${root.name} (13)`);
});

test("同名的独立对话及手动改名的分支各自编号", () => {
  const second = branch("second", `${root.name} (2)`);
  const renamed = branch("renamed", "整理结果 (5)", second.id);
  const other = { id: "other", name: root.name };
  const records = [root, second, renamed, other];
  assert.equal(nextForkTitle(other, records), `${root.name} (2)`);
  assert.equal(nextForkTitle(renamed, records), "整理结果 (5) (2)");
  assert.equal(nextForkTitle(root, records), `${root.name} (3)`);
  assert.equal(
    nextForkTitle({ id: "numbered", name: "报告 (2026)" }, []),
    "报告 (2026) (2)",
  );
});

test("从客户端编号分支继续创建，并允许缺失父对话", () => {
  const second = branch("second", `${root.name} (2)`);
  const ninth = branch("ninth", `${root.name} (9)`, second.id);
  assert.equal(
    nextForkTitle(second, [root, second, ninth]),
    `${root.name} (10)`,
  );
  assert.equal(nextForkTitle(ninth, [ninth]), `${root.name} (10)`);
});

test("仅在父子标题匹配时兼容旧网页分支后缀", () => {
  const old = branch("old", `${root.name} (分支)`);
  const nested = branch("nested", `${old.name} (分支)`, old.id);
  const mixed = branch("mixed", `${root.name} (4)`);
  const records = [root, old, nested, mixed];
  assert.equal(nextForkTitle(nested, records), `${root.name} (5)`);
  assert.equal(nextForkTitle(root, records), `${root.name} (5)`);
  const manual = branch("manual", "发布说明 (分支)");
  assert.equal(nextForkTitle(manual, [root, manual]), "发布说明 (分支) (2)");
});

test("长标题按客户端的 60 字符上限截断并稳定递增", () => {
  const long = { id: "long", name: "训练进展".repeat(30) };
  const second = branch("second", nextForkTitle(long, []), long.id);
  assert.equal(second.name.length, 60);
  assert(second.name.endsWith("… (2)"));
  const tenth = branch(
    "tenth",
    nextForkTitle(long, [
      long,
      branch("ninth", long.name.slice(0, 55) + "… (9)", long.id),
    ]),
    long.id,
  );
  assert.equal(tenth.name.length, 60);
  assert(tenth.name.endsWith("… (10)"));
  assert.equal(
    nextForkTitle(second, [long, second, tenth]),
    long.name.slice(0, 54) + "… (11)",
  );
});

test("预览、空标题及循环父关系保持可用", () => {
  assert.equal(
    nextForkTitle({ id: "preview", preview: "首条消息" }, []),
    "首条消息 (2)",
  );
  assert.equal(nextForkTitle({ id: "empty" }, []), "新对话 (2)");
  const cyclic = branch("cycle", "循环 (3)", "cycle");
  assert.equal(nextForkTitle(cyclic, [cyclic]), "循环 (3) (2)");
});
