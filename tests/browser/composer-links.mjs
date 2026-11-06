import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { historyPerformanceFixture } from "../fixtures/history-performance.mjs";
const editorAssetTypes = {
  js: "text/javascript",
  css: "text/css",
  png: "image/png",
  ico: "image/x-icon",
};

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const output = join(root, ".cache/composer-links", before ? "before" : "after");
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
          `<head><script>{const saved=location.search==='?restore=1'?localStorage.getItem('cx-draft-short'):null;(${historyPerformanceFixture.toString()})();if(saved){localStorage.setItem('cx-draft-short',saved);localStorage.setItem('cx-current','short');}}</script>`,
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
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server"],
});
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1040, height: 780 },
  });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  for (const scenario of [
    { id: "markdown", text: "[链接](https://example.com)", method: "keys" },
    { id: "url-paste", text: "https://example.com", method: "paste" },
    { id: "url-keys", text: "https://example.com", method: "keys" },
    { id: "url-insert", text: "https://example.com", method: "insert" },
    { id: "autolink", text: "<https://example.com>", method: "paste" },
  ]) {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: /^简短对话/ }).click();
    const field = page.locator(".markdown-composer .ProseMirror");
    await field.waitFor();
    await field.click();
    if (scenario.method === "keys") await page.keyboard.type(scenario.text);
    else if (scenario.method === "insert")
      await page.keyboard.insertText(scenario.text);
    else
      await field.evaluate((element, text) => {
        const transfer = new DataTransfer();
        transfer.setData("text/plain", text);
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      }, scenario.text);
    await page.keyboard.press("Space");
    await page.keyboard.type("后续文字");
    await page.waitForTimeout(150);
    const links = await field.locator("a").allTextContents();
    const draft = await page.evaluate(() =>
      localStorage.getItem("cx-draft-short"),
    );
    results.push({ ...scenario, links, draft, html: await field.innerHTML() });
    await page
      .locator(".composer")
      .screenshot({ path: join(output, scenario.id + ".png") });
    if (!before) {
      assert(
        links.every((text) => !text.includes("后续文字") && !/\s$/.test(text)),
        scenario.id,
      );
      assert(draft.endsWith(" 后续文字"), draft);
      if (scenario.method === "paste" || scenario.id === "markdown")
        assert.equal(links.length, 1);
      if (links.length) {
        await page.keyboard.press("Control+Home");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.type("X");
        assert.equal(
          await field.locator("a").textContent(),
          links[0].slice(0, 1) + "X" + links[0].slice(1),
        );
        await page.keyboard.press("Control+z");
        assert.equal(await field.locator("a").textContent(), links[0]);
      }
      if (scenario.id === "url-paste") {
        await page.goto(`http://127.0.0.1:${server.address().port}/?restore=1`);
        await field.waitFor();
        await field.click();
        await page.keyboard.press("Control+End");
        await page.keyboard.insertText(" 恢复续写");
        assert.equal(await field.locator("a").textContent(), links[0]);
        assert((await field.textContent()).endsWith(" 后续文字 恢复续写"));
        await page.keyboard.press("Control+z");
        await page.waitForFunction(
          () => !document.querySelector('[aria-label="发送消息"]').disabled,
        );
        for (const theme of ["light", "dark"]) {
          await page.evaluate(
            (theme) => (document.documentElement.dataset.theme = theme),
            theme,
          );
          await page
            .locator(".composer")
            .screenshot({ path: join(output, `url-${theme}.png`) });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(250);
        await field.scrollIntoViewIfNeeded();
        await page
          .locator(".composer")
          .screenshot({ path: join(output, "url-mobile.png") });
        await page.setViewportSize({ width: 1040, height: 780 });
      }
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await page.waitForFunction(() =>
        window.historyFixture.requests.some(
          (request) => request.method === "turn/start",
        ),
      );
      const input = await page.evaluate(
        () =>
          window.historyFixture.requests.find(
            (request) => request.method === "turn/start",
          ).params.input,
      );
      assert(
        input.some(
          (item) => item.type === "text" && item.text.endsWith(" 后续文字"),
        ),
      );
    }
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        before,
        results,
        errors,
        build: JSON.parse(
          await readFile(join(root, "build-info.json"), "utf8"),
        ),
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
