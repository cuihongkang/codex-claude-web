import assert from "node:assert/strict";
import { join } from "node:path";
export async function testNotifications({
  page,
  manager,
  codex,
  thread,
  output,
  baseline,
}) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  if (baseline) {
    await page.screenshot({ path: join(output, "before-settings.png") });
    return;
  }
  await page.getByLabel("离开标签页时提醒我").check();
  await page.getByText("系统通知已获授权。", { exact: false }).waitFor();
  await page.screenshot({ path: join(output, "settings-desktop.png") });
  await page.keyboard.press("Escape");
  const broadcast = (m) => {
    for (const client of codex.clients) client.send(JSON.stringify(m));
  };
  const complete = (id) => ({
    method: "turn/completed",
    params: { threadId: thread.id, turn: { id, status: "completed" } },
  });
  broadcast(complete("visible"));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.notificationLog.length), 0);
  await page.evaluate(() => {
    window.notificationHidden = true;
  });
  broadcast(complete("background"));
  broadcast(complete("background"));
  broadcast({
    id: 901,
    method: "item/tool/requestUserInput",
    params: { threadId: thread.id, turnId: "ask", questions: [] },
  });
  broadcast({
    method: "turn/completed",
    params: { threadId: thread.id, turn: { id: "failed", status: "failed" } },
  });
  const { session } = await manager.create();
  await manager.start(manager.sessions.get(session.id));
  manager.event(session.id, {
    type: "result",
    uuid: "claude-done",
    is_error: false,
  });
  manager.event(session.id, {
    type: "result",
    uuid: "claude-failed",
    is_error: true,
  });
  manager.event(session.id, {
    type: "control_request",
    request_id: "claude-ask",
    request: {
      subtype: "can_use_tool",
      tool_name: "AskUserQuestion",
      input: {},
    },
  });
  await page.waitForFunction(() => window.notificationLog.length === 6);
  assert.match(await page.title(), /6 条提醒/);
  await page.locator(".notification-inbox summary").click();
  await page.screenshot({ path: join(output, "inbox-desktop.png") });
  // Clicking the actual native notification handler opens the correct backend/session.
  await page.evaluate(() =>
    window.notificationLog
      .find((n) => n.title.startsWith("Claude") && n.title.includes("完成"))
      .onclick(),
  );
  await page.locator(".claude-workspace").waitFor();
  await page.evaluate(() =>
    window.notificationLog
      .find((n) => n.title.startsWith("Codex") && n.title.includes("完成"))
      .onclick(),
  );
  await page.locator(".claude-workspace").waitFor({ state: "detached" });
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).waitFor();
  await page.evaluate(() => {
    window.notificationHidden = true;
  });
  broadcast(complete("background"));
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.notificationLog.length),
    0,
    "replayed event after reload must not notify",
  );
  await page.evaluate(() => {
    Notification.permission = "denied";
    window.dispatchEvent(new Event("focus"));
  });
  broadcast(complete("denied-fallback"));
  await page.getByText("1 条消息提醒", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.notificationLog.length), 0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("系统通知已被浏览器阻止", { exact: false }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, "settings-mobile-denied.png") });
  await page.evaluate(() => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    window.dispatchEvent(new Event("focus"));
    document.documentElement.dataset.theme = "dark";
  });
  await page
    .getByText("当前地址或浏览器不支持系统通知", { exact: false })
    .waitFor();
  await page.screenshot({ path: join(output, "settings-mobile-http.png") });
  await page.getByLabel("离开标签页时提醒我").uncheck();
  await page.keyboard.press("Escape");
  broadcast(complete("disabled"));
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".notification-inbox").count(), 0);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const nativeContext = await page
    .context()
    .browser()
    .newContext({ permissions: ["notifications"] });
  try {
    const native = await nativeContext.newPage();
    await native.goto(page.url());
    await native.getByRole("button", { name: "设置", exact: true }).click();
    await native.getByLabel("离开标签页时提醒我").check();
    await native.keyboard.press("Escape");
    await native.evaluate(() =>
      Object.defineProperty(document, "visibilityState", {
        get: () => "hidden",
      }),
    );
    broadcast(complete("native-worker"));
    await native.waitForFunction(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return (
        r &&
        (await r.getNotifications()).some(
          (n) => n.title === "Codex · 任务已完成",
        )
      );
    });
  } finally {
    await nativeContext.close();
  }
  console.log(
    "PASS notifications: both providers, completion/failure/attention, click routing, foreground suppression, replay dedup, denied/HTTP fallback, opt-out, mobile",
  );
}
