import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const buildRoot = before ? join(root, ".cache/project-priority-before") : root;
const build = join(buildRoot, before ? "dist" : "client/dist");
const output = join(
  root,
  ".cache/project-priority",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium");
assert(process.env.PLAYWRIGHT_MODULE, "通过 PLAYWRIGHT_MODULE 指定 Playwright");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));

function fixture() {
  if (!localStorage.getItem("priority-fixture")) {
    localStorage.clear();
    localStorage.setItem("priority-fixture", "1");
    localStorage.setItem("cx-theme", JSON.stringify("light"));
    localStorage.setItem(
      "cx-projects",
      JSON.stringify(["/demo/Atlas", "/demo/Empty"]),
    );
  }
  const threads = [
    { id: "beacon", cwd: "/demo/Beacon", name: "最新活跃对话", createdAt: 300 },
    { id: "atlas", cwd: "/demo/Atlas", name: "较早的项目对话", createdAt: 100 },
  ];
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              method: "lan/state",
              params: {
                ready: true,
                defaultCwd: "/demo/Atlas",
                activeTurns: {},
                questions: [],
                terminals: {},
              },
            }),
          }),
        0,
      );
    }
    send(raw) {
      const message = JSON.parse(raw);
      let result = { data: [] };
      if (message.method === "thread/list") result = { data: threads };
      if (message.method === "lan/projectless/read")
        result = { directories: {} };
      if (message.method === "config/read") result = { config: {} };
      if (message.method === "account/read") result = { account: null };
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({ id: message.id, result }),
          }),
        0,
      );
    }
  };
}

const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let content = await readFile(
      join(build, path === "/" ? "index.html" : path),
    );
    if (path === "/")
      content = content
        .toString()
        .replace("<head>", `<head><script>(${fixture.toString()})()</script>`);
    response
      .writeHead(200, {
        "Content-Type":
          { ".js": "text/javascript", ".css": "text/css" }[extname(path)] ||
          "text/html",
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
const evidence = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 850 },
  });
  const headings = page.locator(".project-heading > button:first-child");
  const paths = () =>
    headings.evaluateAll((elements) => elements.map((e) => e.title));
  const expected = [
    "/demo/Atlas",
    "/demo/Empty",
    "/demo/Beacon",
    "未指定项目的对话",
  ];
  await page.goto("http://127.0.0.1:" + server.address().port);
  await headings.nth(3).waitFor();
  assert.deepEqual(
    await paths(),
    before
      ? ["/demo/Beacon", "/demo/Atlas", "/demo/Empty", "未指定项目的对话"]
      : expected,
  );
  const capture = async (name) => {
    await page.mouse.move(700, 700);
    await page.screenshot({
      path: join(output, name + ".png"),
      animations: "disabled",
    });
    if (name === "desktop-light")
      await page.screenshot({
        path: join(output, "sidebar.png"),
        clip: { x: 0, y: 190, width: 240, height: 210 },
      });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    evidence.push({ name, paths: await paths() });
  };
  await capture("desktop-light");
  if (!before) {
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.fill("固定项目排序验证草稿");
    await page
      .getByRole("button", { name: "固定 Beacon", exact: true })
      .click();
    assert.deepEqual(await paths(), [
      "/demo/Atlas",
      "/demo/Empty",
      "/demo/Beacon",
      "未指定项目的对话",
    ]);
    await page
      .getByRole("button", { name: "取消固定 Beacon", exact: true })
      .click();
    assert.deepEqual(await paths(), expected);
    await page
      .getByRole("button", { name: "取消固定 Atlas", exact: true })
      .click();
    assert.deepEqual(await paths(), [
      "/demo/Empty",
      "/demo/Atlas",
      "/demo/Beacon",
      "未指定项目的对话",
    ]);
    assert.equal(await composer.inputValue(), "固定项目排序验证草稿");
    await capture("empty-only-pin");
    await page
      .getByRole("button", { name: "固定 Beacon", exact: true })
      .click();
    assert.deepEqual(await paths(), [
      "/demo/Empty",
      "/demo/Beacon",
      "/demo/Atlas",
      "未指定项目的对话",
    ]);
    await page
      .getByRole("button", { name: "取消固定 Beacon", exact: true })
      .click();
    await page.getByRole("button", { name: "固定 Atlas", exact: true }).click();
    await page.reload();
    await headings.nth(3).waitFor();
    assert.deepEqual(await paths(), expected);
    const empty = page.locator(
      '.project-group:has(button[title="/demo/Empty"])',
    );
    assert.equal(await empty.locator(".thread-row").count(), 0);
    await empty.locator(".project-heading > button:first-child").click();
    await capture("empty-collapsed");
    await empty.locator(".project-heading > button:first-child").click();
    await page
      .getByRole("button", { name: "在 Empty 中新建对话", exact: true })
      .click();
    assert.deepEqual(await paths(), expected);
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await capture("desktop-dark");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "显示侧栏", exact: true }).click();
  await capture("mobile-sidebar");
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        build: JSON.parse(
          await readFile(join(buildRoot, "build-info.json"), "utf8"),
        ),
        data: "独立浏览器配置、模拟 WebSocket、钉选空项目与不同活动时间的隔离对话",
        evidence,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, before, output }));
} finally {
  await browser.close();
  server.close();
}
