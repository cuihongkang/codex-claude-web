import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testFilePanel(app, requests, setResponse) {
  const original = app.get();
  const previousWindow = globalThis.window;
  const listeners = new Map();
  let discard = false;
  let finishRead;
  let finishDirectory;
  globalThis.window = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
    confirm: () => discard,
  };
  const documentPath = "/file-fixture/docs/README.MD";
  const markdown = [
    "# 文件预览",
    "",
    "**重点**与 *强调*。",
    "",
    "- 列表项目",
    "- [x] 已完成",
    "",
    "| 名称 | 状态 |",
    "| --- | --- |",
    "| 预览 | 完成 |",
    "",
    "```js",
    'const message = "hello";',
    "```",
    "",
    "$x^2$",
    "",
    "[源代码](../src/main.mjs:12:3)",
    "",
    "![相对图片](./images/chart.png)",
    "",
    '<script>alert("blocked")</script>',
  ].join("\n");
  const files = new Map([
    [documentPath, markdown],
    ["/file-fixture/src/main.mjs", 'export const message = "hello";'],
    ["/file-fixture/notes.markdown", "# 另一份文档"],
  ]);
  setResponse(({ method, params }) => {
    if (method === "fs/readDirectory") {
      if (params.path === "/file-fixture/slow-directory")
        return new Promise((resolve) => {
          finishDirectory = resolve;
        });
      if (params.path === "/file-fixture/missing-directory")
        return { error: { message: "目录不存在" } };
      return {
        entries:
          params.path === "/file-fixture/src"
            ? [{ fileName: "main.mjs", isDirectory: false }]
            : [],
      };
    }
    if (method === "fs/readFile" && params.path.endsWith("/slow.mjs"))
      return new Promise((resolve) => {
        finishRead = resolve;
      });
    if (method === "fs/readFile")
      return {
        dataBase64: app.b64encode(files.get(params.path) || "图片数据"),
      };
    if (method === "fs/writeFile") {
      files.set(params.path, app.b64decode(params.dataBase64));
      return {};
    }
    return {};
  });
  let view;
  const button = (label) => view.root.findByProps({ "aria-label": label });
  const open = (path) => act(async () => app.set({ panelFile: path }));
  try {
    app.set({
      connected: true,
      current: { id: "other-chat", cwd: "/unrelated-chat-directory" },
      cwd: "/file-fixture",
      panel: "files",
      panelFile: documentPath,
    });
    await act(async () => {
      view = create(React.createElement(app.FilePanel));
    });
    assert.equal(view.root.findByType("h1").props.children, "文件预览");
    assert(view.root.findByType("strong"));
    assert(view.root.findByType("em"));
    assert(view.root.findByType("ul"));
    assert(view.root.findByType("table"));
    assert(view.root.findByProps({ type: "checkbox" }).props.checked);
    assert(view.root.findByProps({ className: "hljs-keyword" }));
    assert(view.root.findAllByType("math").length > 0);
    assert.equal(view.root.findAllByType("script").length, 0);
    assert.equal(button("保存文件").props.disabled, true);
    assert(
      requests.some(
        ({ method, params }) =>
          method === "fs/readFile" &&
          params.path === "/file-fixture/docs/images/chart.png",
      ),
    );
    assert.equal(
      view.root.findByType("a").props.href,
      "/file-fixture/src/main.mjs:12:3",
    );
    let prevented = false;
    await act(async () =>
      view.root.findByType("a").props.onClick({
        preventDefault() {
          prevented = true;
        },
      }),
    );
    assert(prevented);
    assert.equal(
      button("文件源码").props.value,
      files.get("/file-fixture/src/main.mjs"),
    );
    await open(documentPath);

    await act(async () => button("编辑 Markdown 源码").props.onClick());
    assert.equal(button("文件源码").props.value, markdown);
    const edited = "# 修改后的文档\n\n尚未保存的正文。";
    await act(async () =>
      button("文件源码").props.onChange({ target: { value: edited } }),
    );
    assert(listeners.has("beforeunload"));
    await act(async () => button("预览 Markdown").props.onClick());
    assert.equal(view.root.findByType("h1").props.children, "修改后的文档");
    await act(async () => button("编辑 Markdown 源码").props.onClick());
    assert.equal(button("文件源码").props.value, edited);
    await act(async () => button("预览 Markdown").props.onClick());

    await open("/file-fixture/notes.markdown");
    assert.equal(view.root.findByType("h1").props.children, "修改后的文档");
    await act(async () => button("保存文件").props.onClick());
    assert.equal(files.get(documentPath), edited);
    assert.equal(button("保存文件").props.disabled, true);
    assert.equal(listeners.has("beforeunload"), false);

    await open("/file-fixture/notes.markdown");
    assert.equal(view.root.findByType("h1").props.children, "另一份文档");
    await act(async () => button("编辑 Markdown 源码").props.onClick());
    await act(async () =>
      button("文件源码").props.onChange({ target: { value: "# 放弃的修改" } }),
    );
    discard = true;
    await open(documentPath);
    assert.equal(view.root.findByType("h1").props.children, "修改后的文档");

    await open("/file-fixture/src/main.mjs");
    assert.equal(view.root.findAllByType("h1").length, 0);
    assert.equal(
      button("文件源码").props.value,
      files.get("/file-fixture/src/main.mjs"),
    );
    assert.equal(
      view.root.findAllByProps({ "aria-label": "预览 Markdown" }).length,
      0,
    );
    const source = "export const message = '未保存';";
    await act(async () =>
      button("文件源码").props.onChange({ target: { value: source } }),
    );
    const deletedPath = "/file-fixture/deleted.txt";
    const change = {
      path: deletedPath,
      oldPath: deletedPath,
      diff: "--- a/deleted.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted content\n",
    };
    const reads = requests.filter(
      (request) => request.method === "fs/readFile",
    ).length;
    discard = false;
    await open(change);
    assert.equal(
      requests.filter((request) => request.method === "fs/readFile").length,
      reads,
    );
    assert.equal(
      view.root
        .findByProps({ "aria-label": "文件变更" })
        .findAllByProps({ className: "diff-block" }).length,
      1,
    );
    assert.equal(view.root.findAllByType("textarea").length, 0);
    assert(JSON.stringify(view.toJSON()).includes("-deleted content"));
    assert(
      !view.root
        .findAllByType("code")
        .some((node) => node.props.children.startsWith("@@ -")),
    );
    await open({
      path: "/file-fixture/sample.mjs",
      diff: "--- a/sample.mjs\n+++ b/sample.mjs\n@@ -100,2 +100,2 @@ function draw()\n-old\n+new\n shared\n@@ -200 +200 @@\n-older\n+@@ literal in code\n",
    });
    const displayed = view.root
      .findAllByType("code")
      .map((node) => node.props.children);
    assert(!displayed.some((line) => line.startsWith("@@ -")));
    assert(displayed.includes("+new"));
    assert(displayed.includes("-old"));
    assert(displayed.includes("+@@ literal in code"));
    const diffView = view.root.findByProps({ "aria-label": "文件变更" });
    const numbers = (className) =>
      diffView.findAllByProps({ className }).map((node) => node.props.children);
    assert.deepEqual(numbers("diff-number diff-old-number"), [
      "",
      "",
      100,
      "",
      101,
      200,
      "",
    ]);
    assert.deepEqual(numbers("diff-number diff-new-number"), [
      "",
      "",
      "",
      100,
      101,
      "",
      200,
    ]);
    await open(change);
    await act(async () => button("查看完整文件变更").props.onClick());
    assert.equal(
      view.root.findAllByProps({ "aria-label": "文件变更" }).length,
      1,
    );
    assert.equal(
      requests.filter((request) => request.method === "fs/readFile").length,
      reads,
    );
    await act(async () =>
      view.root
        .findAllByType("button")
        .find((node) => node.props.children?.includes?.("返回文件"))
        .props.onClick(),
    );
    assert.equal(button("文件源码").props.value, source);
    await open({ ...change, path: "/file-fixture/src/main.mjs" });
    await act(async () => button("查看完整文件变更").props.onClick());
    assert.equal(button("文件源码").props.value, source);
    discard = true;
    await open("/file-fixture/slow.mjs");
    await open(change);
    await act(async () =>
      finishRead({ dataBase64: app.b64encode("late source") }),
    );
    assert(JSON.stringify(view.toJSON()).includes("-deleted content"));
    await open({ ...change, path: "/file-fixture/slow.mjs" });
    await act(async () => {
      button("查看完整文件变更").props.onClick();
    });
    await act(async () =>
      view.root
        .findAllByType("button")
        .find((node) => node.props.children?.includes?.("返回文件"))
        .props.onClick(),
    );
    await act(async () =>
      finishRead({ dataBase64: app.b64encode("cancelled source") }),
    );
    assert.equal(button("文件源码").props.value, source);
    await open({ ...change, path: "/file-fixture/notes.markdown" });
    await act(async () => button("查看完整文件变更").props.onClick());
    assert.equal(
      view.root.findAllByProps({ "aria-label": "文件变更" }).length,
      0,
    );
    assert.equal(button("文件源码").props.value, "# 另一份文档");
    assert(JSON.stringify(view.toJSON()).includes("当前内容与本轮记录不同"));
    files.set("/file-fixture/notes.markdown", "# 磁盘中的最新内容");
    await open({ ...change, path: "/file-fixture/notes.markdown" });
    await act(async () => button("查看完整文件变更").props.onClick());
    assert.equal(button("文件源码").props.value, "# 磁盘中的最新内容");
    await open("/file-fixture/notes.markdown");
    assert.equal(view.root.findByType("h1").props.children, "磁盘中的最新内容");
    const fullPath = "/file-fixture/full.mjs";
    const fullText = "unchanged before\nnew content\nunchanged after\n";
    const patch =
      "--- a/full.mjs\n+++ b/full.mjs\n@@ -2 +2 @@\n-old content\n+new content\n";
    const patches = [
      patch.replace("+new content", "+intermediate"),
      patch.replace("-old content", "-intermediate"),
    ];
    const fullDiff = patches.join("\n");
    files.set(fullPath, fullText);
    const request = { path: fullPath, diff: fullDiff, patches };
    await open(request);
    assert.equal(view.root.findAllByType("textarea").length, 0);
    assert(!JSON.stringify(view.toJSON()).includes("unchanged before"));
    await open({ ...request, view: "full" });
    assert.equal(
      view.root.findAllByProps({ "aria-label": "文件变更" }).length,
      0,
    );
    assert.equal(button("文件源码").props.value, fullText);
    assert.equal(button("文件源码").props["data-change-diff"], fullDiff);
    assert.deepEqual(button("文件源码").props["data-change-patches"], patches);
    assert(!JSON.stringify(view.toJSON()).includes("当前内容与本轮记录不同"));
    const draft = fullText + "unsaved\n";
    await act(async () =>
      button("文件源码").props.onChange({ target: { value: draft } }),
    );
    await act(async () => button("打开源文件").props.onClick());
    assert.equal(button("文件源码").props.value, draft);
    assert.equal(button("文件源码").props["data-change-diff"], "");
    assert.equal(button("文件源码").props["data-change-patches"], undefined);
    await open({ ...request, view: "full" });
    assert.equal(button("文件源码").props.value, draft);
    assert.equal(button("文件源码").props["data-change-diff"], fullDiff);
    await act(async () => button("查看本轮差异片段").props.onClick());
    await act(async () => button("打开源文件").props.onClick());
    assert.equal(button("文件源码").props.value, draft);
    assert.equal(button("文件源码").props["data-change-diff"], "");
    await open(request);
    await act(async () => button("查看完整文件变更").props.onClick());
    assert.equal(button("文件源码").props.value, draft);
    await act(async () => button("保存文件").props.onClick());
    assert.equal(files.get(fullPath), draft);
    assert(!files.get(fullPath).includes("old content"));
    const markdownChange = {
      path: documentPath,
      diff: "--- a/docs/README.MD\n+++ b/docs/README.MD\n@@ -1 +1 @@\n-old heading\n+# 修改后的文档\n",
      view: "full",
    };
    await open(markdownChange);
    assert.equal(view.root.findAllByType("h1").length, 0);
    assert.equal(button("文件源码").props.value, edited);
    assert.equal(
      button("文件源码").props["data-change-diff"],
      markdownChange.diff,
    );
    discard = false;
    await act(async () =>
      button("文件源码").props.onChange({ target: { value: "# 未保存文档" } }),
    );
    await open("/file-fixture/训练 #1.MP4");
    assert.equal(view.root.findAllByType("video").length, 0);
    assert.equal(button("文件源码").props.value, "# 未保存文档");
    discard = true;
    const videoReads = requests.filter(
      (r) => r.method === "fs/readFile",
    ).length;
    await open("/file-fixture/训练 #1.MP4");
    assert.equal(
      requests.filter((r) => r.method === "fs/readFile").length,
      videoReads,
    );
    let video = view.root.findByType("video");
    assert.equal(
      new URL(video.props.src, "http://fixture").searchParams.get("path"),
      "/file-fixture/训练 #1.MP4",
    );
    assert.equal(video.props.controls, true);
    assert.equal(video.props.playsInline, true);
    assert.equal(
      view.root.findAllByProps({ "aria-label": "保存文件" }).length,
      0,
    );
    const writes = requests.filter((r) => r.method === "fs/writeFile").length;
    listeners.get("keydown")({ ctrlKey: true, key: "s", preventDefault() {} });
    assert.equal(
      requests.filter((r) => r.method === "fs/writeFile").length,
      writes,
    );
    await act(async () => video.props.onError());
    assert(JSON.stringify(view.toJSON()).includes("加载失败"));
    await act(async () =>
      view.root
        .findByProps({ className: "file-preview-error" })
        .findByType("button")
        .props.onClick(),
    );
    assert(!JSON.stringify(view.toJSON()).includes("加载失败"));
    await act(async () => app.set({ panel: null }));
    assert.equal(view.root.findAllByType("video").length, 0);
    await act(async () => app.set({ panel: "files" }));
    assert.equal(view.root.findAllByType("video").length, 1);
    await open("/file-fixture/other.webm");
    video = view.root.findByType("video");
    assert.equal(
      new URL(video.props.src, "http://fixture").searchParams.get("path"),
      "/file-fixture/other.webm",
    );
    const slowRead = open("/file-fixture/slow.mjs");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await open("/file-fixture/last.mp4");
    await act(async () =>
      finishRead({ dataBase64: app.b64encode("late text") }),
    );
    await slowRead;
    assert.equal(view.root.findAllByType("textarea").length, 0);
    assert(view.root.findByType("video").props.src.includes("last.mp4"));
    for (const [path, tag] of [
      ["/file-fixture/audio.FLAC", "audio"],
      ["/file-fixture/photo.AVIF", "img"],
      ["/file-fixture/report.PDF", "object"],
    ]) {
      const reads = requests.filter((r) => r.method === "fs/readFile").length;
      await open(path);
      assert(view.root.findByType(tag));
      assert.equal(
        requests.filter((r) => r.method === "fs/readFile").length,
        reads,
      );
      assert.equal(view.root.findAllByType("textarea").length, 0);
      assert.equal(
        view.root.findAllByProps({ "aria-label": "保存文件" }).length,
        0,
      );
    }
    for (const path of [
      "/file-fixture/archive.zip",
      "/file-fixture/data.xlsx",
      "/file-fixture/slides.pptx",
      "/file-fixture/document.docx",
    ]) {
      await open(path);
      const download = view.root.findByProps({ className: "file-download" });
      assert.equal(
        new URL(download.props.href, "http://fixture").searchParams.get("path"),
        path,
      );
      assert.equal(
        new URL(download.props.href, "http://fixture").searchParams.get(
          "download",
        ),
        "1",
      );
      assert.equal(view.root.findAllByType("textarea").length, 0);
    }
    files.set("/file-fixture/unknown.data", "\0binary");
    await open("/file-fixture/unknown.data");
    assert(view.root.findByProps({ className: "file-download" }));
    assert.equal(view.root.findAllByType("textarea").length, 0);
    await open(documentPath);
    assert.equal(view.root.findByType("h1").props.children, "修改后的文档");
    await open("/file-fixture/src/main.mjs");
    await act(async () =>
      button("文件源码").props.onChange({
        target: { value: "保留目录跳转前的编辑" },
      }),
    );
    discard = false;
    const directory = { path: "/file-fixture/src", view: "directory" };
    const directoryReads = requests.filter(
      ({ method, params }) =>
        method === "fs/readDirectory" && params.path === directory.path,
    ).length;
    await open(directory);
    assert.equal(button("文件源码").props.value, "保留目录跳转前的编辑");
    assert.equal(
      requests.filter(
        ({ method, params }) =>
          method === "fs/readDirectory" && params.path === directory.path,
      ).length,
      directoryReads,
    );
    discard = true;
    await open(directory);
    assert.equal(
      view.root.findAllByProps({ "aria-label": "文件源码" }).length,
      0,
    );
    assert(
      view.root
        .findByProps({ className: "file-location" })
        .findByProps({ title: directory.path }),
    );
    assert.equal(listeners.has("beforeunload"), false);
    await act(async () =>
      view.root.findByProps({ className: "tree-row" }).props.onClick(),
    );
    assert.equal(
      button("文件源码").props.value,
      files.get("/file-fixture/src/main.mjs"),
    );
    await open({ path: "/file-fixture/missing-directory", view: "directory" });
    assert.equal(
      button("文件源码").props.value,
      files.get("/file-fixture/src/main.mjs"),
    );
    await open({ path: "/file-fixture/slow-directory", view: "directory" });
    await open(directory);
    await act(async () =>
      finishDirectory({
        entries: [{ fileName: "late.mjs", isDirectory: false }],
      }),
    );
    assert(
      view.root
        .findByProps({ className: "file-location" })
        .findByProps({ title: directory.path }),
    );
    assert(!JSON.stringify(view.toJSON()).includes("late.mjs"));
    await open("/file-fixture/slow.mjs");
    await open(directory);
    await act(async () =>
      finishRead({ dataBase64: app.b64encode("迟到的文件内容") }),
    );
    assert.equal(
      view.root.findAllByProps({ "aria-label": "文件源码" }).length,
      0,
    );
    await open({ path: "/file-fixture/slow-directory", view: "directory" });
    await open("/file-fixture/src/main.mjs");
    await act(async () => finishDirectory({ entries: [] }));
    assert.equal(
      button("文件源码").props.value,
      files.get("/file-fixture/src/main.mjs"),
    );
    console.log(
      "PASS 目录跳转、子文件打开、未保存编辑确认、失败保留，以及文件与目录迟到读取隔离",
    );
    console.log(
      "PASS 文件侧栏区分差异片段、全文变更与普通源文件，保留草稿、正文保存及迟到读取隔离，以及 Markdown 预览与源码编辑",
    );
  } finally {
    await act(async () => view?.unmount());
    app.set(original);
    globalThis.window = previousWindow;
  }
}
