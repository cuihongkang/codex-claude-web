import test from "node:test";
import assert from "node:assert/strict";
import {
  inlineReference,
  referenceMarkdown,
  textReferences,
} from "../src/domain/inline-references.js";
import { referenceInputs } from "../src/application/reference-input.js";

test("引用保留中文、空格、括号与百分号路径，正文位置和类型可恢复", () => {
  for (const reference of [
    { kind: "file", name: "读 [我].py", path: "/工作区/a b%/读 [我].py" },
    { kind: "directory", name: "目录", path: "/工作区/目录/" },
    { kind: "skill", name: "demo", path: "/skills/demo/SKILL.md" },
    {
      kind: "skill",
      name: "插件:技能",
      path: "skill://" + encodeURIComponent("插件:技能"),
      native: true,
    },
    { kind: "thread", name: "旧会话", path: "thread://old", threadId: "old" },
  ]) {
    const text = "前文 " + referenceMarkdown(reference) + " 后文";
    const [result] = textReferences(text);
    assert.equal(result.path, reference.path);
    assert.equal(result.kind, reference.kind);
    assert.equal(result.name, reference.name);
    assert.equal(result.start, 3);
  }
});

test("普通代码、代码块和 HTML 内的引用示例保留原义", () => {
  const source = referenceMarkdown({
    kind: "skill",
    name: "demo",
    path: "/demo/SKILL.md",
  });
  assert.deepEqual(
    textReferences(
      "`" +
        source +
        "`\n\n```md\n" +
        source +
        "\n```\n\n<div>\n" +
        source +
        "\n</div>",
    ),
    [],
  );
  assert.equal(inlineReference("https://example.com", "demo"), null);
});

test("Codex 从现存节点生成原生输入，重复引用保留正文并合并元数据", async () => {
  const skill = referenceMarkdown({
    kind: "skill",
    name: "demo",
    path: "/demo/SKILL.md",
  });
  const thread = referenceMarkdown({
    kind: "thread",
    name: "旧会话",
    path: "thread://old",
  });
  const text = skill + " " + skill + " " + thread;
  const result = await referenceInputs(text, "codex", () =>
    assert.fail("Codex 复用原生引用，不预读历史"),
  );
  assert.equal(result.text, text);
  assert.match(result.inputs.at(-1).text, /read_thread/);
  assert.deepEqual(
    result.inputs.filter((part) => part.type !== "text"),
    [
      { type: "skill", name: "demo", path: "/demo/SKILL.md" },
      { type: "mention", name: "旧会话", path: "thread://old" },
    ],
  );
  assert.deepEqual(
    (await referenceInputs("已删除所有引用", "codex", null)).inputs,
    [],
  );
});

test("会话按后端校验，Claude 复用分页历史且保留读取错误", async () => {
  const text = referenceMarkdown({
    kind: "thread",
    name: "旧会话",
    path: "thread://backend:claude:old",
  });
  await assert.rejects(referenceInputs(text, "codex", null), /同一后端/);
  const calls = [];
  const result = await referenceInputs(
    text,
    "claude",
    async (method, params) => {
      calls.push([method, params.cursor]);
      return {
        data: [
          {
            turnId: "t",
            item: {
              type: "agentMessage",
              text: params.cursor ? "前文" : "后文",
            },
          },
        ],
        nextCursor: params.cursor ? null : "next",
      };
    },
  );
  assert.equal(calls.length, 2);
  assert.match(result.inputs[0].text, /助手：前文\n\n助手：后文/);
  await assert.rejects(
    referenceInputs(text, "claude", async () => {
      throw new Error("读取失败");
    }),
    /读取失败/,
  );
});

test("文件名以美元开头时保持文件类型，图片链接继续作为图片", () => {
  const reference = {
    kind: "file",
    name: "$config.py",
    path: "/demo/$config.py",
  };
  assert.equal(textReferences(referenceMarkdown(reference))[0].kind, "file");
  assert.deepEqual(textReferences("[![预览](/demo/a.png)](/demo/a.png)"), []);
});

test("Claude 原生技能按命令提交，类型在草稿中保留", async () => {
  const text = referenceMarkdown({
    kind: "skill",
    name: "native",
    path: "skill://native",
    native: true,
  });
  const result = await referenceInputs(text, "claude", null);
  assert.equal(result.text, "/native " + text);
  assert.deepEqual(result.inputs, []);
  await assert.rejects(referenceInputs(text, "codex", null), /Codex 技能列表/);
});

test("文件名中的井号、问号和冒号保留，普通行号链接继续定位文件", () => {
  const reference = {
    kind: "file",
    name: "a#b?c:12.py",
    path: "/demo/a#b?c:12.py",
  };
  assert.equal(
    textReferences(referenceMarkdown(reference))[0].path,
    reference.path,
  );
  assert.equal(
    textReferences("[文件](/demo/file.py:12)")[0].path,
    "/demo/file.py",
  );
  assert.equal(
    textReferences("[文件](/demo/file.py#L12)")[0].path,
    "/demo/file.py",
  );
});
