import { backendFixture as fixture } from "../helpers/backend-browser-fixture.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { historyTurns } from "../../server/src/backends/claude/messages.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const build = join(
  root,
  before ? ".cache/regression-before/dist" : "client/dist",
);
const output = join(
  root,
  ".cache/backend-regressions",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const markdown =
  "请检查这些问题：\n\n- **列表需要正确显示**\n- 第二项包含 `代码`\n\n| 项目 | 状态 |\n| --- | --- |\n| 渲染 | 完成 |\n\n公式：$$x^2$$\n\n检查 @notes.md。";
const native = [
  { type: "user", uuid: "human", message: { content: "检查后台任务" } },
  {
    type: "user",
    uuid: "notification",
    origin: { kind: "task-notification" },
    message: {
      content:
        "<task-notification><task-id>fixture</task-id><summary>检查完成</summary></task-notification>",
    },
  },
  {
    type: "user",
    uuid: "interruption",
    isVisibleInTranscriptOnly: true,
    message: { content: "[Request interrupted by user]" },
  },
  {
    type: "assistant",
    uuid: "answer",
    message: {
      id: "reply",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "后台检查已完成。" }],
    },
  },
];
const claudeItems = before
  ? native.map((m) =>
      m.type === "user"
        ? {
            id: m.uuid,
            turnId: "human",
            type: "userMessage",
            content: [{ type: "text", text: m.message.content }],
          }
        : {
            id: "reply",
            turnId: "human",
            type: "agentMessage",
            phase: "final_answer",
            text: "后台检查已完成。",
          },
    )
  : historyTurns(native).flatMap((t) => t.items);

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
          `<head><script>(${fixture.toString()})(${JSON.stringify({ markdown, claudeItems })})</script>`,
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
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".user-bubble").waitFor();
  const capture = (name) =>
    page.screenshot({
      path: join(output, name + ".png"),
      animations: "disabled",
    });
  await capture("markdown-and-classification-light");
  await page.screenshot({
    path: join(output, "markdown-and-classification-detail.png"),
    clip: { x: 0, y: 0, width: 1440, height: 520 },
    animations: "disabled",
  });
  if (!before) {
    assert.equal(await page.locator(".user-bubble li").count(), 2);
    assert.equal(await page.locator(".user-bubble table").count(), 1);
    assert.equal(await page.locator(".user-bubble .katex").count(), 1);
    assert.equal(
      await page.locator(".user-bubble .user-file-reference").count(),
      1,
    );
    assert.equal(
      await page
        .locator(
          '.project-heading button[title="/native/codex-web/workspaces/chat-ABC123"]',
        )
        .count(),
      0,
    );
    await page.locator(".user-file-reference").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator('.context-workspace[data-open="true"]').count(),
      1,
    );
    await page
      .locator(".file-markdown-preview")
      .getByRole("heading", { name: "Notes", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "折叠对话详情", exact: true })
      .click();
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
        await capture(`markdown-${theme}-${zoom}`);
      }
    }
    await page.evaluate(() => (document.documentElement.style.zoom = 1));
  }
  // 项目展开后通过实际侧栏入口切换后端。
  const group = page
    .locator(".project-group")
    .filter({ has: page.locator('button[title="/demo/project"]') });
  await group.locator(".project-heading > button:first-child").click();
  await page.getByText("Claude 原生消息归属", { exact: true }).click();
  await page.getByText("后台检查已完成。", { exact: true }).waitFor();
  assert.equal(await page.locator(".error-banner").count(), 0);
  assert.deepEqual(errors, []);
  const userBounds = await page.locator(".user-bubble").first().boundingBox();
  const answerBounds = await page
    .locator(".assistant-message")
    .first()
    .boundingBox();
  assert(userBounds.y < answerBounds.y, "用户问题先于所属回复展示");
  await capture("claude-history");
  await page.screenshot({
    path: join(output, "claude-history-detail.png"),
    clip: { x: 0, y: 0, width: 1440, height: 330 },
    animations: "disabled",
  });
  if (!before) {
    assert.equal(await page.locator(".user-bubble").count(), 1);
    assert.equal(
      await page
        .getByText("[Request interrupted by user]", { exact: true })
        .count(),
      0,
    );
    await page.reload();
    await page.locator(".user-bubble li").first().waitFor();
    assert.equal(await page.locator(".user-bubble li").count(), 2);
    await page.setViewportSize({ width: 390, height: 844 });
    await capture("markdown-mobile");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        source:
          "生产构建、隔离浏览器及模拟传输；Claude 原生记录转换使用实际适配模块",
        build: JSON.parse(
          await readFile(join(root, "build-info.json"), "utf8"),
        ),
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
