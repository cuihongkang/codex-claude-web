import assert from "node:assert/strict";
import { test } from "node:test";
import { completePasswordLogin } from "../src/infrastructure/password-manager.js";

test("登录成功通知浏览器保存密码，兼容未支持、禁止保存和等待确认", async () => {
  const originalWindow = globalThis.window;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const events = [];
  const state = { selected: "conversation" };
  const location = { href: "https://example.test:8766/#conversation" };
  globalThis.window = {
    location,
    history: {
      state,
      replaceState: (...args) => events.push(args),
    },
    PasswordCredential: class {
      constructor(value) {
        Object.assign(this, value);
      }
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      credentials: { store: async (credential) => events.push(credential) },
    },
  });
  try {
    completePasswordLogin("fixture", "fixture-password");
    assert.deepEqual(events[0], [state, "", location.href]);
    assert.equal(events[1].id, "fixture");
    assert.equal(events[1].password, "fixture-password");
    navigator.credentials.store = () =>
      Promise.reject(new Error("saving disabled"));
    completePasswordLogin("fixture", "fixture-password");
    await new Promise((resolve) => setImmediate(resolve));
    navigator.credentials.store = () => {
      throw new Error("not supported");
    };
    assert.doesNotThrow(() =>
      completePasswordLogin("fixture", "fixture-password"),
    );
    navigator.credentials.store = () => new Promise(() => {});
    assert.equal(
      completePasswordLogin("fixture", "fixture-password"),
      undefined,
    );
    delete window.PasswordCredential;
    assert.doesNotThrow(() =>
      completePasswordLogin("fixture", "fixture-password"),
    );
  } finally {
    globalThis.window = originalWindow;
    if (navigatorDescriptor)
      Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
  }
});
