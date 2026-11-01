import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import {
  fileLanguage,
  isMarkdownFile,
  codeHighlightStyle,
} from "../src/features/workspace/editor-language.js";

test("根据文件名识别 Markdown，覆盖大小写与常见扩展名", () => {
  for (const path of [
    "/docs/README.MD",
    "notes.markdown",
    "notes.mdown",
    "notes.mkd",
  ])
    assert(isMarkdownFile(path), path);
  for (const path of ["notes.md.js", "notes.txt", "src/main.mjs"])
    assert.equal(isMarkdownFile(path), false, path);
});

test("常见代码、配置与脚本生成实际语法颜色，未知类型保留纯文本", () => {
  const fixtures = [
    ["main.mjs", 'export const message = "hello";', "export"],
    ["main.CJS", 'const message = "hello";', "const"],
    ["model.mts", "export const count: number = 42;", "number"],
    ["View.tsx", "const View = () => <div>hello</div>;", "const"],
    ["main.py", 'def greet():\n    return "hello"', "def"],
    ["main.cxx", "int main() { return 42; }", "return"],
    ["config.json", '{"enabled": true}', "true"],
    ["page.html", '<div class="main">hello</div>', "div"],
    ["page.css", ".main { color: red; }", "color"],
    ["start.sh", 'if true; then echo "hello"; fi', "if"],
    [".zshrc", 'export GREETING="hello"', "export"],
    ["config.yaml", "enabled: true\ncount: 42", "true"],
    ["config.toml", 'name = "hello"', '"hello"'],
    ["main.rs", "fn main() { let count = 42; }", "fn"],
    ["main.go", 'package main\nfunc main() { println("hello") }', "package"],
    ["Main.java", "class Main { public static void main() {} }", "class"],
    ["Main.cs", "class Main { static void Run() {} }", "class"],
    ["query.sql", "SELECT name FROM users WHERE id = 42;", "SELECT"],
    ["CMakeLists.txt", 'project("hello")', "project"],
    ["Dockerfile", "FROM node:24\nRUN echo hello", "FROM"],
    ["main.lua", "local count = 42", "local"],
    ["config.ini", "[section]\nname=value", "name"],
    [".env.local", "GREETING=hello", "GREETING"],
  ];
  for (const [path, doc, token] of fixtures) {
    const state = EditorState.create({ doc, extensions: [fileLanguage(path)] });
    const tree = ensureSyntaxTree(state, doc.length, 1000);
    assert(tree, path);
    const colored = [];
    highlightTree(tree, codeHighlightStyle, (from, to, classes) => {
      if (classes.startsWith("hljs-")) colored.push(doc.slice(from, to));
    });
    assert(
      colored.some((text) => text.includes(token)),
      `${path}: ${colored.join(", ")}`,
    );
  }
  assert.deepEqual(fileLanguage("notes.unknown"), []);
});
