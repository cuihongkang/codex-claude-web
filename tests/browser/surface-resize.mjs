import { verifyResizeHandleStates } from "./resize-handle-states.mjs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { backendFixture } from "../helpers/backend-browser-fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const build = process.env.BROWSER_BUILD_DIR || join(root, "client/dist");
const output =
  process.env.BROWSER_OUTPUT_DIR ||
  join(root, ".cache/surface-resize", before ? "before" : "after");
await mkdir(output, { recursive: true });
const data = {
  markdown:
    "# 窗口调节测试\n\n请选择这段正文创建批注。\n\n![测试图片](https://fixture.test/image.svg)",
  claudeItems: [],
};
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
          `<head><script>(${backendFixture.toString().replace("legacy: [", 'legacy: [{ id: "resize-answer", type: "agentMessage", phase: "final_answer", text: "请选择这段正文创建批注。" },').replace("localStorage.clear();", "if (!sessionStorage.seeded) { localStorage.clear(); sessionStorage.seeded = '1'; }")})(${JSON.stringify(data)})</script>`,
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
const extension = join(profile, "zoom-extension");
await mkdir(extension);
await writeFile(
  join(extension, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    name: "Isolated browser zoom verification",
    version: "1.0",
    permissions: ["tabs"],
    background: { service_worker: "worker.js" },
  }),
);
await writeFile(
  join(extension, "worker.js"),
  "chrome.runtime.onInstalled.addListener(() => {});",
);
const context = await chromium.launchPersistentContext(profile, {
  viewport: { width: 1440, height: 1000 },
  executablePath: process.env.CHROME_PATH,
  headless: true,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    "--no-sandbox",
    "--no-proxy-server",
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
const results = [],
  errors = [];
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://fixture.test/image.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="gray"/></svg>',
    }),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".composer .ProseMirror").waitFor();
  const bounds = (locator) => locator.boundingBox();
  async function drag(handle, dx, dy) {
    const box = await bounds(handle);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + dx,
      box.y + box.height / 2 + dy,
      { steps: 8 },
    );
    await page.mouse.up();
  }
  async function inside(locator) {
    const box = await bounds(locator);
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    assert(
      box.x >= -1 &&
        box.y >= -1 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1,
      JSON.stringify({
        box,
        viewport,
        details: await locator.evaluate((node) => ({
          css: {
            width: getComputedStyle(node).width,
            min: getComputedStyle(node).minWidth,
            max: getComputedStyle(node).maxWidth,
            right: getComputedStyle(node).right,
          },
          parent: node.parentElement.getBoundingClientRect().toJSON(),
        })),
      }),
    );
  }
  const modal = page.getByRole("dialog");
  const corner = () =>
    modal.getByRole("button", { name: "调整窗口大小", exact: true });
  const openSettings = () =>
    page.getByRole("button", { name: "设置", exact: true }).click();
  await openSettings();
  if (before) {
    const original = await bounds(modal);
    assert.equal(await corner().count(), 0);
    await page.mouse.move(
      original.x + original.width - 20,
      original.y + original.height - 20,
    );
    await page.mouse.down();
    await page.mouse.move(
      original.x + original.width + 80,
      original.y + original.height - 75,
      { steps: 8 },
    );
    await page.mouse.up();
    assert.equal((await bounds(modal)).width, original.width);
    await page.screenshot({ path: join(output, "settings-fixed.png") });
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await page.locator('.context-tools button[title="文件"]').click();
    await page.getByRole("button", { name: "notes.md" }).click();
    await page.locator(".file-markdown-preview").waitFor();
    const panel = page.locator(".context-workspace");
    const originalPanel = await bounds(panel);
    assert.equal(
      await page
        .getByRole("separator", { name: "调整对话详情宽度", exact: true })
        .count(),
      0,
    );
    await page.mouse.move(originalPanel.x + 2, originalPanel.y + 50);
    await page.mouse.down();
    await page.mouse.move(originalPanel.x - 160, originalPanel.y + 50, {
      steps: 8,
    });
    await page.mouse.up();
    assert.equal((await bounds(panel)).width, originalPanel.width);
    await page.screenshot({ path: join(output, "file-preview-fixed.png") });
  } else {
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await verifyResizeHandleStates({
        before: process.env.RESIZE_STYLE_BEFORE === "1",
        page,
        handle: corner(),
        output: join(output, "handles", theme),
        name: "window",
      });
    }
    const original = await bounds(modal);
    await drag(corner(), 90, -70);
    let resized = await bounds(modal);
    assert(resized.width > original.width + 150);
    assert(resized.height < original.height - 100);
    await corner().focus();
    await page.keyboard.press("ArrowRight");
    assert((await bounds(modal)).width > resized.width + 5);
    resized = await bounds(modal);
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await openSettings();
    assert(Math.abs((await bounds(modal)).width - resized.width) < 2);
    await page.reload();
    await page.locator(".composer .ProseMirror").waitFor();
    await openSettings();
    assert(Math.abs((await bounds(modal)).width - resized.width) < 2);
    await corner().focus();
    await page.keyboard.press("Home");
    assert(Math.abs((await bounds(modal)).width - original.width) < 2);
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    const projectSidebar = page.locator("#project-sidebar");
    const projectHandle = page.getByRole("separator", {
      name: "调整侧栏宽度",
      exact: true,
    });
    const projectWidth = (await bounds(projectSidebar)).width;
    await drag(projectHandle, 50, 0);
    const projectExpanded = (await bounds(projectSidebar)).width;
    assert(projectExpanded > projectWidth + 40);
    await projectHandle.focus();
    await page.keyboard.press("ArrowLeft");
    assert((await bounds(projectSidebar)).width < projectExpanded - 5);
    await projectHandle.dblclick();
    assert(Math.abs((await bounds(projectSidebar)).width - projectWidth) < 1);
    for (const name of ["搜索对话", "技能", "插件与连接", "添加项目"]) {
      await page.getByRole("button", { name: new RegExp("^" + name) }).click();
      const initial = await bounds(modal);
      await drag(corner(), 40, 20);
      assert((await bounds(modal)).width > initial.width + 60);
      await corner().focus();
      await page.keyboard.press("Home");
      await inside(modal);
      await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    }
    await openSettings();
    await page.getByRole("button", { name: "添加供应商", exact: true }).click();
    const modelField = page.locator('textarea[name="models"]');
    await modelField.fill("demo-model");
    if (process.env.RESIZE_STYLE_BEFORE === "1") {
      await modelField.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, "native-input.png") });
    } else {
      const fieldHandle = page.getByRole("separator", {
        name: "调整输入框高度",
        exact: true,
      });
      await verifyResizeHandleStates({
        page,
        handle: fieldHandle,
        output: join(output, "handles"),
        name: "input",
      });
      const originalHeight = (await bounds(modelField)).height;
      await drag(fieldHandle, 0, 70);
      assert((await bounds(modelField)).height > originalHeight + 50);
      assert.equal(await modelField.inputValue(), "demo-model");
      await fieldHandle.focus();
      await page.keyboard.press("ArrowDown");
      assert((await bounds(modelField)).height > originalHeight + 60);
      await fieldHandle.dblclick();
      assert(Math.abs((await bounds(modelField)).height - originalHeight) < 1);
      assert.equal(await modelField.inputValue(), "demo-model");
    }
    await page.getByRole("button", { name: "取消", exact: true }).click();
    const pointer = await bounds(corner());
    await page.mouse.move(
      pointer.x + pointer.width / 2,
      pointer.y + pointer.height / 2,
    );
    await page.mouse.down();
    assert(await corner().evaluate((node) => node.hasPointerCapture(1)));
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal(
      await corner().evaluate((node) => node.hasPointerCapture(1)),
      false,
    );
    await page.mouse.up();
    const cdp = await context.newCDPSession(page);
    const touchStart = await bounds(corner());
    const point = {
      x: touchStart.x + touchStart.width / 2,
      y: touchStart.y + touchStart.height / 2,
    };
    const touchWidth = (await bounds(modal)).width;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x + 50, y: point.y - 30 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert((await bounds(modal)).width > touchWidth + 80);
    await cdp.detach();
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await page.locator('.context-tools button[title="文件"]').click();
    await page.getByRole("button", { name: "notes.md" }).click();
    await page.locator(".file-markdown-preview").waitFor();
    const panel = page.locator(".context-workspace");
    const edge = page.getByRole("separator", {
      name: "调整对话详情宽度",
      exact: true,
    });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await verifyResizeHandleStates({
        before: process.env.RESIZE_STYLE_BEFORE === "1",
        page,
        handle: edge,
        output: join(output, "handles", theme),
        name: "details",
      });
    }
    const initialPanel = await bounds(panel);
    await drag(edge, -160, 0);
    async function lightHandle() {
      const style = await edge.evaluate((node) => ({
        outline: getComputedStyle(node).outlineStyle,
        background: getComputedStyle(node).backgroundColor,
        markerHeight: parseFloat(getComputedStyle(node, "::after").height),
        markerOpacity: Number(getComputedStyle(node, "::after").opacity),
      }));
      assert.equal(style.outline, "none");
      assert.equal(style.background, "rgba(0, 0, 0, 0)");
      assert(style.markerHeight > 0 && style.markerHeight <= 50);
      assert(style.markerOpacity > 0);
    }
    const largePanel = await bounds(panel);
    await lightHandle();
    await page.screenshot({ path: join(output, "file-preview-expanded.png") });
    const footer = await bounds(page.locator(".conversation-footer"));
    assert(footer.x + footer.width <= largePanel.x + 1);
    assert(largePanel.width > initialPanel.width + 140);
    await edge.focus();
    await lightHandle();
    await page.screenshot({
      path: join(output, "file-preview-keyboard-focus.png"),
    });
    await page.keyboard.press("ArrowRight");
    assert((await bounds(panel)).width < largePanel.width - 5);
    await page.getByTitle("编辑 Markdown 源码", { exact: true }).click();
    await page.locator(".cm-content").fill("# 未保存的文件编辑");
    await drag(edge, -50, 0);
    assert.match(
      await page.locator(".cm-content").innerText(),
      /未保存的文件编辑/,
    );
    const savedPanel = await bounds(panel);
    await page.getByTitle("收起对话详情", { exact: true }).click();
    await page.locator('.context-tools button[title="文件"]').click();
    assert(Math.abs((await bounds(panel)).width - savedPanel.width) < 2);
    assert.match(
      await page.locator(".cm-content").innerText(),
      /未保存的文件编辑/,
    );
    await page.reload();
    await page.locator(".composer .ProseMirror").waitFor();
    await page.locator('.context-tools button[title="文件"]').click();
    assert(Math.abs((await bounds(panel)).width - savedPanel.width) < 2);
    await edge.dblclick();
    assert(Math.abs((await bounds(panel)).width - initialPanel.width) < 2);
    await page.getByTitle("收起对话详情", { exact: true }).click();
    await page.locator(".message-image-button").first().click();
    await page.locator(".image-viewer").waitFor();
    await verifyResizeHandleStates({
      before: process.env.RESIZE_STYLE_BEFORE === "1",
      page,
      handle: corner(),
      output: join(output, "handles"),
      name: "image",
    });
    const imageInitial = await bounds(modal);
    await drag(corner(), -90, -60);
    assert((await bounds(modal)).width < imageInitial.width - 150);
    await inside(modal);
    await page.screenshot({ path: join(output, "image-resized.png") });
    await page.getByRole("button", { name: "原始尺寸", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.locator(".image-viewer").waitFor({ state: "detached" });
    await page
      .locator('[data-annotation-message="resize-answer"]')
      .evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node.querySelector("p"));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
    await page
      .getByRole("button", { name: "注释选中文字", exact: true })
      .click();
    const annotation = page.getByRole("form", { name: "编辑批注" });
    await page.getByRole("textbox", { name: "批注内容" }).fill("保留批注草稿");
    const annotationHandle = annotation.getByRole("button", {
      name: "调整窗口大小",
      exact: true,
    });
    await verifyResizeHandleStates({
      before: process.env.RESIZE_STYLE_BEFORE === "1",
      page,
      handle: annotationHandle,
      output: join(output, "handles"),
      name: "annotation",
    });
    const annotationInitial = await bounds(annotation);
    await drag(annotationHandle, 100, 100);
    const annotationLarge = await bounds(annotation);
    assert(annotationLarge.width > annotationInitial.width + 80);
    assert(annotationLarge.height > annotationInitial.height + 60);
    assert.equal(
      await page.getByRole("textbox", { name: "批注内容" }).inputValue(),
      "保留批注草稿",
    );
    await inside(annotation);
    const doneBox = await bounds(
      page.getByRole("button", { name: "完成批注", exact: true }),
    );
    const handleBox = await bounds(annotationHandle);
    assert(doneBox.x + doneBox.width <= handleBox.x + 1);
    await page.screenshot({ path: join(output, "annotation-resized.png") });
    await annotationHandle.focus();
    await page.keyboard.press("ArrowDown");
    assert((await bounds(annotation)).height > annotationLarge.height + 5);
    await page.getByRole("button", { name: "完成批注", exact: true }).click();
    await page.locator(".annotation-draft-marker").click();
    assert((await bounds(annotation)).height > annotationInitial.height + 60);
    await annotationHandle.dblclick();
    await page.getByRole("button", { name: "完成批注", exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
          const actual = await worker.evaluate(
            async ({ url, zoom }) => {
              const [tab] = await chrome.tabs.query({ url });
              await chrome.tabs.setZoom(tab.id, zoom);
              return chrome.tabs.getZoom(tab.id);
            },
            { url: page.url(), zoom },
          );
          assert.equal(actual, zoom);
          await page.evaluate(
            (theme) => (document.documentElement.dataset.theme = theme),
            theme,
          );
          await page.locator('.context-tools button[title="文件"]').click();
          if (!(await page.locator(".file-markdown-preview").count()))
            await page.getByRole("button", { name: "notes.md" }).click();
          await page.locator(".file-markdown-preview").waitFor();
          await edge.focus();
          await page.keyboard.press("ArrowLeft");
          await inside(panel);
          await page.getByTitle("收起对话详情", { exact: true }).click();
          if (await page.getByTitle("显示侧栏", { exact: true }).isVisible()) {
            await page.getByTitle("显示侧栏", { exact: true }).click();
          }
          await openSettings();
          await drag(corner(), 30, 20);
          await inside(modal);
          const close = page.getByRole("button", {
            name: "关闭窗口",
            exact: true,
          });
          await inside(close);
          const metrics = await page.evaluate(() => ({
            dpr: devicePixelRatio,
            width: innerWidth,
            height: innerHeight,
            overflow: document.documentElement.scrollWidth > innerWidth,
          }));
          assert(Math.abs(metrics.dpr - zoom) < 0.02);
          assert.equal(metrics.overflow, false);
          results.push({ viewportWidth: width, theme, zoom, ...metrics });
          await page.screenshot({
            path: join(output, `${width}-${theme}-${zoom}.png`),
          });
          await close.click();
          // 窄屏设置入口点击后侧栏保持展开，通过关闭按钮恢复聊天区域。
          const sidebarClose = page.getByTitle("收起侧栏", { exact: true });
          if (await sidebarClose.isVisible()) await sidebarClose.click();
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ passed: true, before, results, errors }, null, 2),
  );
  console.log(
    before
      ? "PASS 旧构建复现固定窗口与文件预览"
      : "PASS 窗口拖动、键盘、尺寸恢复、文件草稿、图片预览及真实页面缩放",
    results.length,
  );
} finally {
  await context.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
