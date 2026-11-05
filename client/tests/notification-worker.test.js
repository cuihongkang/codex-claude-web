import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("通知点击聚焦来源页面；页面关闭后携带所属用户和对话重新打开", async () => {
  const handlers = {};
  const calls = [];
  const client = {
    focus: async () => calls.push("focus"),
    postMessage: (message) => calls.push(message),
  };
  const self = {
    addEventListener: (name, handler) => {
      handlers[name] = handler;
    },
    registration: { showNotification: async (...args) => calls.push(args) },
    clients: {
      get: async (id) => {
        assert.equal(id, "source");
        return client;
      },
      openWindow: async (url) => calls.push(url),
    },
  };
  vm.runInNewContext(
    await readFile(
      new URL("../public/notification-worker.js", import.meta.url),
      "utf8",
    ),
    { self, URLSearchParams },
  );
  let promise;
  const waitUntil = (pending) => {
    promise = pending;
  };
  handlers.message({
    data: {
      type: "completion-notification",
      title: "任务标题",
      options: { data: { threadId: "a", username: "demo" } },
    },
    source: { id: "source" },
    ports: [{ postMessage: (message) => calls.push(message) }],
    waitUntil,
  });
  await promise;
  assert.equal(calls[0][0], "任务标题");
  assert.equal(calls[0][1].data.clientId, "source");
  assert.equal(calls[1].ok, true);
  calls.length = 0;
  const click = () =>
    handlers.notificationclick({
      notification: {
        data: { threadId: "a", username: "demo", clientId: "source" },
        close: () => calls.push("close"),
      },
      waitUntil,
    });
  click();
  await promise;
  assert.deepEqual(calls.slice(0, 2), ["close", "focus"]);
  assert.equal(calls[2].threadId, "a");
  assert.equal(calls[2].type, "open-notification-thread");
  calls.length = 0;
  self.clients.get = async () => null;
  click();
  await promise;
  assert.equal(calls[1], "/#notificationThread=a&notificationUser=demo");
});
