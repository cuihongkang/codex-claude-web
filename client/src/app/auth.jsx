import React, { useEffect, useState } from "react";
import { LockKeyhole, LogOut, LoaderCircle } from "lucide-react";
import {
  useStore,
  checkSession,
  login,
  logout,
  applySession,
  get,
  startNotifications,
} from "../store.js";
import claudexWebIcon from "../assets/claudex-web.svg";
import { CertificateHelp } from "./certificate-help.jsx";

export function AuthenticationGate({ children }) {
  const { auth, authError, theme } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => startNotifications(), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") checkSession();
    };
    refresh();
    const interval = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, []);
  useEffect(() => {
    if (!auth?.authenticated) return;
    let timer;
    const expire = () => {
      const remaining = auth.expiresAt - Date.now();
      if (remaining <= 0) {
        applySession({ authenticated: false });
        return;
      }
      timer = setTimeout(expire, Math.min(remaining, 2147483647));
    };
    expire();
    return () => clearTimeout(timer);
  }, [auth]);
  if (auth?.authenticated) return children;
  const waiting = auth === null;
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await login(fields.get("username"), fields.get("password"));
    } catch (failure) {
      form.elements.namedItem("password").value = "";
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <img src={claudexWebIcon} width="40" height="40" alt="" />
          <span>Claudex Web</span>
        </div>
        <h1 id="login-title">
          {waiting ? "正在检查登录状态" : "登录你的工作空间"}
        </h1>
        {waiting ? (
          <>
            {authError ? (
              <>
                <p role="alert" className="inline-error">
                  {authError}
                </p>
                <button className="primary" onClick={checkSession}>
                  重新检查
                </button>
              </>
            ) : (
              <LoaderCircle className="spin" aria-label="正在检查" />
            )}
          </>
        ) : (
          <>
            <form
              id="login-form"
              action="/api/auth/login"
              method="post"
              autoComplete="on"
              onSubmit={submit}
            >
              <label className="field-label">
                用户名
                <input
                  id="login-username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  required
                  maxLength={256}
                  autoCapitalize="none"
                  spellCheck={false}
                  readOnly={busy}
                />
              </label>
              <label className="field-label">
                密码
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={1024}
                  readOnly={busy}
                />
              </label>
              {(error || authError) && (
                <p className="inline-error" role="alert">
                  {error || authError}
                </p>
              )}
              <button
                type="submit"
                className="primary login-submit"
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <LockKeyhole size={17} />
                )}
                {busy ? "正在验证…" : "登录"}
              </button>
            </form>
          </>
        )}
        <CertificateHelp />
      </section>
    </main>
  );
}

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="login-settings">
      <p>已登录：{get().auth?.username}</p>
      <button
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await logout();
          } catch (failure) {
            setError(failure.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <LogOut size={16} />
        {busy ? "正在退出…" : "退出登录"}
      </button>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <CertificateHelp />
    </div>
  );
}
