import assert from "node:assert/strict";

export async function testAuthentication(app, setResponse, getSocket) {
  const original = app.get();
  const fetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let successfulLogins = 0;
  globalThis.window = {
    history: { state: null, replaceState: () => successfulLogins++ },
    location: { href: "https://component-test/" },
  };
  const session = {
    authenticated: true,
    username: "fixture",
    expiresAt: Date.now() + 86400000,
  };
  let finishRequest;
  setResponse(
    () =>
      new Promise((resolve) => {
        finishRequest = resolve;
      }),
  );
  const old = getSocket();
  old.close = () => {
    old.readyState = 2;
  };
  try {
    app.set({
      connected: true,
      attachments: [{ id: "auth-attachment", name: "notes.txt" }],
    });
    app.setDraft("会话结束后保留的草稿");
    const pending = app.rpc("auth/pending");
    const rejected = assert.rejects(pending, /登录已结束/);
    app.applySession({ authenticated: false });
    await rejected;
    assert.equal(app.get().connected, false);
    assert.equal(app.get().draft, "会话结束后保留的草稿");
    assert.equal(app.get().attachments[0].id, "auth-attachment");
    app.applySession(session);
    assert.notEqual(getSocket(), old);
    app.set({ connected: true });
    old.onclose({ code: 4401 });
    old.onmessage({
      data: JSON.stringify({
        method: "lan/state",
        params: { ready: false, questions: [], activeTurns: {} },
      }),
    });
    assert.equal(app.get().auth.authenticated, true);
    assert.equal(app.get().connected, true);
    finishRequest({});
    await Promise.resolve();

    let finishCheck;
    const response = (value) => ({ ok: true, json: async () => value });
    globalThis.fetch = (url) =>
      url.endsWith("/session")
        ? new Promise((resolve) => {
            finishCheck = resolve;
          })
        : Promise.resolve(response({ authenticated: false }));
    const checking = app.checkSession();
    const current = getSocket();
    current.close = () => {
      current.readyState = 2;
    };
    await app.logout();
    finishCheck(response(session));
    await checking;
    assert.equal(
      app.get().auth.authenticated,
      false,
      "退出前的迟到会话查询不能恢复登录",
    );

    let finishLogin;
    let fetches = 0;
    globalThis.fetch = () => {
      fetches++;
      return new Promise((resolve) => {
        finishLogin = resolve;
      });
    };
    const signingIn = app.login("fixture", "fixture-password");
    await app.checkSession();
    assert.equal(fetches, 1, "自动检查等待正在提交的登录");
    finishLogin(response(session));
    await signingIn;
    assert.equal(app.get().auth.authenticated, true);
    assert.equal(successfulLogins, 1);

    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({ error: "用户名或密码错误" }),
    });
    await assert.rejects(app.login("fixture", "wrong"), /用户名或密码错误/);
    assert.equal(successfulLogins, 1, "错误密码不通知浏览器保存");

    let finishOldLogin;
    globalThis.fetch = () =>
      new Promise((resolve) => (finishOldLogin = resolve));
    const oldLogin = app.login("fixture", "fixture-password");
    getSocket().close = () => {};
    app.applySession({ authenticated: false });
    finishOldLogin(response(session));
    await oldLogin;
    assert.equal(successfulLogins, 1, "失效请求不通知浏览器保存");
  } finally {
    globalThis.fetch = fetch;
    globalThis.window = originalWindow;
    app.set(original);
    app.applySession(session);
  }
  console.log(
    "PASS 登录失效立即结束待处理请求，保留草稿附件，隔离旧连接与迟到查询及登录期间的自动检查",
  );
}
