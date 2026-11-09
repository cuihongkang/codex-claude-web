import { TerminalFrame } from "./terminal-frame.jsx";
import {
  terminalWorkspace,
  terminalSelectionKey,
  workspaceTerminalIds,
} from "../../../../shared/terminal-workspace.mjs";
import { TerminalList } from "./terminal-list.jsx";
import React, { useState, useEffect, useRef } from "react";

import { X, Plus, TerminalSquare, Trash2 } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  useStore,
  get,
  set,
  rpc,
  report,
  b64encode,
  uid,
  onEvent,
} from "../../store.js";
import { IconButton } from "../../ui/primitives.jsx";
function TerminalSession({ processId, active, cwd }) {
  const host = useRef(),
    term = useRef(),
    fit = useRef(),
    pid = useRef(processId),
    observer = useRef();
  useEffect(() => {
    const typography = () => {
      const style = getComputedStyle(host.current);
      const fontSize = parseFloat(style.fontSize);
      return { fontSize, lineHeight: parseFloat(style.lineHeight) / fontSize };
    };
    const t = new Terminal({
      ...typography(),
      fontFamily: '"JetBrains Mono",Consolas,monospace',
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: "#ffffff",
        foreground: "#252523",
        cursor: "#252523",
        cursorAccent: "#ffffff",
        selectionBackground: "#c9ddf5",
        black: "#252523",
        red: "#b42318",
        green: "#28713e",
        yellow: "#876300",
        blue: "#205caa",
        magenta: "#8b3e96",
        cyan: "#087d8b",
        white: "#6b6b67",
        brightBlack: "#666660",
        brightRed: "#d12f23",
        brightGreen: "#27803e",
        brightYellow: "#916500",
        brightBlue: "#2769c2",
        brightMagenta: "#a546b0",
        brightCyan: "#098392",
        brightWhite: "#777772",
      },
      scrollback: 5000,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current);
    f.fit();
    term.current = t;
    fit.current = f;
    const stop = onEvent((m) => {
      if (
        m.method === "lan/terminalOutput" &&
        m.params.processId === pid.current
      )
        t.write(
          Uint8Array.from(atob(m.params.deltaBase64), (c) => c.charCodeAt(0)),
        );
      if (
        m.method === "lan/state" &&
        pid.current &&
        m.params.terminals?.[pid.current]
      ) {
        t.reset();
        t.write(m.params.terminals[pid.current].buffer || "");
      }
    });
    t.onData((data) => {
      if (pid.current)
        rpc("lan/terminal/write", {
          processId: pid.current,
          deltaBase64: b64encode(data),
        }).catch(report);
    });
    observer.current = new ResizeObserver(() => {
      const { fontSize, lineHeight } = typography();
      if (t.options.fontSize !== fontSize) t.options.fontSize = fontSize;
      if (t.options.lineHeight !== lineHeight)
        t.options.lineHeight = lineHeight;
      f.fit();
      if (pid.current)
        rpc("lan/terminal/resize", {
          processId: pid.current,
          size: { cols: t.cols, rows: t.rows },
        }).catch(() => {});
    });
    observer.current.observe(host.current);
    const existing = get().terminals?.[pid.current];
    if (existing?.running) {
      t.write(existing.buffer || "");
    } else spawn(t, f);
    return () => {
      stop();
      observer.current.disconnect();
      t.dispose();
    };
  }, []);
  function spawn(t, f) {
    f.fit();
    rpc("lan/terminal/create", {
      cwd,
      processId: pid.current,
      size: { cols: t.cols, rows: t.rows },
    }).catch((error) => t.write("\r\n" + error.message + "\r\n"));
  }
  useEffect(() => {
    if (active) {
      fit.current?.fit();
      term.current?.focus();
    }
  }, [active]);
  return <div hidden={!active} ref={host} className="terminal-view" />;
}

export function TerminalPanel() {
  const s = useStore();
  const cwd = terminalWorkspace(s.cwd);
  if (!s.terminalOpen) return null;
  return <FolderTerminals key={cwd} cwd={cwd} />;
}

function FolderTerminals({ cwd }) {
  const s = useStore();
  const [sessions, setSessions] = useState(() => {
    const running = workspaceTerminalIds(get().terminals || {}, cwd);
    return running.length ? running : [newId()];
  });
  const [selected, select] = useState(() => {
    const saved =
      localStorage.getItem(terminalSelectionKey(cwd)) ||
      localStorage.getItem("cx-terminal");
    return sessions.includes(saved) ? saved : sessions[0];
  });
  const ids = sessions.filter((id) => s.terminals[id]?.running !== false);
  const active = ids.includes(selected) ? selected : ids.at(-1);
  useEffect(() => {
    if (!ids.length) set({ terminalOpen: false });
  }, [ids.length]);
  useEffect(() => {
    if (active) {
      localStorage.setItem(terminalSelectionKey(cwd), active);
      localStorage.setItem("cx-terminal", active);
    }
  }, [active, cwd]);
  function newId() {
    return "web-terminal-" + uid();
  }
  function terminate(id) {
    return rpc("lan/terminal/terminate", { processId: id }).catch(report);
  }
  return (
    <TerminalFrame>
      <div className="terminal-header">
        <span>
          <TerminalSquare size={14} />
          终端
        </span>
        <div>
          <IconButton
            icon={Plus}
            title="新建终端"
            onClick={() => {
              const id = newId();
              setSessions([...ids, id]);
              select(id);
            }}
          />
          <IconButton
            icon={Trash2}
            title="结束终端进程"
            onClick={() => terminate(active)}
          />
          <IconButton
            icon={X}
            title="隐藏终端"
            onClick={() => set({ terminalOpen: false })}
          />
        </div>
      </div>
      <div className="terminal-body">
        <div className="terminal-sessions">
          {ids.map((id) => (
            <TerminalSession
              key={id}
              processId={id}
              active={id === active}
              cwd={cwd}
            />
          ))}
        </div>
        {ids.length > 1 && (
          <TerminalList
            ids={ids}
            terminals={s.terminals}
            active={active}
            select={select}
            terminate={terminate}
          />
        )}
      </div>
    </TerminalFrame>
  );
}
