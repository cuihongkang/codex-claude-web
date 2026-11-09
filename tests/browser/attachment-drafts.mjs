import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { historyPerformanceFixture } from "../fixtures/history-performance.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const build = process.env.BROWSER_BUILD_DIR || join(root, "client/dist");
const output = join(
  root,
  ".cache/attachment-drafts",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
};
const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let body = await readFile(join(build, path === "/" ? "index.html" : path));
    if (path === "/")
      body = body
        .toString()
        .replace(
          "<head>",
          `<head><script>(${historyPerformanceFixture.toString()})()</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          path === "/"
            ? "text/html"
            : types[extname(path)] || "application/octet-stream",
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
const results = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const field = () => page.locator(".markdown-composer .ProseMirror");
    await field().waitFor();
    await field().fill("请检查这张测试图片");
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 120;
      const context = canvas.getContext("2d");
      context.fillStyle = "#dbeafe";
      context.fillRect(0, 0, 200, 120);
      context.fillStyle = "#1e40af";
      context.font = "24px sans-serif";
      context.fillText("Draft image", 24, 70);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const uploads = [
      {
        name: "draft-image.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      },
      {
        name: "draft-notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("文件附件的完整正文"),
      },
    ];
    const input = page.locator('.composer input[type="file"]');
    if (before) {
      for (const file of uploads) {
        await input.setInputFiles(file);
        await page.getByTitle(`移除 ${file.name}`, { exact: true }).waitFor();
      }
    } else await input.setInputFiles(uploads);
    await page.locator(".attachment img").waitFor();
    await page.getByTitle("移除 draft-notes.txt", { exact: true }).waitFor();
    await page.screenshot({ path: join(output, `${width}-uploaded.png`) });
    if (width < 700) await page.getByTitle("显示侧栏", { exact: true }).click();
    if (width < 600)
      await page
        .locator(".sidebar-backdrop.visible")
        .click({ position: { x: 380, y: 400 } });
    await page
      .getByRole("button", { name: "预览 draft-image.png", exact: true })
      .click();
    await page.getByRole("dialog", { name: "图片预览" }).waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "预览 draft-notes.txt", exact: true })
      .click();
    assert.equal(
      await page.locator(".attachment-preview-body pre").innerText(),
      "文件附件的完整正文",
    );
    await page.keyboard.press("Escape");
    const zip = Buffer.from([80, 75, 3, 4, 0, 255, 128, 1]);
    await input.setInputFiles({
      name: "archive.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
    await page
      .getByRole("button", { name: "预览 archive.zip", exact: true })
      .click();
    assert.equal(await page.locator(".attachment-preview-body pre").count(), 0);
    const bytes = await page
      .locator(".attachment-preview-body a")
      .evaluate(async (a) =>
        Array.from(new Uint8Array(await (await fetch(a.href)).arrayBuffer())),
      );
    assert.deepEqual(bytes, Array.from(zip));
    await page.keyboard.press("Escape");
    await page.getByTitle("移除 archive.zip", { exact: true }).click();
    // 展开隔离项目，使用真实侧栏入口切换到已有对话。
    if (width < 600)
      await page.getByRole("button", { name: "显示侧栏", exact: true }).click();
    if (!(await page.getByText("简短对话", { exact: true }).isVisible()))
      await page.locator(".project-heading > button").first().click();
    await page.getByText("简短对话", { exact: true }).click();
    await field().waitFor();
    assert.equal(await page.locator(".attachment").count(), 0);
    await page.getByTitle("在当前目录新建对话", { exact: true }).click();
    await field().waitFor();
    assert.equal(await field().innerText(), "请检查这张测试图片");
    assert.equal(await page.locator(".attachment img").count(), before ? 0 : 1);
    assert.equal(await page.locator(".attachment").count(), before ? 0 : 2);
    await page.screenshot({ path: join(output, `${width}-returned.png`) });
    await page.locator(".composer").screenshot({
      path: join(output, `${width}-returned-composer.png`),
    });
    if (!before) {
      assert.equal(
        await page
          .locator(".attachment img")
          .evaluate((img) => img.complete && img.naturalWidth === 200),
        true,
      );
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "dark"),
      );
      await page.screenshot({
        path: join(output, `${width}-returned-dark.png`),
      });
      await page.getByTitle("移除 draft-image.png", { exact: true }).click();
      await page.getByTitle("移除 draft-notes.txt", { exact: true }).click();
      await page.getByTitle("在当前目录新建对话", { exact: true }).click();
      assert.equal(await page.locator(".attachment").count(), 0);
    }
    assert.deepEqual(errors, []);
    results.push({
      width,
      textRestored: true,
      imageRestored: !before,
      fileRestored: !before,
      errors,
    });
    await page.close();
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ before, build, results }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, before, output }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
