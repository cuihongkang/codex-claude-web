import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { completionFixture } from "../fixtures/completion-notifications.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const build = process.env.BROWSER_BUILD_DIR || join(root, "client/dist");
const buildInfo =
  process.env.BROWSER_BUILD_INFO || join(root, "build-info.json");
const output = join(
  root,
  ".cache/completion-notifications",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium");
assert(process.env.PLAYWRIGHT_MODULE, "通过 PLAYWRIGHT_MODULE 指定 Playwright");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
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
        .replace(
          "<head>",
          `<head><script>(${completionFixture.toString()})()</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          { ".js": "text/javascript", ".css": "text/css" }[extname(path)] ||
          "text/html",
        "Cache-Control": "no-store",
      })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: process.env.HEADED !== "1",
  args: [
    "--no-sandbox",
    "--no-proxy-server",
    "--disable-gpu",
    "--no-zygote",
    "--disable-dev-shm-usage",
  ],
});
const evidence = [];
try {
  const context = await browser.newContext({
    permissions: ["notifications"],
    viewport: { width: 1200, height: 850 },
  });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const ready = async (target) => {
    await target.goto(origin);
    await target.getByRole("button", { name: "设置", exact: true }).waitFor();
    await target.waitForFunction(
      () => !document.querySelector(".connection-banner"),
    );
  };
  const settings = async (target) => {
    await target.getByRole("button", { name: "设置", exact: true }).click();
    return target.getByRole("checkbox", { name: "对话完成通知" });
  };
  const waitToggle = (target, enabled) =>
    target.waitForFunction((enabled) => {
      const input = document.querySelector(".notification-settings input");
      return input?.checked === enabled && !input.disabled;
    }, enabled);
  const notifications = (target) =>
    target.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return [];
      return (await registration.getNotifications()).map((notification) => ({
        title: notification.title,
        body: notification.body,
        tag: notification.tag,
        data: notification.data,
      }));
    });
  const waitCount = async (count) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = await notifications(page);
      if (snapshot.length === count) return snapshot;
      await page.waitForTimeout(50);
    }
    assert.fail(`等待 ${count} 条系统通知超时`);
  };
  await ready(page);
  if (before) {
    await settings(page);
    const toggle = page.getByRole("checkbox", { name: "对话完成通知" });
    if (await toggle.count()) {
      assert.equal(await toggle.isChecked(), false);
      await toggle.click();
      await page.getByText("已开启", { exact: true }).waitFor();
    }
    await page.screenshot({ path: join(output, "settings-light.png") });
    if (await page.locator(".notification-settings").count())
      await page
        .locator(".notification-settings")
        .screenshot({ path: join(output, "notification-control.png") });
    evidence.push({
      scenario: "修改前的通知设置",
      passed: true,
    });
  } else {
    const toggle = await settings(page);
    assert.equal(await toggle.isChecked(), true);
    assert.equal(await page.locator(".notification-settings p").count(), 0);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/notification-worker.js");
      await navigator.serviceWorker.ready;
    });
    const worker = context.serviceWorkers()[0];
    assert(worker);
    await worker.evaluate(() => {
      self.notificationCalls = [];
      const show = self.registration.showNotification.bind(self.registration);
      self.registration.showNotification = async (title, options) => {
        self.notificationCalls.push({ title, options });
        await show(title, options);
      };
    });
    await page.screenshot({ path: join(output, "settings-light.png") });
    await page
      .locator(".notification-settings")
      .screenshot({ path: join(output, "notification-control.png") });
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    const second = await context.newPage();
    await ready(second);
    const secondToggle = await settings(second);
    assert.equal(await secondToggle.isChecked(), true);
    await second.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await second.bringToFront();
    await Promise.all(
      [page, second].map((target) =>
        target.evaluate(() => {
          completionFixture.start("alpha", "one");
          completionFixture.start("beta", "two");
        }),
      ),
    );
    await Promise.all(
      [page, second].map((target) =>
        target.evaluate(() => {
          completionFixture.finish("alpha", "one");
          completionFixture.finish("beta", "two");
        }),
      ),
    );
    const actual = await waitCount(2);
    assert.deepEqual(
      actual.map((n) => n.title).sort(),
      ["构建检查", "界面核对"].sort(),
    );
    assert(actual.every((n) => n.body === "本轮任务已完成"));
    assert.deepEqual(actual.map((n) => n.data.threadId).sort(), [
      "alpha",
      "beta",
    ]);
    const claims = await page.evaluate(async () => {
      const database = await new Promise((resolve) => {
        const request = indexedDB.open("codex-web-notifications", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const count = await new Promise((resolve) => {
        const request = database
          .transaction("completions")
          .objectStore("completions")
          .count();
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      return count;
    });
    assert.equal(claims, 2);
    assert.equal(await worker.evaluate(() => self.notificationCalls.length), 2);
    evidence.push({
      scenario: "多个页面和多个对话",
      notifications: actual,
      claims,
      backgroundVisibility: await page.evaluate(() => document.visibilityState),
    });
    // 关闭通知后重放活动快照，检查持久领取记录，避免 tag 替换掩盖重复发送。
    await page.evaluate(async () => {
      for (const n of await (
        await navigator.serviceWorker.getRegistration()
      ).getNotifications())
        n.close();
    });
    await page.reload();
    await page.getByRole("button", { name: "设置", exact: true }).waitFor();
    await page.evaluate(() => {
      completionFixture.start("alpha", "one");
      completionFixture.snapshot();
      completionFixture.finish("alpha", "one");
      completionFixture.finish("beta", "two");
    });
    await page.waitForTimeout(500);
    assert.equal((await notifications(page)).length, 0);
    assert.equal(await worker.evaluate(() => self.notificationCalls.length), 2);
    evidence.push({
      scenario: "历史恢复、刷新、快照重连及重复事件去重",
      passed: true,
    });
    const beta = actual.find((n) => n.data.threadId === "beta");
    // Chromium 的真实通知已由 getNotifications 核对；点击分发使用实际 Worker 到页面消息。
    await worker.evaluate(async (data) => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const client = clients.find((c) => c.id === data.clientId) || clients[0];
      client.postMessage({
        type: "open-notification-thread",
        threadId: data.threadId,
        username: data.username,
      });
    }, beta.data);
    await Promise.any(
      [page, second].map((target) =>
        target.waitForFunction(
          () =>
            document
              .querySelector(".breadcrumb")
              ?.textContent?.includes("界面核对"),
          null,
          { timeout: 5000 },
        ),
      ),
    );
    evidence.push({ scenario: "点击消息跳转到所属对话", passed: true });
    const restored = await context.newPage();
    await restored.goto(
      origin + "/#notificationThread=alpha&notificationUser=demo",
    );
    await restored.waitForFunction(
      () => localStorage.getItem("cx-current") === "alpha",
    );
    assert.equal(new URL(restored.url()).hash, "");
    evidence.push({ scenario: "原页面关闭后的新页面目标恢复", passed: true });
    const off = await settings(page);
    await off.click();
    await waitToggle(page, false);
    const synced = await settings(second);
    await second.waitForFunction(
      () => !document.querySelector(".notification-settings input").checked,
    );
    assert.equal(await synced.isChecked(), false);
    const disabledPage = await context.newPage();
    await ready(disabledPage);
    assert.equal(await (await settings(disabledPage)).isChecked(), false);
    await disabledPage.reload();
    assert.equal(await (await settings(disabledPage)).isChecked(), false);
    await disabledPage.close();
    await Promise.all(
      [page, second].map((target) =>
        target.evaluate(() => {
          completionFixture.start("alpha", "disabled");
          completionFixture.finish("alpha", "disabled");
        }),
      ),
    );
    await page.waitForTimeout(300);
    assert.equal((await notifications(page)).length, 0);
    evidence.push({ scenario: "关闭提醒及跨页面同步", passed: true });
    await off.click();
    await waitToggle(page, true);
    await page.evaluate(() => {
      completionFixture.start("alpha", "failed");
      completionFixture.finish("alpha", "failed", "failed");
      completionFixture.start("alpha", "interrupted");
      completionFixture.finish("alpha", "interrupted", "interrupted");
    });
    await page.waitForTimeout(300);
    assert.equal((await notifications(page)).length, 0);
    evidence.push({ scenario: "失败和中断保持安静", passed: true });
    await page.evaluate(() => {
      const original = indexedDB.open.bind(indexedDB);
      indexedDB.open = () => {
        throw new Error("通知记录写入失败");
      };
      completionFixture.start("alpha", "storage-failure");
      completionFixture.finish("alpha", "storage-failure");
      window.restoreNotificationStorage = () => {
        indexedDB.open = original;
      };
    });
    await page.getByText("通知记录写入失败", { exact: true }).waitFor();
    assert.equal(await worker.evaluate(() => self.notificationCalls.length), 2);
    await page.evaluate(() => restoreNotificationStorage());
    evidence.push({
      scenario: "去重存储失败在设置中显示且聊天继续运行",
      passed: true,
    });
    await page.evaluate(() => {
      const original = navigator.serviceWorker.register.bind(
        navigator.serviceWorker,
      );
      window.pendingNotificationWorkers = [];
      navigator.serviceWorker.register = (...args) =>
        new Promise((resolve) =>
          pendingNotificationWorkers.push(() => resolve(original(...args))),
        );
      window.restoreNotificationWorker = () => {
        navigator.serviceWorker.register = original;
      };
      completionFixture.start("alpha", "pending-disable");
      completionFixture.finish("alpha", "pending-disable");
    });
    await page.waitForFunction(() => pendingNotificationWorkers.length > 0);
    await off.click();
    await waitToggle(page, false);
    await page.evaluate(() => {
      restoreNotificationWorker();
      for (const release of pendingNotificationWorkers) release();
    });
    await page.waitForTimeout(200);
    assert.equal(await worker.evaluate(() => self.notificationCalls.length), 2);
    await off.click();
    await waitToggle(page, true);
    evidence.push({ scenario: "关闭开关使等待中的通知失效", passed: true });
    await page.bringToFront();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
        await page.evaluate((zoom) => {
          document.documentElement.style.zoom = zoom;
        }, zoom);
        await page.screenshot({
          path: join(output, `settings-${theme}-${zoom}.png`),
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        assert(await off.isVisible());
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = 1;
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(output, "settings-mobile.png") });
    assert(await off.isVisible());
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    await cdp.send("Browser.setPermission", {
      permission: { name: "notifications" },
      setting: "denied",
      origin,
      browserContextId: targetInfo.browserContextId,
    });
    await page
      .getByText("通知权限已被阻止，请在浏览器的网站设置中允许通知。", {
        exact: true,
      })
      .waitFor();
    await page.screenshot({ path: join(output, "settings-denied.png") });
    evidence.push({ scenario: "权限撤销及状态即时刷新", passed: true });
    const unsupported = await browser.newContext();
    await unsupported.addInitScript(() => {
      Object.defineProperty(window, "Notification", { value: undefined });
    });
    const unsupportedPage = await unsupported.newPage();
    await ready(unsupportedPage);
    assert.equal(await (await settings(unsupportedPage)).isDisabled(), true);
    await unsupportedPage.getByText(/当前浏览器环境不支持系统通知/).waitFor();
    evidence.push({ scenario: "不支持通知时仍可使用聊天", passed: true });
    const pending = await browser.newContext();
    await pending.addInitScript(() => {
      window.notificationPermissionRequests = 0;
      Notification.requestPermission = async () => {
        notificationPermissionRequests++;
        return "default";
      };
    });
    const pendingPage = await pending.newPage();
    await ready(pendingPage);
    const pendingToggle = await settings(pendingPage);
    assert.equal(await pendingToggle.isChecked(), true);
    assert.equal(
      await pendingPage.evaluate(() => notificationPermissionRequests),
      0,
    );
    const allow = pendingPage.getByRole("button", {
      name: "允许系统通知",
      exact: true,
    });
    await allow.click();
    await allow.waitFor();
    assert.equal(
      await pendingPage.evaluate(() => notificationPermissionRequests),
      1,
    );
    assert.equal(await pendingToggle.isChecked(), true);
    await pendingPage.screenshot({
      path: join(output, "settings-pending.png"),
    });
    await pending.grantPermissions(["notifications"]);
    await allow.waitFor({ state: "hidden" });
    assert.equal(
      await pendingPage.locator(".notification-settings p").count(),
      0,
    );
    evidence.push({
      scenario: "默认开启、待授权操作及正常状态省略重复文案",
      passed: true,
    });
    assert.deepEqual(errors, []);
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        build: JSON.parse(await readFile(buildInfo, "utf8")),
        evidence,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, output, scenarios: evidence.length }),
  );
} finally {
  await browser.close();
  server.close();
}
