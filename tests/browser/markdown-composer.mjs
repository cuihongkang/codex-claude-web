import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { historyPerformanceFixture } from "../fixtures/history-performance.mjs";
import { checkComposerSize } from "../helpers/composer-size.mjs";
import { checkComposerEditing } from "../helpers/composer-editing.mjs";
import { checkComposerMath } from "../helpers/composer-math.mjs";
import {
  holdDocumentEditor,
  checkComposerInitialization,
} from "../helpers/composer-initialization.mjs";
const editorAssetTypes = {
  js: "text/javascript",
  css: "text/css",
  png: "image/png",
  ico: "image/x-icon",
};

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = join(root, ".cache/markdown-composer");
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let content = await readFile(
      join(root, "client/dist", path === "/" ? "index.html" : path),
    );
    if (path === "/")
      content = content
        .toString()
        .replace(
          "<head>",
          `<head><script>{const saved=Object.entries(localStorage).filter(([key])=>key==='cx-current'||key.startsWith('cx-draft-'));(${historyPerformanceFixture.toString()})();for(const [key,value] of saved)localStorage.setItem(key,value);}</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          path === "/"
            ? "text/html"
            : editorAssetTypes[extname(path).slice(1)] ||
              "application/octet-stream",
      })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server"],
});
const errors = [];
const external = [];
const checks = [];
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.stack));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.route("**/*", (route) => {
    if (
      /^https?:/.test(route.request().url()) &&
      !route
        .request()
        .url()
        .startsWith(`http://127.0.0.1:${server.address().port}`)
    ) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const releaseEditor = await holdDocumentEditor(page);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: /^简短对话/ }).click();
  await checkComposerInitialization(page, releaseEditor);
  checks.push("加载期间输入与跨对话草稿隔离、初始化选区和尺寸保持");
  const field = page.locator(".markdown-composer .ProseMirror");
  await field.waitFor();
  await checkComposerMath(page, output);
  checks.push(
    "双美元符号公式在同段渲染、源码修改、撤销重做、正文续写及刷新恢复",
  );
  const editing = await checkComposerEditing(page, output, true);
  const fixedSize = await checkComposerSize(page);
  await page
    .locator(".composer")
    .screenshot({ path: join(output, "fixed-size-input.png") });
  await page
    .locator(".document-editor-viewport")
    .click({ position: { x: 20, y: 15 } });
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  const source =
    "# 标题\n\n正文 **加粗**、*斜体*、~~删除~~、`inline` 与 [链接](https://example.com)。\n\n- [x] 完成\n- [ ] 待办\n\n> 引用\n\n| 名称 | 数值 |\n| --- | ---: |\n| alpha | 42 |\n\n$$\nx_i^2 + y_i^2 = 1\n$$\n\n```mermaid\ngraph LR\nA[输入] --> B[发送]\n```\n\n```js\nconst value = 42;\n```\n\n脚注[^note]\n\n[^note]: 说明\n\n<details><summary>展开</summary>安全 HTML</details>\n";
  await page
    .locator(".document-editor-viewport")
    .click({ position: { x: 20, y: 15 } });
  await page.evaluate((source) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", source);
    document.querySelector(".markdown-composer .ProseMirror").dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  }, source);
  await page.waitForFunction(() =>
    document.querySelector(".markdown-composer h1"),
  );
  for (const block of await field.locator(".milkdown-code-block").all()) {
    await block.scrollIntoViewIfNeeded();
    await block.locator(".cm-editor").waitFor();
  }
  for (const selector of [
    "strong",
    "em",
    "s,del",
    "code",
    "input[type=checkbox]:checked",
    "blockquote",
    "table",
    ".katex",
  ]) {
    console.log("checking", selector);
    await field.locator(selector).first().waitFor({ state: "attached" });
  }
  const draft = await page.evaluate(() =>
    localStorage.getItem("cx-draft-short"),
  );
  assert(draft.includes("**加粗**"));
  assert(draft.includes("```mermaid"));
  assert(draft.includes("$$x_i^2 + y_i^2 = 1$$"));
  assert.equal(await field.locator(".katex-display").count(), 0);
  assert(draft.includes("[^note]"));
  assert(draft.includes("<details>"));
  assert.equal(await field.locator("details").count(), 0);
  assert(
    (await field.locator('[data-type="html"]').first().textContent()).includes(
      "<details>",
    ),
  );
  const mermaidCode = field
    .locator(".milkdown-code-block")
    .filter({ hasText: "graph LR" });
  assert.equal(await mermaidCode.locator(".preview-panel").count(), 0);
  const task = field.locator("input[type=checkbox]").first();
  await task.uncheck();
  await page.waitForFunction(() =>
    localStorage.getItem("cx-draft-short").includes("- [ ] 完成"),
  );
  await page
    .locator(".document-editor-viewport")
    .evaluate((element) => (element.scrollTop = 0));
  await page
    .locator(".composer")
    .screenshot({ path: join(output, "editor-light.png") });
  await page.screenshot({ path: join(output, "rich-content-light.png") });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    document.querySelector(".document-editor-viewport").scrollTop = 0;
  });
  await page.screenshot({ path: join(output, "rich-content-dark.png") });
  await page
    .locator(".composer")
    .screenshot({ path: join(output, "editor-dark.png") });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  checks.push("CommonMark、GFM、数学、脚注排版及代码和 HTML 源码保留");
  await field.locator("td").first().click();
  await page.keyboard.type("编辑");
  await page.waitForFunction(() =>
    localStorage.getItem("cx-draft-short").includes("编辑"),
  );
  checks.push("直接编辑表格单元格");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.waitForFunction(() =>
    window.historyFixture.requests.some((r) => r.method === "turn/start"),
  );
  const sent = await page.evaluate(
    () =>
      window.historyFixture.requests.find((r) => r.method === "turn/start")
        .params.input,
  );
  assert(
    sent.some(
      (item) =>
        item.type === "text" &&
        item.text.includes("**加粗**") &&
        item.text.includes("编辑") &&
        item.text.includes("$$x_i^2 + y_i^2 = 1$$"),
    ),
  );
  checks.push("发送 Markdown 正文");
  await page
    .locator(".document-editor-viewport")
    .click({ position: { x: 20, y: 15 } });
  await page.keyboard.type("中文草稿");
  await page.waitForFunction(() =>
    localStorage.getItem("cx-draft-short")?.includes("中文草稿"),
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type("第二行");
  await page.waitForFunction(() =>
    localStorage.getItem("cx-draft-short")?.includes("第二行"),
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.historyFixture.requests.filter((r) => r.method === "turn/start")
          .length,
    ),
    1,
  );
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(
    () =>
      window.historyFixture.requests.filter((r) => r.method === "turn/start")
        .length === 2,
  );
  checks.push("Enter 换行与 Ctrl+Enter 发送");
  await page
    .locator(".document-editor-viewport")
    .click({ position: { x: 20, y: 15 } });
  await page.keyboard.type("/sta");
  await page.getByRole("listbox", { name: "快捷命令" }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("保留草稿");
  await page.getByRole("button", { name: /^超长对话性能验证/ }).click();
  await field.waitFor();
  await page.getByRole("button", { name: /^简短对话/ }).click();
  await field.waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector(".markdown-composer .ProseMirror")
      .textContent.includes("保留草稿"),
  );
  await page.reload();
  await field.waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector(".markdown-composer .ProseMirror")
      .textContent.includes("保留草稿"),
  );
  await page
    .locator(".document-editor-viewport")
    .click({ position: { x: 20, y: 15 } });
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("撤销测试");
  await page.waitForFunction(() =>
    localStorage.getItem("cx-draft-short").includes("撤销测试"),
  );
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    () => !localStorage.getItem("cx-draft-short").includes("撤销测试"),
  );
  await page.keyboard.press("Control+y");
  await page.waitForFunction(() =>
    localStorage.getItem("cx-draft-short").includes("撤销测试"),
  );
  checks.push("快捷命令、对话切换、刷新恢复与撤销重做");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("# 即时标题");
  await field.locator("h1").filter({ hasText: "即时标题" }).waitFor();
  await page.keyboard.press("Enter");
  await page.keyboard.type("- 列表条目");
  await field.locator("li").filter({ hasText: "列表条目" }).waitFor();
  checks.push("输入标题和列表语法后直接编辑排版结果");
  await page.keyboard.press("Control+A");
  const device = await page.context().newCDPSession(page);
  await device.send("Input.imeSetComposition", {
    text: "中文组合输入",
    selectionStart: 6,
    selectionEnd: 6,
  });
  const beforeCompositionSend = await page.evaluate(
    () =>
      window.historyFixture.requests.filter((r) => r.method === "turn/start")
        .length,
  );
  await field.dispatchEvent("keydown", {
    key: "Enter",
    ctrlKey: true,
    isComposing: true,
  });
  assert.equal(
    await page.evaluate(
      () =>
        window.historyFixture.requests.filter((r) => r.method === "turn/start")
          .length,
    ),
    beforeCompositionSend,
  );
  await device.send("Input.insertText", { text: "中文组合输入" });
  await page.waitForFunction(() =>
    localStorage.getItem("cx-draft-short").includes("中文组合输入"),
  );
  await page.evaluate(() => {
    const data = window.historyFixture;
    const socket = data.socket;
    const send = socket.send.bind(socket);
    data.fail = true;
    socket.send = (raw) => {
      const request = JSON.parse(raw);
      if (request.method !== "turn/start") return send(raw);
      data.requests.push(request);
      const response = data.fail
        ? { error: { message: "模拟发送失败" } }
        : { result: { turn: { id: "sent", status: "completed" } } };
      setTimeout(
        () =>
          socket.onmessage({
            data: JSON.stringify({ id: request.id, ...response }),
          }),
        data.delay || 0,
      );
    };
  });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page
    .locator(".error-banner")
    .filter({ hasText: "模拟发送失败" })
    .waitFor();
  assert((await field.textContent()).includes("中文组合输入"));
  await page.evaluate(() => {
    window.historyFixture.fail = false;
    window.historyFixture.delay = 150;
  });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page
    .locator(".document-editor-viewport")
    .click({ position: { x: 20, y: 15 } });
  await page.keyboard.insertText("后续草稿");
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="发送消息"]').disabled,
  );
  assert(
    (
      await page.evaluate(() => localStorage.getItem("cx-draft-short"))
    ).includes("后续草稿"),
  );
  checks.push("真实组合输入、选词期间暂停提交、失败重试及发送期间继续编辑");
  await page.evaluate(() => {
    const data = window.historyFixture;
    const socket = data.socket;
    const send = socket.send.bind(socket);
    socket.send = (raw) => {
      const request = JSON.parse(raw);
      if (request.method !== "fuzzyFileSearch") return send(raw);
      data.requests.push(request);
      socket.onmessage({
        data: JSON.stringify({
          id: request.id,
          result: {
            files: [
              {
                path: "README.md",
                root: "/demo/history",
                file_name: "README.md",
                match_type: "file",
              },
            ],
          },
        }),
      });
    };
  });
  await page
    .locator(".document-editor-viewport")
    .click({ position: { x: 20, y: 15 } });
  await page.keyboard.press("Control+A");
  await page.keyboard.type("@READ");
  await page.getByRole("option", { name: /^README.md/ }).click();
  await page.locator(".attachment").filter({ hasText: "README.md" }).waitFor();
  await page.waitForFunction(() =>
    localStorage.getItem("cx-draft-short").includes("@README.md"),
  );
  assert((await field.textContent()).includes("@README.md"));
  checks.push("文件引用、附件与 Markdown 光标恢复");
  const historyRenders = await page.evaluate(
    () => window.historyFixture.richTextRenders,
  );
  await page
    .locator(".document-editor-viewport")
    .click({ position: { x: 20, y: 15 } });
  await page.keyboard.press("Control+A");
  const longDraft = "长段输入保持即时草稿与独立订阅。".repeat(400);
  await page.keyboard.insertText(longDraft);
  await page.waitForFunction(
    (text) => localStorage.getItem("cx-draft-short")?.includes(text),
    longDraft,
  );
  assert.equal(
    await page.evaluate(() => window.historyFixture.richTextRenders),
    historyRenders,
  );
  checks.push("大段输入即时保存且保持历史渲染稳定");
  for (const size of [13, 18, 22]) {
    await page.evaluate(
      (size) =>
        document.documentElement.style.setProperty(
          "--chat-font-size",
          `${size}px`,
        ),
      size,
    );
    await checkComposerSize(page);
    await checkComposerEditing(page, output);
  }
  await page.evaluate(() =>
    document.documentElement.style.removeProperty("--chat-font-size"),
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
      await page.evaluate((zoom) => (document.body.style.zoom = zoom), zoom);
      await checkComposerSize(page);
      await checkComposerEditing(page, output);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({ path: join(output, `${theme}-${zoom}.png`) });
    }
  }
  await page.evaluate(() => (document.body.style.zoom = 1));
  await page.setViewportSize({ width: 390, height: 844 });
  await checkComposerSize(page);
  await checkComposerEditing(page, output);
  await page.screenshot({ path: join(output, "mobile.png") });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  checks.push("深浅主题、80%～200% 缩放与窄屏");
  checks.push("连续换行保持输入区尺寸及位置，超出内容可用滚轮上下滚动");
  checks.push(
    "普通文本与列表的完整两行、原生光标、点击与方向键定位、滚动后续写、字体变化和撤销重做",
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        checks,
        fixedSize,
        editing,
        errors,
        external,
        build: JSON.parse(
          await readFile(join(root, "build-info.json"), "utf8"),
        ),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks, output }));
} catch (error) {
  console.log(JSON.stringify({ checks, errors }));
  await writeFile(join(output, "failure.html"), await page.content());
  await page.screenshot({ path: join(output, "failure.png") });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
