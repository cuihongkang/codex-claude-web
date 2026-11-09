import test from "node:test";
import assert from "node:assert/strict";
import { remarkFileReferences } from "../src/domain/user-message-references.js";

test("文件引用在 Markdown 正文和列表转换，代码、公式及链接保留自身语义", () => {
  const text = (value) => ({ type: "text", value });
  const protectedNodes = [
    "code",
    "inlineCode",
    "math",
    "inlineMath",
    "html",
    "link",
    "linkReference",
    "image",
  ].map((type) => ({ type, children: [text("@notes.md")] }));
  const root = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [text("检查 @notes.md 和 @notes.md.bak。")],
      },
      {
        type: "list",
        children: [
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [text("@notes.md")] }],
          },
        ],
      },
      ...protectedNodes,
    ],
  };
  remarkFileReferences({
    references: [{ name: "notes.md" }, { name: "notes.md.bak" }],
  })(root);
  assert.deepEqual(
    root.children[0].children.map((node) => node.type),
    ["text", "fileReference", "text", "fileReference", "text"],
  );
  assert.equal(root.children[0].children[3].data.hProperties.index, "1");
  assert.equal(
    root.children[1].children[0].children[0].children[0].type,
    "fileReference",
  );
  for (const node of protectedNodes)
    assert.deepEqual(node.children, [text("@notes.md")]);
});

test("仅在代码中提及的附件仍提供独立引用入口，无正文附件也可打开", () => {
  for (const children of [[], [{ type: "code", value: "@notes.md" }]]) {
    const root = { type: "root", children };
    remarkFileReferences({ references: [{ name: "notes.md" }] })(root);
    assert.equal(root.children.at(-1).data.hName, "file-reference-list");
    assert.equal(root.children.at(-1).children[0].data.hProperties.index, "0");
  }
});
