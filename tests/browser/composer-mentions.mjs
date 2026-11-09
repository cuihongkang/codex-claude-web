import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { composerReferenceFixture } from "../fixtures/composer-references.mjs";
import { historyPerformanceFixture } from "../fixtures/history-performance.mjs";
const editorAssetTypes = {
  js: "text/javascript",
  css: "text/css",
  png: "image/png",
  ico: "image/x-icon",
};

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const output = join(
  root,
  ".cache/composer-mentions",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let body = await readFile(
      join(root, "client/dist", path === "/" ? "index.html" : path),
    );
    if (path === "/")
      body = body
        .toString()
        .replace(
          "<head>",
          `<head><script>{const saved=location.search==='?restore=1'?localStorage.getItem('cx-draft-short'):null;(${historyPerformanceFixture.toString()})();(${composerReferenceFixture.toString()})();if(saved){localStorage.setItem('cx-draft-short',saved);localStorage.setItem('cx-current','short');}}</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          path === "/"
            ? "text/html"
            : editorAssetTypes[extname(path).slice(1)] ||
              "application/octet-stream",
      })
      .end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(join(tmpdir(), "claudex-mentions-browser-"));
const context = await chromium.launchPersistentContext(profile, {
  viewport: { width: 1040, height: 780 },
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server"],
});
try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("PAGE ERROR", error.message);
  });

  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByRole("button", { name: /^简短对话/ }).click();
  const field = page.locator(".markdown-composer .ProseMirror");
  await field.waitFor();
  await field.click();
  await page.keyboard.type("@");
  await page
    .getByRole("option")
    .filter({ hasText: "引用已保存的会话正文" })
    .first()
    .waitFor();
  await page
    .locator(".composer")
    .screenshot({ path: join(output, "mentions.png") });
  await page
    .getByRole("option")
    .filter({ hasText: "引用已保存的会话正文" })
    .first()
    .click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("listbox").count(), 0);
  await page.keyboard.insertText("继续");
  await page.waitForTimeout(100);
  const text = await field.textContent();
  assert.match(text, / 继续$/);
  await page
    .locator(".composer")
    .screenshot({ path: join(output, "confirmed.png") });
  console.log("PASS", text);
  async function clear() {
    await field.focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
  }
  async function choose(query, kind = "file", key = "Enter") {
    await page.keyboard.type("@" + query);
    const option = page.getByRole("option").filter({ hasText: query }).first();
    await option.waitFor();
    await option.hover();
    await page.keyboard.press(key);
    await page.getByRole("listbox").waitFor({ state: "hidden" });
    await field
      .locator('[data-reference-kind="' + kind + '"]')
      .last()
      .waitFor();
  }
  for (const query of ["@demo/", "@/", "@demo/nested/", "前文 @demo/"]) {
    await clear();
    await page.keyboard.type(query);
    await page.getByRole("listbox", { name: "引用建议" }).waitFor();
    await page.getByRole("option").filter({ hasText: "sample.js" }).waitFor();
    assert.equal(await field.textContent(), query);
    assert.equal(
      await page.getByRole("option").filter({ hasText: "demo-skill" }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("listbox", { name: "快捷命令", exact: true })
        .count(),
      0,
    );
    await page.keyboard.press("Escape");
  }
  await clear();
  await page.keyboard.type("@target");
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.shortcut-options [role="option"]').length ===
      4,
  );
  assert.deepEqual(
    await page.locator('.shortcut-options [role="option"] b').allTextContents(),
    ["target", "target.js", "a.js", "b.js"],
  );
  await page.keyboard.press("Escape");
  await clear();
  await page.keyboard.type("@资");
  await page.getByRole("option").filter({ hasText: "资料" }).hover();
  await page.keyboard.press("Tab");
  assert.equal(await field.textContent(), "@资料");
  assert.equal(await field.locator(".document-reference").count(), 0);
  await page.getByRole("listbox", { name: "引用建议" }).waitFor();
  await page.keyboard.type("/");
  await page.getByRole("option").filter({ hasText: "sample.js" }).waitFor();
  assert.equal(await field.textContent(), "@资料/");
  await page.getByRole("option").filter({ hasText: "sample.js" }).hover();
  await page.keyboard.press("Tab");
  assert.equal(await field.textContent(), "@资料/sample.js");
  await page.getByRole("option").filter({ hasText: "sample.js" }).waitFor();
  await page.keyboard.press("Enter");
  await field.locator('[data-reference-kind="file"]').waitFor();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  await clear();
  await page.keyboard.type("/demo");
  await page.getByRole("option").filter({ hasText: "demo-skill" }).waitFor();
  await page.keyboard.press("Escape");
  await clear();
  await field.fill("前文  后文");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await choose("分析.py");
  assert.equal(await field.textContent(), "前文 分析.py 后文");
  await clear();
  await choose("sample.js");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+ArrowRight");
  const clipboard = await field.evaluate((element) => {
    const transfer = new DataTransfer();
    element.dispatchEvent(
      new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
    return {
      html: transfer.getData("text/html"),
      text: transfer.getData("text/plain"),
    };
  });
  assert.match(clipboard.html, /at-mention-fs-path/);
  assert.equal(clipboard.text, "sample.js");
  await clear();
  await field.evaluate((element, clipboard) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", clipboard.html);
    transfer.setData("text/plain", clipboard.text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  }, clipboard);
  await field.locator(".document-reference").waitFor();
  await page.keyboard.type(" ");

  await page.keyboard.type("next");
  assert.equal(await field.textContent(), "sample.js next");
  assert.equal(await field.locator(".document-reference").count(), 1);
  assert.equal(await page.locator(".attachments").count(), 0);
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Delete");

  assert.equal(await field.locator(".document-reference").count(), 0);
  await page.keyboard.press("Control+z");
  await field.locator(".document-reference").waitFor();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" ");
  await choose("分析.py");
  await choose("图片.png");
  await choose("资料", "directory");
  await choose("demo-skill", "skill");
  assert.equal(await field.locator(".lucide-file-code2").count(), 1);
  assert.equal(await field.locator(".lucide-file-image").count(), 1);
  assert.equal(await field.locator(".lucide-folder").count(), 1);
  assert.equal(await field.locator(".lucide-sparkles").count(), 1);
  assert.equal(await field.locator("svg[viewBox='0 0 24 24']").count(), 5);
  const savedDraft = await page.evaluate(() =>
    localStorage.getItem("cx-draft-short"),
  );
  await page.goto("http://127.0.0.1:" + server.address().port + "/?restore=1");
  await field.waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".document-reference").length === 5,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("cx-draft-short")),
    savedDraft,
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".markdown-composer .ProseMirror")
        ?.contentEditable === "true",
  );
  await field.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("继续");
  await page.waitForFunction(() =>
    document
      .querySelector(".markdown-composer .ProseMirror")
      ?.textContent.endsWith("继续"),
  );
  assert.match(await field.textContent(), /demo-skill 继续$/);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await page
      .locator(".composer")
      .screenshot({ path: join(output, "inline-" + theme + ".png") });
  }
  await field.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" ");
  await choose("超长", "thread");
  const settings = await page.context().newPage();
  await settings.goto("chrome://settings/appearance");
  const zoom = settings.locator("#zoomLevel");
  const originalZoom = await zoom.inputValue();
  const zoomResults = [];
  try {
    for (const width of [1280, 390])
      for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
        await page.setViewportSize({ width, height: 900 });
        await zoom.selectOption(String(scale));
        await page.reload();
        await field.waitFor();
        await page.waitForFunction(
          () => document.querySelectorAll(".document-reference").length === 6,
        );
        if (
          await page
            .getByRole("button", { name: "收起侧栏", exact: true })
            .isVisible()
        )
          await page
            .getByRole("button", { name: "收起侧栏", exact: true })
            .click();
        if (width === 390) {
          await page
            .getByRole("button", { name: "显示侧栏", exact: true })
            .click();
          await page
            .getByRole("button", { name: "收起侧栏", exact: true })
            .click();
        }
        const metrics = await page.locator(".composer").evaluate((element) => ({
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
          width: innerWidth,
          dpr: devicePixelRatio,
          scroll: element.scrollWidth,
          client: element.clientWidth,
        }));
        assert(
          metrics.left >= -1 && metrics.right <= metrics.width + 1,
          JSON.stringify(metrics),
        );
        assert(metrics.scroll <= metrics.client + 1, JSON.stringify(metrics));
        for (const theme of ["light", "dark"]) {
          await page.evaluate(
            (theme) => (document.documentElement.dataset.theme = theme),
            theme,
          );
          await page.screenshot({
            path: join(
              output,
              "inline-" + width + "-" + scale + "-" + theme + ".png",
            ),
          });
        }
        zoomResults.push({ width, scale, ...metrics });
      }
  } finally {
    await zoom.selectOption(originalZoom);
    await settings.close();
    await page.setViewportSize({ width: 1040, height: 780 });
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page
    .locator(".composer")
    .screenshot({ path: join(output, "inline-complete.png") });
  await writeFile(
    join(output, "zoom.json"),
    JSON.stringify(zoomResults, null, 2),
  );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.waitForFunction(() =>
    window.historyFixture.requests.some((r) => r.method === "turn/start"),
  );
  const submitted = await page.evaluate(
    () =>
      window.historyFixture.requests.find((r) => r.method === "turn/start")
        .params.input,
  );
  assert.equal(submitted.filter((part) => part.type === "skill").length, 1);
  assert.equal(submitted.filter((part) => part.type === "text").length, 2);
  await page.locator(".user-text .inline-reference").first().waitFor();
  assert.equal(await page.locator(".user-text .inline-reference").count(), 6);
  assert.equal(submitted.filter((part) => part.type === "mention").length, 1);
  assert.match(submitted.at(-1).text, /read_thread/);
  assert.equal(await page.locator(".user-text .lucide-file-image").count(), 1);
  await page
    .locator(".user-text")
    .screenshot({ path: join(output, "sent.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS 文件类型、技能、会话节点，Enter/Tab、空格、整段删除、撤销、刷新草稿与原生提交回显",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  server.close();
}
