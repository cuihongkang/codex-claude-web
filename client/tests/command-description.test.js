import test from "node:test";
import assert from "node:assert/strict";
import { commandDescription } from "../src/domain/command-description.js";

test("读取文件和技能，保留路径与带空格的文件名", () => {
  for (const [command, expected] of [
    ["cat README.md", "读取 README.md"],
    ["cat 'docs/design notes.md'", "读取 docs/design notes.md"],
    ["cat docs/design\\ notes.md", "读取 docs/design notes.md"],
    ["cat -n -- -notes.md", "读取 -notes.md"],
    ["cat a.js b.js", "读取 a.js；读取 b.js"],
    ["cat SKILL.md", "阅读技能"],
    ["cat ./SKILL.md", "阅读技能"],
    ["cat /skills/explain-code/SKILL.md", "阅读技能 explain-code"],
    ["/usr/bin/cat README.md", "读取 README.md"],
  ])
    assert.equal(commandDescription(command), expected, command);
});

test("指定行、开头和末尾读取，技能保留行范围", () => {
  for (const [command, expected] of [
    ["sed -n '20,80p' src/app.js", "读取 src/app.js 的第 20–80 行"],
    ["sed --quiet -e '12p' app.js", "读取 app.js 的第 12 行"],
    ["sed -n '30,$p' app.js", "读取 app.js 的第 30 行至末尾"],
    ["sed -n '1,10p' a.js b.js", "读取 a.js、b.js 合并内容的第 1–10 行"],
    ["sed -n '1,40p' skills/demo/SKILL.md", "阅读技能 demo 的第 1–40 行"],
    ["head -n 5 /skills/demo/SKILL.md", "阅读技能 demo 的前 5 行"],
    [
      "sed -n '1,5p' /skills/demo/SKILL.md a.js",
      "读取 技能 demo、a.js 合并内容的第 1–5 行",
    ],
    ["head -n 20 app.js", "读取 app.js 的前 20 行"],
    ["head app.js", "读取 app.js 的前 10 行"],
    ["head -5 app.js", "读取 app.js 的前 5 行"],
    ["tail --lines=15 app.log", "读取 app.log 的最后 15 行"],
    ["tail -n+30 app.log", "读取 app.log 的第 30 行至末尾"],
    ["nl -ba app.js", "读取并显示行号 app.js"],
    ["wc -l app.js", "统计行数 app.js"],
  ])
    assert.equal(commandDescription(command), expected, command);
});

test("列目录、搜索文件和搜索内容保留查询范围与筛选", () => {
  for (const [command, expected] of [
    ["pwd", "查看当前工作目录"],
    ["ls -la src", "列出目录 src"],
    ["rg --files src -g '*.js'", "列出文件（范围：src）（筛选：*.js）"],
    [
      "rg -n -A10 'commandExecution|shell' client server --glob '!dist/**'",
      "搜索内容 “commandExecution|shell”（范围：client、server）（筛选：!dist/**）",
    ],
    ["grep -RIn 'hello world' src", "搜索内容 “hello world”（范围：src）"],
    ["rg -l -e foo -e bar src", "查找内容匹配的文件 “foo”、“bar”（范围：src）"],
    ["rg -- '-pattern' src", "搜索内容 “-pattern”（范围：src）"],
    [
      "find src -type f -name '*.js'",
      "查找文件（范围：src；文件；名称匹配 *.js）",
    ],
  ])
    assert.equal(commandDescription(command), expected, command);
});

test("组合命令保留顺序、成功与失败条件和管道，未知部分保留原文", () => {
  for (const [command, expected] of [
    [
      "cd /code && sed -n '1,20p' app.js; npm test",
      "切换到目录 /code，成功后读取 app.js 的第 1–20 行；运行测试",
    ],
    ["cat a || cat b", "读取 a，失败后读取 b"],
    ["rg --files | head -n 5", "列出文件 → 显示前 5 行"],
    [
      "nl -ba app.js | sed -n '10,20p'",
      "读取并显示行号 app.js → 显示第 10–20 行",
    ],
    ["cat a | custom-filter --flag", "读取 a → 执行命令 custom-filter --flag"],
    ["cat 'a;b|c&&d'", "读取 a;b|c&&d"],
    ['rg "a|b; c" src', "搜索内容 “a|b; c”（范围：src）"],
    ["cat a\n\ncat b\n", "读取 a；读取 b"],
    ["cat a &&\ncat b", "读取 a，成功后读取 b"],
    ["cat a; # note\ncat b;", "读取 a；读取 b"],
    ["cat a \\\n b", "读取 a；读取 b"],
    ["rg 'foo' src | wc -l", "搜索内容 “foo”（范围：src） → 统计行数"],
  ])
    assert.equal(commandDescription(command), expected, command);
});

test("常见 shell 包装可还原，原始未知命令保持可读", () => {
  assert.equal(
    commandDescription("/usr/bin/zsh -lc 'cat SKILL.md'"),
    "阅读技能",
  );
  assert.equal(
    commandDescription("/bin/bash -c \"sed -n '5,10p' app.js\""),
    "读取 app.js 的第 5–10 行",
  );
  assert.equal(commandDescription("npm run check"), "运行项目检查");
  assert.equal(commandDescription("/bin/bash -lc 'npm test'"), "运行测试");
  assert.equal(commandDescription("/bin/bash -lc ''"), "执行命令");
  assert.equal(commandDescription(undefined), "执行命令");
  assert.equal(commandDescription("   "), "执行命令");
});

test("写入、动态执行、复杂脚本与不支持的选项保留原命令", () => {
  for (const command of [
    "sed -i 's/old/new/' app.js",
    "sed -n -e '1,5p' -e '10,15p' app.js",
    "sed -n '20,10p' app.js",
    "sed '1,5p' app.js",
    "cat a > b",
    "cat a 2>/dev/null; npm test",
    "cat <<'EOF'\nhello\nEOF",
    "cat $(get-path)",
    'cat a; cat "$(get-path)"',
    'cat a; cat "`get-path`"',
    'cat "$FILE"',
    "cat `get-path`",
    "cat a &",
    "cat a &&",
    "cat 'unterminated",
    "(cat a; cat b)",
    "for file in *.js; do cat $file; done",
    "if true; then cat a; fi",
    "if true; cat a; fi",
    "find src -delete",
    "find src -exec cat {} \\;",
    "head -c 50 app.js",
    "tail -f app.log",
    "rg --pre processor query src",
    "rg -v query src",
    "grep -f patterns.txt src",
    "./cat file",
    "./sh -c 'cat file'",
    "/usr/bin/custom/cat file",
  ])
    assert.equal(commandDescription(command), command, command);
});
