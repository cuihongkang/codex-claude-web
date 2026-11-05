import test from "node:test";
import assert from "node:assert/strict";
import {
  createBrowserNotifications,
  notificationPreference,
} from "../src/infrastructure/notifications.js";

test("通知默认开启，手动关闭持久保留，等待授权时保留开启偏好", async (t) => {
  const originals = new Map();
  const storage = new Map();
  let requests = 0;
  const notification = {
    permission: "default",
    requestPermission: async () => {
      requests++;
      return "default";
    },
  };
  for (const [key, value] of Object.entries({
    isSecureContext: true,
    Notification: notification,
    window: { Notification: notification, indexedDB: {} },
    navigator: { serviceWorker: {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  const browser = createBrowserNotifications();
  assert.equal(browser.status().enabled, true);
  assert.equal(requests, 0);
  browser.disable();
  assert.equal(createBrowserNotifications().status().enabled, false);
  assert.equal(storage.get(notificationPreference), "false");
  await browser.enable();
  assert.equal(requests, 1);
  assert.equal(browser.status().permission, "default");
  assert.equal(createBrowserNotifications().status().enabled, true);
});
