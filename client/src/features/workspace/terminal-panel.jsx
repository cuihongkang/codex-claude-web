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
  basename,
  b64encode,
  uid,
  onEvent,
} from "../../store.js";
import { IconButton } from "../../ui/primitives.jsx";
export function TerminalPanel() {
  const s = useStore(),
    host = useRef(),
    term = useRef(),
    fit = useRef(),
    pid = useRef(localStorage.getItem("cx-terminal")),
    observer = useRef();
  const [connected, connectedSet] = useState(false),
    [sessionName, setSessionName] = useState("zsh");
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
        m.method === "command/exec/outputDelta" &&
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
        connectedSet(m.params.terminals[pid.current].running);
      }
    });
    t.onData((data) => {
      if (pid.current)
        rpc("command/exec/write", {
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
        rpc("command/exec/resize", {
          processId: pid.current,
          size: { cols: t.cols, rows: t.rows },
        }).catch(() => {});
    });
    observer.current.observe(host.current);
    const existing = get().terminals?.[pid.current];
    if (existing?.running) {
      t.write(existing.buffer || "");
      connectedSet(existing.running);
    } else spawn(t, f);
    return () => {
      stop();
      observer.current.disconnect();
      t.dispose();
    };
  }, []);
  function spawn(t = term.current, f = fit.current) {
    pid.current = "terminal-" + uid();
    const sessionId = pid.current;
    localStorage.setItem("cx-terminal", pid.current);
    t.reset();
    f.fit();
    connectedSet(true);
    setSessionName(basename(get().cwd) + " — zsh");
    rpc(
      "command/exec",
      {
        command: ["/usr/bin/zsh", "-l"],
        env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
        cwd: get().cwd,
        processId: pid.current,
        tty: true,
        size: { cols: t.cols, rows: t.rows },
        disableTimeout: true,
        disableOutputCap: true,
      },
      0,
    )
      .then(() => {
        if (pid.current === sessionId) connectedSet(false);
      })
      .catch((e) => {
        if (pid.current !== sessionId) return;
        connectedSet(false);
        t.write("\r\n" + e.message + "\r\n");
      });
  }
  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span>
          <TerminalSquare size={14} />
          终端 <small>{sessionName}</small>
        </span>
        <div>
          <IconButton
            icon={Plus}
            title="重新启动终端"
            onClick={() => {
              if (connected)
                rpc("command/exec/terminate", { processId: pid.current }).catch(
                  report,
                );
              spawn();
            }}
          />
          <IconButton
            icon={Trash2}
            title="结束终端进程"
            onClick={() =>
              rpc("command/exec/terminate", { processId: pid.current }).catch(
                report,
              )
            }
          />
          <IconButton
            icon={X}
            title="隐藏终端"
            onClick={() => set({ terminalOpen: false })}
          />
        </div>
      </div>
      <div ref={host} className="terminal-view" />
    </div>
  );
}
