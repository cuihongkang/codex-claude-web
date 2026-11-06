import { ExecutionError } from "../features/conversation/execution-error.jsx";
import React, { lazy, Suspense, useEffect } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { useStore, get, set, setReadingThread, newChat } from "../store.js";
import { Conversation } from "../features/conversation/conversation.jsx";
import { Composer } from "../features/composer/composer.jsx";
import { ContextWorkspace } from "../features/workspace/context-panel.jsx";
import { Sidebar } from "./sidebar.jsx";
import { Header } from "./header.jsx";
import { Modal } from "./modal.jsx";
const TerminalPanel = lazy(() =>
  import("../features/workspace/terminal-panel.jsx").then((module) => ({
    default: module.TerminalPanel,
  })),
);

export function App() {
  const s = useStore();
  const readingId =
    !s.loading && s.threadAccess?.status !== "loadError" ? s.current?.id : null;
  useEffect(() => {
    const read = () =>
      setReadingThread(
        document.visibilityState === "hidden" ? null : readingId,
      );
    read();
    document.addEventListener("visibilitychange", read);
    return () => {
      document.removeEventListener("visibilitychange", read);
      setReadingThread(null);
    };
  }, [readingId]);
  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
  }, [s.theme]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") {
        if (
          !get().modal &&
          document.querySelector('.context-tools button[aria-expanded="true"]')
        ) {
          set({ contextOpen: false });
          document
            .querySelector(
              '.context-tools button[aria-controls="conversation-context"]',
            )
            ?.focus();
        }
        set({ modal: null, sidebar: false });
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        set({ modal: { type: "search" } });
      }
      if (e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        newChat();
      }
      if (e.key === "`") {
        e.preventDefault();
        set({ terminalOpen: !get().terminalOpen });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-shell">
        <Header />
        {!s.connected && (
          <div className="connection-banner">
            <LoaderCircle size={14} className="spin" />
            正在连接…
          </div>
        )}
        <div className="workspace">
          <section className="chat-pane">
            <Conversation
              footer={
                <div className="conversation-footer" key="composer">
                  <ExecutionError />
                  <Composer />
                </div>
              }
            >
              <ContextWorkspace />
            </Conversation>
          </section>
        </div>
        {s.terminalOpen && (
          <Suspense fallback={<div className="loading">正在打开终端…</div>}>
            <TerminalPanel key={s.backendId || "codex"} />
          </Suspense>
        )}
      </main>
      <Modal />
      {s.notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {s.notice}
        </div>
      )}
    </div>
  );
}
export class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h2>页面遇到错误</h2>
        <button onClick={() => location.reload()}>重新载入</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
