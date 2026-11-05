import { ClaudeRuntime } from "./claude-runtime.mjs";
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

export class ClaudeSessions extends ClaudeRuntime {
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
    super();
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
    r.interrupted = true;
    try {
      await this.control(id, { subtype: "interrupt" });
    } catch (error) {
      r.interrupted = false;
      throw error;
    }
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
