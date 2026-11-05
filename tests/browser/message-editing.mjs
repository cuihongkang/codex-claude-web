import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { messageEditingFixture } from "../fixtures/message-editing.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const sizeBefore = process.env.EDIT_SIZE_BEFORE === "1";
const styleBefore = process.env.EDIT_STYLE_BEFORE === "1";
const layouts = [];
const styles = [];
const output = join(
  root,
  before
    ? ".cache/message-editing-before-browser"
    : styleBefore
      ? ".cache/message-edit-style-before/browser"
      : sizeBefore
        ? ".cache/message-edit-size-before/browser"
        : ".cache/message-editing-browser",
);
const buildDirectory =
  process.env.BROWSER_BUILD_DIR || join(root, "client/dist");
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};
const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let body = await readFile(
      join(buildDirectory, path === "/" ? "index.html" : path),
    );
    if (path === "/")
      body = body
        .toString()
        .replace(
          "<head>",
          `<head><script>(${messageEditingFixture.toString()})()</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          (path === "/" ? "text/html" : mime[extname(path)]) ||
          "application/octet-stream",
      })
      .end(body);
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
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  if (before) {
    const composer = page.locator('.composer [role="textbox"]');
    await composer.waitFor();
    await composer.fill("底部草稿保持独立");
    const restore = page
      .getByRole("button", { name: "编辑并重新发送", exact: true })
      .last();
    await restore.hover();
    await page.screenshot({ path: join(output, "before-button.png") });
    assert.equal(await restore.locator("svg.lucide-rotate-ccw").count(), 1);
    await restore.click();
    assert.equal(await page.locator(".user-message-editor").count(), 0);
    assert((await composer.innerText()).includes("原消息"));
    assert(!(await composer.innerText()).includes("底部草稿保持独立"));
    await page.screenshot({
      path: join(output, "before-restored-composer.png"),
    });
  } else {
    const edit = page.getByRole("button", {
      name: "编辑上一条消息",
      exact: true,
    });
    await edit.waitFor();
    assert.equal(await edit.count(), 1);
    assert.equal(await edit.locator("svg.lucide-pencil").count(), 1);
    const composer = page.locator('.composer [role="textbox"]');
    await composer.waitFor();
    await composer.fill("底部草稿保持独立");
    await edit.hover();
    await page.screenshot({ path: join(output, "after-pencil.png") });
    await edit.click();
    const form = page.getByRole("form", { name: "编辑上一条消息" });
    const editor = form.getByRole("textbox", { name: "编辑消息", exact: true });
    await editor.waitFor();
    await page.waitForFunction(() =>
      document.querySelector('.user-message-editor [contenteditable="true"]'),
    );
    assert((await editor.innerText()).includes("原消息"));
    async function checkSize(label) {
      const layout = await form.evaluate((element) => {
        const viewport = element.querySelector(".document-editor-viewport");
        return {
          width: element.offsetWidth,
          height: element.offsetHeight,
          lines:
            viewport.clientHeight /
            parseFloat(getComputedStyle(viewport).lineHeight),
          maxWidth:
            42 *
            parseFloat(getComputedStyle(document.documentElement).fontSize),
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        };
      });
      assert(
        Math.abs(layout.lines - (sizeBefore ? 6 : 2)) < 0.1,
        JSON.stringify(layout),
      );
      if (!sizeBefore)
        assert(layout.width <= layout.maxWidth + 2, JSON.stringify(layout));
      layouts.push({ label, ...layout });
      return layout;
    }
    async function checkStyle(label) {
      await editor.focus();
      await page.waitForTimeout(180);
      const focused = await form.evaluate((element) => {
        const own = getComputedStyle(element);
        const main = getComputedStyle(document.querySelector(".composer"));
        const send = getComputedStyle(
          element.querySelector('button[type="submit"]'),
        );
        const mainSend = getComputedStyle(
          document.querySelector(".send-button"),
        );
        return {
          background: own.backgroundColor,
          border: own.borderColor,
          shadow: own.boxShadow,
          mainBackground: main.backgroundColor,
          mainBorder: main.borderColor,
          mainShadow: main.boxShadow,
          sendBackground: send.backgroundColor,
          sendColor: send.color,
          mainSendBackground: mainSend.backgroundColor,
          mainSendColor: mainSend.color,
        };
      });
      await composer.focus();
      await page.waitForTimeout(180);
      const resting = await form.evaluate((element) => ({
        border: getComputedStyle(element).borderColor,
        mainBorder: getComputedStyle(document.querySelector(".composer"))
          .borderColor,
      }));
      styles.push({ label, focused, resting });
      if (!styleBefore && !sizeBefore) {
        assert.equal(focused.background, focused.mainBackground);
        assert.equal(focused.shadow, focused.mainShadow);
        assert.equal(focused.border, resting.mainBorder);
        assert.equal(resting.border, focused.mainBorder);
        assert.notEqual(focused.border, resting.border);
        assert.equal(focused.sendBackground, focused.mainSendBackground);
        assert.equal(focused.sendColor, focused.mainSendColor);
      }
      await editor.focus();
      await page.waitForTimeout(180);
    }
    await form.locator('[title="移除 planner.js"]').click();
    await editor.fill("向远端推送这一提交");
    const short = await checkSize("short");
    await checkStyle("light");
    await form.screenshot({ path: join(output, "compact-short-message.png") });
    for (const target of ["root", "editor"]) {
      await page.evaluate((target) => {
        if (target === "root") document.documentElement.style.fontSize = "17px";
        else
          document
            .querySelector(".user-message-editor")
            .style.setProperty("--chat-font-size", "20px");
      }, target);
      await checkSize("font-" + target);
      await page.evaluate(() => {
        document.documentElement.style.removeProperty("font-size");
        document
          .querySelector(".user-message-editor")
          .style.removeProperty("--chat-font-size");
      });
    }
    await editor.fill(
      Array.from({ length: 20 }, (_, i) => "第 " + (i + 1) + " 行长内容").join(
        "\n",
      ),
    );
    const long = await checkSize("long");
    assert.equal(long.height, short.height);
    assert(long.scrollHeight > long.clientHeight);
    await form.screenshot({ path: join(output, "compact-long-message.png") });

    assert.equal(await composer.innerText(), "底部草稿保持独立");
    await form.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await form.count(), 0);
    assert.equal(
      await page.evaluate(
        () =>
          editFixture.requests.filter((r) => /revert|rollback/.test(r.method))
            .length,
      ),
      0,
    );
    await edit.click();
    await page.waitForFunction(() =>
      document.querySelector('.user-message-editor [contenteditable="true"]'),
    );
    await editor.fill("修改后的消息");
    await editor.press("Enter");
    await page.keyboard.insertText("第二行");
    assert((await editor.innerText()).includes("第二行"));
    await page.screenshot({ path: join(output, "after-editor.png") });
    assert.equal(
      await page.evaluate(
        () =>
          editFixture.requests.filter((r) => r.method === "turn/start").length,
      ),
      0,
    );
    await page.evaluate(() => {
      editFixture.failRevert = true;
    });
    await form.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("模拟回退失败", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("原消息的回答", { exact: true }).count(),
      1,
    );
    assert((await editor.innerText()).includes("修改后的消息"));
    await page.evaluate(() => {
      editFixture.failRevert = false;
      editFixture.failSend = true;
    });
    await form.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("模拟发送失败", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("原消息的回答", { exact: true }).count(),
      0,
    );
    assert((await editor.innerText()).includes("第二行"));
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await checkStyle(theme);
      await form.screenshot({ path: join(output, `style-${theme}.png`) });
      for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
        await page.evaluate((value) => {
          document.documentElement.style.zoom = value;
        }, zoom);
        await checkSize(`${theme}-${zoom}`);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await page.screenshot({
          path: join(output, `edit-${theme}-${zoom}.png`),
        });
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = 1;
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "system";
    });
    await checkStyle("system-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await checkSize("mobile");
    await page.screenshot({ path: join(output, "edit-mobile.png") });
    await page.evaluate(() => {
      editFixture.failSend = false;
    });
    await editor.press("Control+Enter");
    await page.getByText("修改后的回答", { exact: true }).waitFor();
    assert.equal(await form.count(), 0);
    assert.equal(await composer.innerText(), "底部草稿保持独立");
    const sent = await page.evaluate(
      () =>
        editFixture.requests.filter((r) => r.method === "turn/start").at(-1)
          .params.input,
    );
    assert(sent[0].text.includes("修改后的消息"));
    assert(sent[0].text.includes("第二行"));
    assert(sent[1].text.includes("planner.js"));
    assert.equal(
      await page.evaluate(
        () =>
          editFixture.requests.filter((r) => r.method === "thread/revert")
            .length,
      ),
      2,
    );
    await page.reload();
    await page.getByText("修改后的回答", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("原消息的回答", { exact: true }).count(),
      0,
    );
    assert.equal(await composer.innerText(), "底部草稿保持独立");
    await page.setViewportSize({ width: 1440, height: 900 });
    await edit.click();
    await page.waitForFunction(() =>
      document.querySelector('.user-message-editor [contenteditable="true"]'),
    );
    await editor.fill("切换期间保留隔离");
    await page.evaluate(() => {
      editFixture.holdRevert = true;
    });
    await form.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(() => editFixture.release);
    await page
      .locator(".thread-link")
      .filter({ hasText: "另一条对话" })
      .click();
    await page.waitForFunction(
      () => localStorage.getItem("cx-current") === "other",
    );
    await page.evaluate(() => editFixture.release());
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(
        () =>
          editFixture.requests.filter((r) => r.method === "turn/start").length,
      ),
      0,
    );
    assert.equal(await page.locator(".user-message-editor").count(), 0);
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        layouts,
        styles,
        build: JSON.parse(
          await readFile(
            process.env.BROWSER_BUILD_INFO || join(root, "build-info.json"),
            "utf8",
          ),
        ),
        scenarios: before
          ? ["原恢复图标", "回填底部并覆盖草稿"]
          : [
              "铅笔入口",
              "原地编辑",
              "取消",
              "Enter 换行",
              "Ctrl+Enter 发送",
              "回退失败",
              "发送失败重试",
              "底部草稿隔离",
              "文件引用",
              "刷新恢复",
              "切换隔离",
              "深浅主题",
              "80% 至 200% 缩放",
              "窄屏",
            ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, output }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
