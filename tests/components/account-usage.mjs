import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testAccountUsage(app, requests, setResponse, emit) {
  const original = app.get();
  const originalNow = Date.now;
  const globals = Object.fromEntries(
    [
      "window",
      "document",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ].map((key) => [key, globalThis[key]]),
  );
  const intervals = new Map(),
    resets = new Map();
  let timerId = 100000;
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  globalThis.setInterval = (callback, delay) => {
    assert([30000, 60000].includes(delay));
    intervals.set(++timerId, { callback, delay });
    return timerId;
  };
  globalThis.clearInterval = (id) => intervals.delete(id);
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay <= 30000) return globals.setTimeout(callback, delay, ...args);
    resets.set(++timerId, callback);
    return timerId;
  };
  globalThis.clearTimeout = (id) => {
    if (!resets.delete(id)) globals.clearTimeout(id);
  };
  const snapshot = (usedPercent = 37, planType = "pro") => {
    const limits = {
      limitId: "codex",
      planType,
      primary: {
        usedPercent,
        windowDurationMins: 10080,
        resetsAt: Math.floor(Date.now() / 1000) + 3600,
      },
      secondary: null,
      credits: { hasCredits: true, unlimited: false, balance: "1250.75" },
    };
    return { rateLimits: limits, rateLimitsByLimitId: { codex: limits } };
  };
  const count = () =>
    requests.filter((r) => r.method === "account/rateLimits/read").length;
  let result = snapshot();
  setResponse(({ method }) =>
    method === "account/rateLimits/read" ? result : {},
  );
  let view;
  const text = () => JSON.stringify(view.toJSON());
  const remaining = () =>
    view.root
      .findAllByProps({ role: "progressbar" })
      .map((node) => node.props["aria-valuenow"]);
  const toggle = () => view.root.findByProps({ className: "quota-toggle" });
  const poll = () =>
    [...intervals.values()].find((entry) => entry.delay === 60000).callback();
  const tick = () =>
    [...intervals.values()].find((entry) => entry.delay === 30000).callback();
  try {
    app.set({
      connected: true,
      account: { type: "chatgpt", email: "demo@example.test", planType: "pro" },
      usage: null,
      usageError: "",
      usageLoading: false,
    });
    const start = count();
    await act(async () => {
      view = create(React.createElement(app.AccountFooter));
    });
    assert.equal(count(), start + 1);
    assert.deepEqual(remaining(), [63]);
    assert.match(text(), /周额度/);
    assert.equal(toggle().props["aria-expanded"], false);
    assert.equal(view.root.findAllByType("progress").length, 0);
    assert.equal(view.root.findAllByType("time").length, 0);
    assert.doesNotMatch(text(), /剩余点数/);
    assert.equal(intervals.size, 1);
    assert.equal(resets.size, 1);

    await act(async () => toggle().props.onClick());
    assert.equal(toggle().props["aria-expanded"], true);
    assert.match(text(), /剩余点数/);
    assert.match(text(), /1,250.75/);
    assert.match(text(), /Pro/);
    assert.match(text(), /后重置/);
    assert.match(text(), /月/);
    assert.equal(view.root.findAllByType("time").length, 1);
    assert.equal(intervals.size, 2);
    const beforeCountdown = count();
    Date.now = () => originalNow() + 30 * 60000;
    await act(async () => tick());
    assert.match(text(), /30 分钟后重置/);
    assert.equal(count(), beforeCountdown, "倒计时独立更新，不依赖后端读取");
    Date.now = originalNow;
    await act(async () => tick());

    await act(async () =>
      emit("account/rateLimits/updated", {
        rateLimits: {
          limitId: null,
          primary: {
            usedPercent: 81,
            windowDurationMins: null,
            resetsAt: null,
          },
          planType: null,
        },
      }),
    );
    assert.deepEqual(remaining(), [19]);
    assert.match(text(), /Pro/);
    let release;
    result = new Promise((resolve) => (release = resolve));
    const beforeConcurrent = count();
    let first;
    await act(async () => {
      first = app.refreshUsage();
      assert.equal(app.refreshUsage(), first);
    });
    assert.equal(count(), beforeConcurrent + 1);
    await act(async () =>
      emit("account/rateLimits/updated", {
        rateLimits: { limitId: "codex", primary: { usedPercent: 90 } },
      }),
    );
    await act(async () => {
      release(snapshot(10));
      await first;
    });
    assert.deepEqual(remaining(), [10], "迟到的读取响应保留通知中的较新额度");

    result = snapshot(20);
    document.visibilityState = "hidden";
    const beforeHidden = count();
    await act(async () => poll());
    assert.equal(count(), beforeHidden);
    document.visibilityState = "visible";
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    assert.deepEqual(remaining(), [80]);
    assert.equal(count(), beforeHidden + 1);
    await act(async () => window.dispatchEvent(new Event("focus")));
    assert.equal(count(), beforeHidden + 2);
    await act(async () => [...resets.values()][0]());
    assert.equal(count(), beforeHidden + 3, "重置时间到达自动读取后端");
    result = { error: { message: "模拟额度接口暂不可用" } };
    await act(async () => poll());
    assert.deepEqual(remaining(), [80]);
    assert.match(text(), /1,250.75/);
    assert.match(text(), /待更新/);
    assert.equal(app.get().error, original.error);
    result = snapshot(0);
    await act(async () => poll());
    assert.deepEqual(remaining(), [100]);
    assert.doesNotMatch(text(), /待更新/);

    await act(async () => toggle().props.onClick());
    assert.equal(toggle().props["aria-expanded"], false);
    assert.equal(intervals.size, 1, "收起详情清理倒计时，仅保留额度自动读取");
    await act(async () => app.set({ connected: false }));
    assert.equal(intervals.size, 0);
    assert.equal(resets.size, 0);
    const beforeDisconnected = count();
    await act(async () => window.dispatchEvent(new Event("focus")));
    assert.equal(count(), beforeDisconnected);
    assert.match(text(), /待更新/);
    await act(async () => app.set({ connected: true }));
    assert.equal(count(), beforeDisconnected + 1);

    let releaseOldAccount;
    result = new Promise((resolve) => (releaseOldAccount = resolve));
    let oldAccountRead;
    await act(async () => {
      oldAccountRead = app.refreshUsage();
    });
    const plus = snapshot(42, "plus");
    plus.rateLimits.secondary = {
      usedPercent: 25,
      windowDurationMins: 300,
      resetsAt: Math.floor(Date.now() / 1000) + 7200,
    };
    setResponse(({ method }) => {
      if (method === "account/read")
        return {
          account: {
            type: "chatgpt",
            planType: "plus",
            email: "plus@example.test",
          },
        };
      if (method === "account/rateLimits/read") return plus;
      return {};
    });
    await act(async () =>
      emit("account/updated", { authMode: "chatgpt", planType: "plus" }),
    );
    await act(async () => {
      releaseOldAccount(snapshot(99));
      await oldAccountRead;
    });
    assert.deepEqual(remaining(), [58, 75]);
    assert.equal(toggle().props["aria-expanded"], false, "切换账户后默认折叠");
    await act(async () => toggle().props.onClick());
    assert.match(text(), /Plus/);
    assert.match(text(), /5 小时额度/);
    await act(async () =>
      view.root.findByProps({ "aria-label": "账户与设置" }).props.onClick(),
    );
    assert.equal(app.get().modal.type, "settings");

    setResponse(({ method }) =>
      method === "account/rateLimits/read" ? snapshot(42, "plus") : {},
    );
    await act(async () => app.refreshUsage());
    assert.deepEqual(remaining(), [58], "完整读取清除后端已移除的第二个窗口");
    await act(async () => app.set({ usage: snapshot(120) }));
    assert.deepEqual(remaining(), [0]);
    await act(async () => app.set({ usage: snapshot(-5) }));
    assert.deepEqual(remaining(), [100]);

    await act(async () => toggle().props.onClick());
    for (const [credits, expected] of [
      [{ hasCredits: true, balance: "0" }, "0"],
      [{ hasCredits: false, balance: "200" }, "0"],
      [{ unlimited: true }, "无限额"],
      [{ hasCredits: true, balance: null }, "余额暂不可用"],
    ]) {
      await act(async () => app.set({ usage: { rateLimits: { credits } } }));
      const row = view.root.findByProps({ className: "quota-credits" });
      assert.equal(row.findByType("b").children.join(""), expected);
      assert.doesNotMatch(text(), /暂无额度数据/);
    }
    await act(async () =>
      emit("account/rateLimits/updated", {
        rateLimits: { credits: { balance: "350.5" } },
      }),
    );
    assert.match(text(), /350.5/);
    await act(async () =>
      emit("account/rateLimits/updated", { rateLimits: { credits: null } }),
    );
    assert.match(text(), /350.5/);
    await act(async () => app.set({ connected: false }));
    assert.match(text(), /待更新/);
    assert.match(text(), /350.5/);
    await act(async () => app.set({ connected: true }));
    await act(async () =>
      app.set({ usage: { rateLimits: { primary: null, credits: null } } }),
    );
    assert.doesNotMatch(text(), /剩余点数/);
    assert.match(text(), /暂无额度数据/);
    await act(async () =>
      app.set({ account: { type: "apiKey" }, usage: null }),
    );
    const beforeApi = count();
    await act(async () => app.refreshUsage());
    assert.equal(count(), beforeApi);
    assert.deepEqual(remaining(), []);
    assert.match(text(), /API Key/);
    assert.equal(
      view.root.findAllByProps({ className: "quota-toggle" }).length,
      0,
    );
    await act(async () =>
      app.set({
        current: { id: "backend:claude:native" },
        backendId: "claude",
        providerId: "",
        backends: [{ id: "claude", ready: true }],
        account: { type: "claude", usageSupported: true },
        usage: snapshot(),
      }),
    );
    assert.equal(resets.size, 1, "Claude 原生窗口到期时安排自动校准");
    assert.equal(intervals.size, 1);
    const beforeClaude = count();
    await act(async () =>
      app.set({
        current: { id: "backend:claude:session" },
        backendId: "claude",
        account: null,
        usage: null,
        providers: [
          { id: "local", name: "LM Studio" },
          { id: "other", name: "Other" },
        ],
        providerId: "local",
        backends: [{ id: "claude", ready: true }],
      }),
    );
    assert.match(text(), /LM Studio/);
    assert.doesNotMatch(text(), /Codex/);
    assert.equal(
      view.root.findAllByProps({ className: "quota-toggle" }).length,
      0,
    );
    assert.equal(intervals.size, 0);
    assert.equal(resets.size, 0);
    assert.equal(count(), beforeClaude);
    await act(async () => app.set({ providerId: "other" }));
    assert.match(text(), /Other/);
    await act(async () =>
      app.set({ providers: [], backends: [{ id: "claude", ready: false }] }),
    );
    assert.match(text(), /Claude Code/);
    assert.match(text(), /正在连接/);
    await act(async () =>
      app.set({
        current: null,
        backendId: "codex",
        backends: [],
        account: { type: "apiKey" },
      }),
    );
    assert.match(text(), /API Key/);
  } finally {
    await act(async () => view?.unmount());
    assert.equal(intervals.size, 0);
    assert.equal(resets.size, 0);
    Object.assign(globalThis, globals);
    Date.now = originalNow;
    app.set(original);
  }
  console.log(
    "PASS 账户额度展示、自动校准、稀疏通知、失败恢复、请求合并及账户隔离",
  );
}
