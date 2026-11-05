import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  writeFile,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import {
  externalOwner,
  readTranscript,
  scanSessions,
  sessionIdPattern,
  transcriptMessage,
} from "./claude-history.mjs";

import {
  findSharedBridge,
  connectSharedBridge,
} from "./claude-shared-client.mjs";

import { mergeClaudeMessages } from "./claude-timeline.mjs";

export class ClaudeRuntime {
  notify(id, immediate = false) {
    const r = this.runtime.get(id);
    if (!r) return;
    if (r.timer) {
      if (!immediate) return;
      clearTimeout(r.timer);
    }
    const publish = () => {
      r.timer = null;
      this.summary(this.sessions.get(id))
        .then((session) =>
          this.emit({
            method: "claude/session",
            params: {
              session,
              messages: mergeClaudeMessages([], [...r.messages.values()]),
              permissions: [...r.permissions.values()],
              removed: [...r.removed],
            },
          }),
        )
        .catch((e) => console.error("Claude state:", e.message));
    };
    if (immediate) publish();
    else r.timer = setTimeout(publish, 100);
  }
  async start(s) {
    let r = this.runtime.get(s.id);
    if (r?.child) return r;
    const bridge = await findSharedBridge(this.home, s.id);
    if (bridge) return this.attach(s, bridge);
    const owner = await externalOwner(this.home, s.id);
    if (owner)
      throw Error(
        "会话仍由 VS Code 或其他 Claude 进程持有。请结束任务并关闭原会话，再重试。",
      );
    await access(this.executable);
    await this.refresh();
    s = this.sessions.get(s.id);
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--replay-user-messages",
      "--permission-prompt-tool=stdio",
      "--permission-mode",
      (s.permissionMode || "auto") === "default"
        ? "manual"
        : s.permissionMode || "auto",
    ];
    args.push(s.path ? "--resume" : "--session-id", s.id);
    if (s.model) args.push("--model", s.model);
    if (s.effort) args.push("--effort", s.effort);
    const child = this.launch(this.executable, args, {
      cwd: s.cwd,
      env: { ...process.env, CLAUDE_CONFIG_DIR: this.home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    r = {
      child,
      status: "starting",
      messages: new Map(),
      permissions: new Map(),
      removed: new Set(),
      controls: new Map(),
      outstanding: new Set(),
      error: "",
      stderr: "",
      timer: null,
    };
    this.runtime.set(s.id, r);
    child.stderr.on("data", (data) => {
      r.stderr = (r.stderr + data.toString()).slice(-4000);
    });
    child.stdin.on("error", () => {});
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      try {
        this.event(s.id, JSON.parse(line));
      } catch (e) {
        if (!(e instanceof SyntaxError)) this.fail(s.id, e.message);
      }
    });
    child.once("error", (e) => this.fail(s.id, e.message));
    child.once("close", (code, signal) => {
      if (this.runtime.get(s.id) !== r) return;
      r.child = null;
      r.permissions.clear();
      for (const c of r.controls.values()) {
        clearTimeout(c.timer);
        c.reject(Error("Claude 进程已退出"));
      }
      r.controls.clear();
      if (r.status !== "idle" && r.status !== "released") {
        if (r.status !== "error") this.activity(s.id, "failed");
        r.status = "error";
        r.error =
          r.error ||
          `Claude 进程已退出 (${signal || code})。${r.stderr.slice(-700)}`;
      }
      this.notify(s.id, true);
    });
    try {
      await this.control(s.id, { subtype: "initialize" });
    } catch (error) {
      child.kill("SIGTERM");
      this.fail(s.id, error.message);
      throw error;
    }
    r.status = "idle";
    return r;
  }
  write(r, message) {
    if (!r?.child || r.child.stdin.destroyed || r.child.stdin.writableEnded)
      throw Error("Claude 连接已关闭，请重试");
    r.child.stdin.write(JSON.stringify(message) + "\n");
  }
  control(id, request) {
    const r = this.runtime.get(id),
      requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        r.controls.delete(requestId);
        reject(Error("Claude 控制请求超时"));
      }, 60000);
      r.controls.set(requestId, { resolve, reject, timer });
      try {
        this.write(r, {
          type: "control_request",
          request_id: requestId,
          request,
        });
      } catch (e) {
        clearTimeout(timer);
        r.controls.delete(requestId);
        reject(e);
      }
    });
  }
  activity(id, kind, eventId = randomUUID()) {
    this.emit({
      method: "claude/activity",
      params: {
        threadId: id,
        kind,
        id: eventId,
        title: this.sessions.get(id)?.title || "Claude 对话",
      },
    });
  }
  fail(id, message) {
    const r = this.runtime.get(id);
    if (!r) return;
    if (r.status !== "error") this.activity(id, "failed");
    r.status = "error";
    r.error = message;
    this.notify(id, true);
  }
  event(id, m) {
    const r = this.runtime.get(id);
    if (!r) return;
    if (m.type === "web_permission_mode") {
      r.permissionMode = m.mode;
      this.notify(id, true);
      return;
    }
    if (m.type === "control_response") {
      const c = r.controls.get(m.response?.request_id);
      if (c) {
        clearTimeout(c.timer);
        r.controls.delete(m.response.request_id);
        m.response.subtype === "success"
          ? c.resolve(m.response.response)
          : c.reject(Error(m.response.error || "Claude 控制请求失败"));
      }
      return;
    }
    if (m.type === "control_request") {
      if (m.request?.subtype === "can_use_tool") {
        this.activity(id, "attention", m.request_id);
        r.permissions.set(m.request_id, {
          id: m.request_id,
          tool: m.request.tool_name,
          input: m.request.input,
        });
      } else
        this.write(r, {
          type: "control_response",
          response: {
            subtype: "error",
            request_id: m.request_id,
            error: "Unsupported control request",
          },
        });
      this.notify(id, true);
      return;
    }
    if (m.type === "control_cancel_request") {
      r.permissions.delete(m.request_id);
      this.notify(id, true);
      return;
    }
    if (r.shared && (m.type === "user" || m.type === "stream_event"))
      r.status = "running";
    if (m.type === "stream_event") {
      const e = m.event;
      if (e.type === "message_start") {
        r.partial = {
          id: "partial:" + e.message.id,
          role: "assistant",
          content: [],
          partial: true,
        };
        r.messages.set(r.partial.id, r.partial);
      }
      if (e.type === "content_block_start" && r.partial)
        r.partial.content[e.index] = { ...e.content_block };
      if (e.type === "content_block_delta" && r.partial) {
        const block = r.partial.content[e.index];
        if (block && e.delta.type === "text_delta")
          block.text = (block.text || "") + e.delta.text;
        if (block && e.delta.type === "thinking_delta")
          block.thinking = (block.thinking || "") + e.delta.thinking;
      }
      this.notify(id);
      return;
    }
    const message = transcriptMessage(m);
    if (message?.id) {
      if (m.type === "assistant" && r.partial) {
        r.messages.delete(r.partial.id);
        r.removed.add(r.partial.id);
        r.partial = null;
      }
      if (m.type === "user") r.interrupted = false;
      r.messages.set(
        message.id,
        mergeClaudeMessages(
          r.messages.has(message.id) ? [r.messages.get(message.id)] : [],
          [message],
        )[0],
      );
      if (m.type === "user") r.outstanding.delete(message.id);
      this.notify(id);
    }
    if (m.type === "result") {
      if (!r.interrupted)
        this.activity(
          id,
          m.is_error ? "failed" : "completed",
          m.uuid || m.request_id || randomUUID(),
        );
      r.interrupted = false;
      r.status = m.is_error ? "error" : "idle";
      r.error = m.is_error
        ? m.result || m.errors?.join("\n") || "Claude 请求失败"
        : "";
      r.permissions.clear();
      const s = this.sessions.get(id);
      s.updatedAt = Date.now();
      this.save().catch((e) => this.fail(id, e.message));
      this.notify(id, true);
      this.emit({ method: "claude/listChanged" });
    }
  }
  async send({ id, text, messageId }) {
    if (typeof text !== "string" || !text.trim() || text.length > 200000)
      throw Error("请输入消息（最多 200000 字符）");
    if (!sessionIdPattern.test(messageId || "")) throw Error("无效的消息 ID");
    return this.exclusive(id, async () => {
      const s = await this.require(id);
      const r = await this.start(s);
      if (r.messages.has(messageId)) return { accepted: true };
      if (await externalOwner(this.home, id, r.child?.pid))
        throw Error("另一个 Claude 进程正在持有该会话，请先关闭原会话。");
      this.write(r, {
        type: "user",
        uuid: messageId,
        session_id: id,
        parent_tool_use_id: null,
        message: { role: "user", content: text },
      });
      r.messages.set(messageId, {
        id: messageId,
        role: "user",
        content: [{ type: "text", text }],
        timestamp: new Date().toISOString(),
      });
      r.outstanding.add(messageId);
      r.status = "running";
      r.error = "";
      if (s.title === "新 Claude 对话") s.title = text.slice(0, 100);
      s.updatedAt = Date.now();
      s.managed = true;
      await this.save();
      this.notify(id, true);
      this.emit({ method: "claude/listChanged" });
      return { accepted: true };
    });
  }
}
