import test from "node:test";
import assert from "node:assert/strict";
import { matchingSkills } from "../src/domain/skill-suggestions.js";
const skill = (name, extra = {}) => ({ name, description: "", ...extra });

test("技能支持缩写、跳字、大小写及中文匹配", () => {
  const entries = [
    skill("python-code-style"),
    skill("lark-calendar"),
    skill("项目指令维护"),
  ];
  assert.equal(matchingSkills(entries, "pycs")[0].name, "python-code-style");
  assert.equal(matchingSkills(entries, "LKC")[0].name, "lark-calendar");
  assert.equal(matchingSkills(entries, "项目维护")[0].name, "项目指令维护");
  assert.deepEqual(matchingSkills(entries, "zyx"), []);
});

test("精确、前缀、连续与紧凑跳字依次优先", () => {
  const entries = [
    skill("p---y---c---s"),
    skill("py-code-style"),
    skill("x-pycs-extra"),
    skill("pycs-extra"),
    skill("pycs"),
  ];
  assert.deepEqual(
    matchingSkills(entries, "pycs").map((entry) => entry.name),
    ["pycs", "pycs-extra", "x-pycs-extra", "py-code-style", "p---y---c---s"],
  );
});

test("别名、技能目录及路径参与匹配，描述仅作为低优先级关键词", () => {
  const entries = [
    skill("first", { interface: { displayName: "Python Code Style" } }),
    skill("second", { path: "/repo/skills/python-code-style/SKILL.md" }),
    skill("third", { description: "Python usage" }),
    skill("disabled", { enabled: false }),
  ];
  assert.deepEqual(
    matchingSkills(entries, "pycs").map((entry) => entry.name),
    ["first", "second"],
  );
  assert.deepEqual(
    matchingSkills(entries, "repo/skills/py").map((entry) => entry.name),
    ["second"],
  );
  assert.equal(matchingSkills(entries, "usage")[0].name, "third");
  assert.deepEqual(
    matchingSkills(entries, "").map((entry) => entry.name),
    ["first", "second", "third"],
  );
});
