import { tmpdir } from "node:os";
import { testBrowserZoom } from "./browser-zoom.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { backendFixture } from "../helpers/backend-browser-fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const main = process.env.UI_MAIN === "1";
const before = process.env.UI_BEFORE === "1";
const build = process.env.UI_BUILD_DIR || join(root, "client/dist");
const output = join(
  root,
  ".cache/backend-interactions",
  before ? "before" : main ? "main" : "dual",
);
await mkdir(output, { recursive: true });
const data = { main, markdown: "交互对照问题", claudeItems: [] };
const server = http.createServer(async (req, res) => {
  if (serveDemoSession(req, res)) return;
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    let bytes = await readFile(join(build, path === "/" ? "index.html" : path));
    if (path === "/")
      bytes = bytes
        .toString()
        .replace(
          "<head>",
          `<head><script>(${backendFixture.toString()})(${JSON.stringify(data)})</script>`,
        );
    res
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
          }[extname(path)] || "text/html",
      })
      .end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const profile = await mkdtemp(join(tmpdir(), "backend-ui-"));
const context = await chromium.launchPersistentContext(profile, {
  viewport: { width: 1440, height: 1000 },
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server"],
});
try {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const input = page.locator(".composer .ProseMirror");
  await input.waitFor();
  await page.locator(".user-bubble").waitFor();
  const capture = (name) =>
    page.screenshot({
      path: join(output, name + ".png"),
      animations: "disabled",
    });
  const metrics = {};
  await input.fill("保留的输入草稿");
  await page.evaluate(() => {
    window.originalComposer = document.querySelector(".composer .ProseMirror");
  });
  await page.getByRole("button", { name: "展开对话详情", exact: true }).click();
  await page.getByRole("region", { name: "对话功能", exact: true }).waitFor();
  await capture("workspace-open");
  await page.getByRole("button", { name: "折叠对话详情", exact: true }).click();
  assert.equal(await input.innerText(), "保留的输入草稿");
  await page.getByRole("button", { name: /^搜索对话/ }).click();
  const search = page.getByPlaceholder("按标题或内容搜索对话");
  await search.fill("旧版未分类");
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  assert.equal(await input.innerText(), "保留的输入草稿");
  await page.getByRole("button", { name: "技能", exact: true }).click();
  await page.getByText("测试技能", { exact: true }).waitFor();
  await capture("skills");
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await page.evaluate(() =>
    window.backendSocket.emit("turn/started", {
      threadId: "legacy",
      turn: {
        id: "active",
        status: "inProgress",
        startedAt: Date.now() / 1000,
      },
    }),
  );
  await page.getByRole("button", { name: "停止任务", exact: true }).waitFor();
  const model = page.getByLabel("模型", { exact: true });
  assert.equal(
    await model.isDisabled(),
    before,
    "运行中可为下一轮选择同供应商模型",
  );
  const second = await model
    .locator("option")
    .evaluateAll(
      (options) =>
        options.find((o) => o.textContent.endsWith("Second Model")).value,
    );
  await capture("running-model-selection");
  if (!before) await model.selectOption(second);
  assert.equal(await input.innerText(), "保留的输入草稿");
  await page.getByRole("button", { name: "技能", exact: true }).click();
  await page.getByText("测试技能", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await page.evaluate(() =>
    window.backendSocket.emit("turn/completed", {
      threadId: "legacy",
      turn: {
        id: "active",
        status: "completed",
        completedAt: Date.now() / 1000,
      },
    }),
  );
  await page.getByRole("button", { name: "调整思考强度", exact: true }).click();
  await page.getByRole("slider", { name: "思考强度", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "调整思考强度", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  await input.fill("第一行");
  await input.press("End");
  await input.press("Enter");
  await input.pressSequentially("第二行");
  assert((await input.innerText()).includes("第二行"));
  assert.equal(
    await page.evaluate(() =>
      window.fixtureRequests.some((r) => r.method === "turn/start"),
    ),
    false,
    "Enter 保持换行",
  );
  await input.fill("保留的输入草稿");
  if (!main && !before) {
    const resumes = await page.evaluate(
      () =>
        window.fixtureRequests.filter(
          (request) => request.method === "thread/resume",
        ).length,
    );
    await page.evaluate(() =>
      window.backendSocket.setBackendReady("codex", false),
    );
    await page.waitForFunction(
      () => document.querySelector(".send-button").disabled,
    );
    assert.equal(await input.innerText(), "保留的输入草稿");
    await page.evaluate(() =>
      window.backendSocket.setBackendReady("codex", true),
    );
    await page.waitForFunction(
      (count) =>
        window.fixtureRequests.filter(
          (request) => request.method === "thread/resume",
        ).length > count,
      resumes,
    );
    await page.waitForFunction(
      () => !document.querySelector(".send-button").disabled,
    );
    assert.equal(await input.innerText(), "保留的输入草稿");
    assert.equal(
      await page.evaluate(
        () =>
          window.originalComposer ===
          document.querySelector(".composer .ProseMirror"),
      ),
      true,
    );
    await capture("backend-recovered-draft");
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (v) => (document.documentElement.dataset.theme = v),
      theme,
    );
    for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
      await page.evaluate(
        (v) => (document.documentElement.style.zoom = v),
        zoom,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await capture(`desktop-${theme}-${zoom}`);
      metrics[`${theme}-${zoom}`] = await page.evaluate(() => {
        const r = document.querySelector(".composer").getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          inputLineHeight: getComputedStyle(
            document.querySelector(".ProseMirror"),
          ).lineHeight,
        };
      });
    }
  }
  await page.evaluate(() => (document.documentElement.style.zoom = 1));
  await page.setViewportSize({ width: 390, height: 844 });
  const breadcrumb = page.locator(".topbar .breadcrumb > button");
  assert.equal(
    await breadcrumb.isVisible(),
    !before,
    "窄屏保留当前项目及目录选择入口",
  );
  await capture("mobile-chat");
  await page.getByRole("button", { name: "显示侧栏", exact: true }).click();
  await capture("mobile-sidebar");
  await page
    .locator('.project-heading > button[title="未指定项目的对话"]')
    .click();
  await page.getByText("客户端未分类", { exact: true }).waitFor();
  await capture("mobile-unclassified");
  if (!before) {
    await page
      .getByText("旧版未分类与 Markdown", { exact: true })
      .first()
      .click();
    await input.waitFor();
    assert.equal(await input.innerText(), "保留的输入草稿");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  if (!main && !before)
    await testBrowserZoom({
      context: page.context(),
      page,
      artifacts: join(output, "browser-zoom"),
    });
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        main,
        metrics,
        source:
          "同一隔离数据与实际浏览器操作；main 与双后端分别使用独立生产构建",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, main, output }));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  server.close();
}
