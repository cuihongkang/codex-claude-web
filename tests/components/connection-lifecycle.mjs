import assert from "node:assert/strict";

export async function testConnectionLifecycle(
  app,
  requests,
  setResponse,
  emit,
  getSocket,
) {
  const original = app.get();
  const thread = {
    id: "connection-new-thread",
    cwd: "/connection-fixture",
    createdAt: 1,
  };
  const model = {
    id: "connection-model",
    model: "connection-model",
    isDefault: true,
  };
  let finishList;
  let finishTurn;
  let sending;
  let holdList = true;
  const start = requests.length;
  setResponse(({ method }) => {
    if (method === "model/list") return { data: [model] };
    if (method === "account/read") return { account: null };
    if (method === "config/read") return { config: { model: model.model } };
    if (method === "thread/list" && holdList) {
      holdList = false;
      return new Promise((resolve) => (finishList = resolve));
    }
    if (method === "thread/list") return { data: [] };
    if (method === "thread/start") return { thread };
    if (method === "turn/start")
      return new Promise((resolve) => (finishTurn = resolve));
    if (method === "thread/read" || method === "thread/resume")
      return { thread };
    if (method === "lan/projectless/read") return { directories: {} };
    return { data: [] };
  });
  try {
    app.newChat(thread.cwd);
    app.set({
      connected: false,
      threads: [],
      active: {},
      busy: false,
      loading: false,
    });
    await emit("lan/state", {
      ready: true,
      defaultCwd: thread.cwd,
      questions: [],
      activeTurns: {},
      terminals: {},
    });
    for (let attempt = 0; attempt < 20 && !finishList; attempt++)
      await Promise.resolve();
    assert(finishList);
    app.newChat(thread.cwd);
    app.setDraft("纯文字新对话首次发送");
    sending = app.sendMessage();
    for (let attempt = 0; attempt < 20 && !finishTurn; attempt++)
      await Promise.resolve();
    assert(finishTurn);
    finishList({ data: [], nextCursor: null });
    for (let attempt = 0; attempt < 40; attempt++) await Promise.resolve();
    const restores = requests
      .slice(start)
      .filter((request) =>
        ["thread/read", "thread/resume"].includes(request.method),
      );
    assert.deepEqual(
      restores,
      [],
      "后台初始化应保留用户新建对话的首次发送，避免恢复尚未提交完成的新会话",
    );
    finishTurn({ turn: { id: "connection-turn", status: "inProgress" } });
    assert.equal(await sending, true);
    assert.equal(app.get().current.id, thread.id);
    assert.equal(app.get().draft, "");
    const oversized = {
      id: "oversized-image",
      name: "large.png",
      input: {
        type: "image",
        url: "data:image/png;base64," + "a".repeat(64 * 1024 * 1024),
      },
    };
    app.setDraft("保留这条图片消息以便调整后重试");
    app.set({ attachments: [oversized] });
    const beforeOversized = requests.length;
    assert.equal(await app.sendMessage(), false);
    assert.equal(requests.length, beforeOversized);
    assert.equal(app.get().draft, "保留这条图片消息以便调整后重试");
    assert.deepEqual(app.get().attachments, [oversized]);
    assert.match(app.get().error, /单次消息过大.*64 MiB/);
    app.set({ attachments: [], draft: "", error: "" });
    const connection = getSocket();
    const originalTimeout = globalThis.setTimeout;
    const originalFetch = globalThis.fetch;
    let reconnect;
    try {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          authenticated: true,
          username: "fixture",
          expiresAt: Date.now() + 86400000,
        }),
      });
      globalThis.setTimeout = (callback, milliseconds, ...args) => {
        if (milliseconds === 1500) {
          reconnect = callback;
          return 0;
        }
        return originalTimeout(callback, milliseconds, ...args);
      };
      connection.readyState = 3;
      connection.onclose();
      assert(reconnect);
      reconnect();
      for (let attempt = 0; attempt < 10; attempt++) await Promise.resolve();
      assert.notEqual(getSocket(), connection);
      app.set({ connected: true });
      connection.onmessage({
        data: JSON.stringify({
          method: "lan/state",
          params: { ready: false, questions: [], activeTurns: {} },
        }),
      });
      connection.onclose();
      assert.equal(app.get().connected, true);
      const active = getSocket();
      const count = requests.length;
      active.readyState = 3;
      await assert.rejects(app.rpc("test/closed-connection"), /连接/);
      assert.equal(requests.length, count);
      active.readyState = WebSocket.OPEN;
    } finally {
      globalThis.setTimeout = originalTimeout;
      globalThis.fetch = originalFetch;
    }
  } finally {
    if (finishTurn)
      finishTurn({ turn: { id: "connection-turn", status: "inProgress" } });
    if (sending) await sending;
    app.newChat();
    app.set(original);
  }
  console.log(
    "PASS 后台初始化迟到时保留首次发送、图片超限保留草稿附件与连接事件隔离",
  );
}
