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

const permissionModes = [
  "auto",
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "bypassPermissions",
];
function validatePermissionMode(mode) {
  if (!permissionModes.includes(mode)) throw Error("无效的 Claude 权限模式");
}

export class ClaudeSessions {
  constructor({
    home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
    stateFile = process.env.CLAUDE_WEB_STATE_FILE ||
      join(
        process.env.XDG_STATE_HOME || join(homedir(), ".local/state"),
        "codex-web/claude-sessions.json",
      ),
    executable = process.env.CLAUDE_BIN || join(homedir(), ".local/bin/claude"),
    defaultCwd = homedir(),
    launch = spawn,
    emit = () => {},
  } = {}) {
    Object.assign(this, {
      home,
      stateFile,
      executable,
      defaultCwd,
      launch,
      emit,
    });
    this.sessions = new Map();
    this.runtime = new Map();
    this.locks = new Map();
    this.saveChain = Promise.resolve();
    this.historyCache = new Map();
    this.initialized = this.load().catch((error) => {
      this.loadError = error;
    });
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.stateFile, "utf8"));
      for (const s of saved)
        if (sessionIdPattern.test(s.id)) this.sessions.set(s.id, s);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  async save() {
    const data = JSON.stringify(
      [...this.sessions.values()].filter((s) => s.managed),
      null,
      2,
    );
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.stateFile), { recursive: true, mode: 0o700 });
        const temp = this.stateFile + ".tmp";
        await writeFile(temp, data, { mode: 0o600 });
        await rename(temp, this.stateFile);
      });
    return this.saveChain;
  }
  async exclusive(id, fn) {
    const previous = this.locks.get(id) || Promise.resolve();
    const operation = previous.catch(() => {}).then(fn);
    this.locks.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.locks.get(id) === operation) this.locks.delete(id);
    }
  }
  async refresh() {
    await this.initialized;
    if (this.loadError)
      throw Error("无法读取 Claude 网页会话索引：" + this.loadError.message);
    if (!this.scan)
      this.scan = scanSessions(this.home)
        .then((all) => {
          for (const s of all)
            this.sessions.set(s.id, { ...this.sessions.get(s.id), ...s });
        })
        .finally(() => {
          this.scan = null;
        });
    await this.scan;
  }
  async list({ offset = 0, query = "" } = {}) {
    await this.refresh();
    const all = [...this.sessions.values()]
      .filter((s) =>
        (s.title + " " + s.cwd)
          .toLowerCase()
          .includes(String(query).toLowerCase()),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    offset = Math.max(0, Number(offset) || 0);
    return {
      sessions: await Promise.all(
        all.slice(offset, offset + 100).map((s) => this.summary(s)),
      ),
      next: offset + 100 < all.length ? offset + 100 : null,
      defaultCwd: this.defaultCwd,
    };
  }
  async require(id) {
    if (!sessionIdPattern.test(id || "")) throw Error("无效的 Claude 会话 ID");
    await this.initialized;
    if (this.loadError)
      throw Error("无法读取 Claude 网页会话索引：" + this.loadError.message);
    if (!this.sessions.has(id)) await this.refresh();
    const s = this.sessions.get(id);
    if (!s) throw Error("找不到这个 Claude 会话");
    return s;
  }
  async summary(s) {
    const r = this.runtime.get(s.id);
    const owner = await externalOwner(this.home, s.id, r?.child?.pid);
    return {
      id: s.id,
      title: s.title,
      cwd: s.cwd,
      updatedAt: s.updatedAt,
      model: s.model || "",
      effort: s.effort || "",
      permissionMode: r?.shared
        ? r.permissionMode || ""
        : s.permissionMode || "auto",
      actualModel: s.actualModel || "",
      actualEffort: s.actualEffort || "",
      shared: !!r?.shared,
      managed: !!s.managed,
      status: owner ? "external" : r?.status || "idle",
      owner,
      error: r?.error || "",
      connected: !!r?.child,
    };
  }
  async status(id) {
    const s = await this.require(id);
    await this.exclusive(id, async () => {
      if (!this.runtime.get(id)?.child) {
        const bridge = await findSharedBridge(this.home, id);
        if (bridge) await this.attach(s, bridge);
      }
    });
    const r = this.runtime.get(id);
    if (r?.child && r.status === "idle") await this.readSettings(id);
    return {
      session: await this.summary(s),
      messages: mergeClaudeMessages([], [...(r?.messages.values() || [])]),
      permissions: [...(r?.permissions.values() || [])],
      removed: [...(r?.removed || [])],
    };
  }
  async attach(s, bridge) {
    const queued = [];
    let attached = false;
    const { child, snapshot } = await connectSharedBridge(bridge, (m) => {
      if (attached) this.event(s.id, m);
      else queued.push(m);
    });
    const r = {
      child,
      shared: true,
      permissionMode: snapshot.permissionMode || "",
      status: snapshot.status,
      messages: new Map(snapshot.messages.map((m) => [m.id, m])),
      permissions: new Map(snapshot.permissions.map((p) => [p.id, p])),
      removed: new Set(),
      controls: new Map(),
      outstanding: new Set(),
      error: "",
      stderr: "",
      timer: null,
    };
    r.partial = snapshot.messages.find((m) => m.partial) || null;
    this.runtime.set(s.id, r);
    child.on("bridgeError", (e) => this.fail(s.id, e.message));
    child.once("close", () => {
      if (this.runtime.get(s.id) !== r) return;
      r.child = null;
      r.status = "error";
      r.error = "插件共享连接已断开，请重试";
      r.permissions.clear();
      for (const c of r.controls.values()) {
        clearTimeout(c.timer);
        c.reject(Error(r.error));
      }
      r.controls.clear();
      this.notify(s.id, true);
    });
    attached = true;
    for (const m of queued) this.event(s.id, m);
    return r;
  }
  async open(id, offset = 0) {
    let connectionError = "";
    try {
      await this.status(id);
    } catch (e) {
      connectionError = e.message;
    }
    const s = await this.require(id),
      r = this.runtime.get(id);
    // Resume discovers CLI transcript names even for newly created sessions.
    if (!s.path) await this.refresh();
    const current = this.sessions.get(id);
    let history = [];
    if (current.path) {
      const info = await stat(current.path);
      let cached = this.historyCache.get(current.path);
      if (
        !cached ||
        cached.modified !== info.mtimeMs ||
        cached.size !== info.size
      ) {
        cached = {
          modified: info.mtimeMs,
          size: info.size,
          messages: await readTranscript(current.path),
        };
        this.historyCache.delete(current.path);
        this.historyCache.set(current.path, cached);
        if (this.historyCache.size > 10)
          this.historyCache.delete(this.historyCache.keys().next().value);
      }
      history = cached.messages;
    }
    const messages = mergeClaudeMessages(history, [
      ...(r?.messages.values() || []),
    ]);
    if (r)
      for (const message of messages) {
        if (r.messages.has(message.id)) r.messages.set(message.id, message);
      }
    offset = Math.max(0, Number(offset) || 0);
    return {
      session: {
        ...(await this.summary(current)),
        ...(connectionError ? { error: connectionError } : {}),
      },
      messages: messages.slice(offset, offset + 100),
      next: offset + 100 < messages.length ? offset + 100 : null,
      permissions: [...(r?.permissions.values() || [])],
    };
  }
  async create({ cwd, model = "", effort = "", permissionMode = "auto" } = {}) {
    await this.initialized;
    if (this.loadError)
      throw Error("无法读取 Claude 网页会话索引：" + this.loadError.message);
    cwd = cwd || this.defaultCwd;
    if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory())
      throw Error("请选择有效的绝对工作目录");
    if (typeof model !== "string" || model.length > 200)
      throw Error("无效的模型名称");
    this.validateSettings(model, effort);
    validatePermissionMode(permissionMode);
    const s = {
      id: randomUUID(),
      cwd,
      model,
      effort,
      permissionMode,
      title: "新 Claude 对话",
      updatedAt: Date.now(),
      managed: true,
    };
    this.sessions.set(s.id, s);
    await this.save();
    this.emit({ method: "claude/listChanged" });
    return { session: await this.summary(s) };
  }
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
  fail(id, message) {
    const r = this.runtime.get(id);
    if (!r) return;
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
      if (m.request?.subtype === "can_use_tool")
        r.permissions.set(m.request_id, {
          id: m.request_id,
          tool: m.request.tool_name,
          input: m.request.input,
        });
      else
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
  async readSettings(id) {
    const result = await this.control(id, { subtype: "get_settings" });
    const s = this.sessions.get(id);
    if (result?.applied) {
      s.actualModel = result.applied.model || "";
      s.actualEffort = result.applied.effort || "";
    }
  }
  validateSettings(model, effort) {
    if (typeof model !== "string" || model.length > 200)
      throw Error("无效的模型名称");
    if (!["", "low", "medium", "high", "xhigh"].includes(effort))
      throw Error("无效的思考强度");
  }
  async configure({ id, model = "", effort = "", permissionMode }) {
    if (permissionMode) validatePermissionMode(permissionMode);
    this.validateSettings(model, effort);
    return this.exclusive(id, async () => {
      const s = await this.require(id);
      const r = await this.start(s);
      if (["running", "starting"].includes(r.status) || r.permissions.size)
        throw Error("请等待当前任务完成后修改模型和思考强度");
      {
        await this.control(id, { subtype: "set_model", model: model || null });
        s.model = model;
      }
      try {
        if (permissionMode) {
          const applied = await this.control(id, {
            subtype: "set_permission_mode",
            mode: permissionMode,
          });
          const mode = applied?.mode || permissionMode;
          validatePermissionMode(mode);
          s.permissionMode = mode;
          r.permissionMode = mode;
        }
        {
          await this.control(id, {
            subtype: "apply_flag_settings",
            settings: { effortLevel: effort || null },
          });
          s.effort = effort;
        }
      } finally {
        s.managed = true;
        await this.save();
        this.notify(id, true);
      }
      await this.readSettings(id);
      return { session: await this.summary(s) };
    });
  }
  async interrupt(id) {
    await this.require(id);
    const r = this.runtime.get(id);
    if (!r?.child) throw Error("此会话不由网页运行，不能停止其他客户端的任务");
    await this.control(id, { subtype: "interrupt" });
    return { accepted: true };
  }
  async answer({ id, requestId, allow, answers }) {
    const r = this.runtime.get(id),
      permission = r?.permissions.get(requestId);
    if (!permission) throw Error("授权请求已结束，请刷新会话");
    const updatedInput = { ...permission.input };
    if (permission.tool === "AskUserQuestion" && allow) {
      if (!answers || typeof answers !== "object" || Array.isArray(answers))
        throw Error("请填写问题答案");
      updatedInput.answers = answers;
    }
    this.write(r, {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: allow
          ? { behavior: "allow", updatedInput }
          : { behavior: "deny", message: "用户在网页中拒绝了该操作" },
      },
    });
    r.permissions.delete(requestId);
    this.notify(id, true);
    return { accepted: true };
  }
  async release(id) {
    return this.exclusive(id, async () => {
      await this.require(id);
      const r = this.runtime.get(id);
      if (!r?.child) return {};
      if (["running", "starting"].includes(r.status) || r.permissions.size)
        throw Error("请先停止或等待当前任务完成");
      const child = r.child;
      r.status = "released";
      child.stdin.end();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Claude 尚未退出，请稍后重试")),
          10000,
        );
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.runtime.delete(id);
      this.emit({ method: "claude/listChanged" });
      return {};
    });
  }
  get busy() {
    return [...this.runtime.values()].some(
      (r) => ["starting", "running"].includes(r.status) || r.permissions.size,
    );
  }
  close() {
    for (const r of this.runtime.values()) {
      clearTimeout(r.timer);
      r.child?.kill("SIGTERM");
    }
  }
}
