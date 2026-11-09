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
  ".cache/skill-suggestions",
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
  await field.focus();
  await page.keyboard.type("@dmsk");
  await page.waitForTimeout(350);
  const option = page.getByRole("option").filter({ hasText: "demo-skill" });
  if (before) assert.equal(await option.count(), 0);
  else await option.waitFor();
  const inputBounds = await page.locator(".composer-wrap").boundingBox();
  const popupBounds = await page.locator(".shortcut-popover").boundingBox();
  await page.screenshot({
    path: join(output, "fuzzy-query.png"),
    clip: {
      x: Math.min(inputBounds.x, popupBounds.x),
      y: popupBounds.y,
      width: Math.max(inputBounds.width, popupBounds.width),
      height: inputBounds.y + inputBounds.height - popupBounds.y,
    },
  });
  if (!before) {
    await option.hover();
    await page.keyboard.press("Enter");
    await page.getByRole("listbox").waitFor({ state: "hidden" });
    await field.locator('[data-reference-kind="skill"]').waitFor();
    await page.keyboard.type("next");
    assert.equal(await field.textContent(), "demo-skill next");
    const saved = await page.evaluate(() =>
      localStorage.getItem("cx-draft-short"),
    );
    assert.match(saved, /\/demo\/SKILL\.md/);
    await page
      .locator(".composer")
      .screenshot({ path: join(output, "confirmed.png") });
    await page.getByRole("button", { name: "技能", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "技能", exact: true });
    await dialog.getByPlaceholder("搜索已安装技能").fill("dmsk");
    await dialog
      .locator(".catalog-card")
      .filter({ hasText: "demo-skill" })
      .waitFor();
    await dialog.screenshot({ path: join(output, "dialog-fuzzy.png") });
    await dialog.getByPlaceholder("搜索已安装技能").fill("zzzzzzzz");
    await dialog.getByText("没有匹配的技能", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "关闭窗口", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log(
    before
      ? "PASS 修复前缩写查询无匹配，已保留截图"
      : "PASS 缩写模糊查询、候选选择、回车关闭与技能路径保留",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  server.close();
}
