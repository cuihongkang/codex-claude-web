import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testMarkdownHtml(app, requests, setResponse) {
  const original = app.get();
  let finishSlow;
  setResponse(({ method, params }) => {
    if (method !== "fs/readFile") return {};
    if (params.path.endsWith("slow.png"))
      return new Promise((resolve) => (finishSlow = resolve));
    if (params.path.endsWith("missing.png"))
      return { error: { message: "图片文件不存在" } };
    return { dataBase64: "AQ==" };
  });
  let view;
  const render = async (text, cwd = "/html-fixture/docs") => {
    await act(async () => {
      const element = React.createElement(app.RichText, { text, cwd });
      if (view) view.update(element);
      else view = create(element);
    });
  };
  try {
    app.set({
      connected: true,
      current: { id: "html-fixture", cwd: "/unrelated" },
      theme: "light",
    });
    await render(
      '<h1 align="center">HTML 标题</h1>\n\n' +
        '<p align="center"><strong>粗体</strong><br><kbd>Ctrl</kbd><sub>注释</sub></p>\n\n' +
        "<details><summary>更多说明</summary>\n\n**混排内容**\n\n- 项目\n\n</details>\n\n" +
        '<img src="./icon.png" width="88" height="88" onerror="alert(1)">\n\n' +
        '<a href="../guide.md">使用指南</a>',
    );
    assert.equal(view.root.findByType("h1").props.align, "center");
    assert.equal(view.root.findByType("h1").props.children, "HTML 标题");
    assert.equal(view.root.findByType("summary").props.children, "更多说明");
    assert.equal(view.root.findAllByType("strong").length, 2);
    assert(view.root.findByType("kbd"));
    assert(view.root.findByType("br"));
    assert(view.root.findByType("ul"));
    assert.equal(view.root.findByType("img").props.width, 88);
    assert.equal(view.root.findByType("img").props.style.width, 88);
    assert.equal(
      view.root.findByType("a").props.href,
      "/html-fixture/guide.md",
    );
    assert(
      requests.some(
        ({ method, params }) =>
          method === "fs/readFile" &&
          params.path === "/html-fixture/docs/icon.png",
      ),
    );

    await render(
      '<script>alert("blocked")</script><style>body{display:none}</style>' +
        '<iframe src="https://example.invalid"></iframe>' +
        '<object data="javascript:alert(1)"></object>' +
        '<p onclick="alert(1)" style="display:none">保留正文</p>' +
        '<a href="javascript:alert(1)">无效链接</a>' +
        '<img src="data:text/html;base64,PHNjcmlwdD4=" onerror="alert(1)">',
    );
    for (const tag of ["script", "style", "iframe", "object", "img"])
      assert.equal(view.root.findAllByType(tag).length, 0);
    const paragraph = view.root.findAllByType("p")[0];
    assert.equal(paragraph.props.onClick, undefined);
    assert.equal(paragraph.props.style, undefined);
    assert.equal(view.root.findByType("a").props.href, undefined);
    assert(JSON.stringify(view.toJSON()).includes("保留正文"));
    assert(!JSON.stringify(view.toJSON()).includes('alert("blocked")'));

    await render(
      "```html\n<details><summary>代码示例</summary></details>\n```\n\n`<b>行内源码</b>`",
    );
    assert.equal(view.root.findAllByType("details").length, 0);
    assert.equal(view.root.findAllByType("code").length, 2);
    assert(JSON.stringify(view.toJSON()).includes("代码示例"));

    await render(
      '## 安装\n\n## 安装\n\n<details><summary>更多</summary><h3 id="target">目标</h3></details>\n\n[定位](#target)',
    );
    assert.deepEqual(
      view.root.findAllByType("h2").map((node) => node.props.id),
      ["user-content-安装", "user-content-安装-1"],
    );
    assert.equal(view.root.findByType("h3").props.id, "user-content-target");
    let scrolled = false;
    let prevented = false;
    const root = { querySelectorAll: () => [target] };
    const details = { tagName: "DETAILS", open: false, parentElement: root };
    const target = {
      id: "user-content-target",
      parentElement: details,
      scrollIntoView: () => (scrolled = true),
    };
    await act(async () =>
      view.root.findByType("a").props.onClick({
        preventDefault: () => (prevented = true),
        currentTarget: { closest: () => root },
      }),
    );
    assert(prevented && scrolled && details.open);

    const picture = (name) =>
      `<picture><source media="(prefers-color-scheme: dark)" srcset="./${name}.png 1x, ./large.png 2x"><img src="./fallback.png" alt="主题图片"></picture>`;
    await render(picture("dark"));
    assert(view.root.findByType("picture"));
    assert.equal(view.root.findByType("source").props.media, "not all");
    assert.equal(
      view.root.findByType("source").props.srcSet,
      "data:image/png;base64,AQ== 1x, data:image/png;base64,AQ== 2x",
    );
    assert.equal(view.root.findByType("img").props.alt, "主题图片");
    await act(async () => app.set({ theme: "dark" }));
    assert.equal(view.root.findByType("source").props.media, "all");
    await act(async () => app.set({ theme: "system" }));
    assert.equal(
      view.root.findByType("source").props.media,
      "(prefers-color-scheme: dark)",
    );
    await render(picture("slow"));
    await render(picture("latest"));
    await act(async () => finishSlow({ dataBase64: "Ag==" }));
    assert(!view.root.findByType("source").props.srcSet.includes("Ag=="));
    await render(
      '<picture><source srcset="./missing.png"><img src="./fallback.png"></picture>',
    );
    assert.equal(view.root.findByType("source").props.srcSet, "");
    assert(view.root.findByType("img").props.src.startsWith("data:image/"));
    await render(
      '<picture><source srcset="javascript:alert(1) 1x, data:text/html;base64,AQ== 2x"><img src="./fallback.png"></picture>',
    );
    assert.equal(view.root.findByType("source").props.srcSet, "");

    const readme = await readFile(
      new URL("../../README.md", import.meta.url),
      "utf8",
    );
    await render(readme, "/html-fixture");
    assert.equal(view.root.findByType("h1").props.children, "Claudex Web");
    assert.equal(view.root.findAllByType("details").length, 2);
    assert(view.root.findByType("picture"));
    assert(!JSON.stringify(view.toJSON()).includes('<p align="center">'));
    assert(
      requests.some(
        ({ method, params }) =>
          method === "fs/readFile" &&
          params.path === "/html-fixture/docs/images/desktop-dark.png",
      ),
    );
    console.log(
      "PASS 共用 Markdown 的 HTML 排版、折叠块、混排、代码原文、安全过滤、相对图片、picture 主题与候选图、迟到读取及实际 README",
    );
  } finally {
    await act(async () => view?.unmount());
    app.set(original);
  }
}
