import { completePasswordLogin } from "../infrastructure/password-manager.js";
export function createSession({ get, set, transport, connection }) {
  let authRevision = 0;
  let authMutating = false;
  function applySession(session) {
    authRevision++;
    if (session.authenticated && session.expiresAt <= Date.now())
      session = { authenticated: false };
    set({ auth: session, authError: "" });
    if (session.authenticated) {
      if (!transport.connection || transport.connection.readyState > 1)
        transport.connect();
    } else {
      connection.reset();
      set({
        connected: false,
        usageLoading: false,
        modal: null,
        terminalOpen: false,
      });
      transport.disconnect(
        new Error("登录已结束；已提交的任务会在电脑上继续。"),
      );
    }
  }
  async function authRequest(path, input) {
    const response = await fetch(`/api/auth/${path}`, {
      method: input ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      ...(input
        ? {
            headers: {
              "Content-Type": "application/json",
              "X-Codex-Web-Request": "1",
            },
            body: JSON.stringify(input),
          }
        : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "登录请求失败，请重试。");
    return result;
  }
  async function checkSession() {
    if (authMutating) return;
    const revision = ++authRevision;
    try {
      const session = await authRequest("session");
      if (revision === authRevision) applySession(session);
    } catch {
      if (revision === authRevision)
        set({ authError: "暂时无法检查登录状态，请检查连接后重试。" });
    }
  }
  async function login(username, password) {
    const revision = ++authRevision;
    authMutating = true;
    try {
      const session = await authRequest("login", { username, password });
      if (revision === authRevision) {
        if (session.authenticated && session.expiresAt > Date.now())
          completePasswordLogin(username, password);
        applySession(session);
      }
    } finally {
      authMutating = false;
    }
  }
  async function logout() {
    const revision = ++authRevision;
    authMutating = true;
    try {
      const session = await authRequest("logout", {});
      if (revision === authRevision) applySession(session);
    } finally {
      authMutating = false;
    }
  }
  return { applySession, checkSession, login, logout };
}
