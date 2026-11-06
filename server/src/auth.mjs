import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { userInfo } from "node:os";
import { authenticateSystemUser } from "./system-auth.mjs";

const cookieName = "__Host-codex-web-session";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const cookie = (value, seconds) =>
  `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
export function isLoopback(address) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}
function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}
async function credentials(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] || ""))
    throw new Error("请使用 JSON 提交登录信息。", { cause: 415 });
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 8192) throw new Error("登录信息过长。", { cause: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("登录信息格式错误。", { cause: 400 });
  }
}
export async function createAuthentication(config) {
  const directory = join(config.configDir, "auth");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "sessions.json");
  const username = userInfo().username;
  let entries = [];
  try {
    entries = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const sessions = new Map(
    entries.filter(
      ([, s]) => s.username === username && s.expiresAt > Date.now(),
    ),
  );
  const sockets = new Map();
  const responses = new Map();
  let writing = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify([...sessions]);
    const result = writing
      .catch(() => {})
      .then(async () => {
        await writeFile(path + ".tmp", snapshot, { mode: 0o600 });
        await rename(path + ".tmp", path);
      });
    writing = result;
    return result;
  };
  const secretPath = join(directory, "maintenance-token");
  let maintenanceToken;
  try {
    maintenanceToken = await readFile(secretPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    maintenanceToken = randomBytes(32).toString("hex");
    await writeFile(secretPath, maintenanceToken, { mode: 0o600, flag: "wx" });
  }
  const revoke = (id) => {
    sessions.delete(id);
    for (const socket of sockets.get(id) || [])
      socket.close(4401, "登录已失效，请重新登录");
    sockets.delete(id);
    for (const response of responses.get(id) || []) response.destroy();
    responses.delete(id);
  };
  const valid = (id) => {
    const session = sessions.get(id);
    if (!session || session.expiresAt <= Date.now()) {
      revoke(id);
      return null;
    }
    return session;
  };
  const sessionId = (request) => {
    const tokens = (request.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.startsWith(cookieName + "="));
    if (tokens.length !== 1) return null;
    const token = tokens[0].slice(cookieName.length + 1);
    return /^[a-zA-Z0-9_-]{43}$/.test(token) ? digest(token) : null;
  };
  const sameOrigin = (request) => {
    const origin = request.headers.origin;
    return (
      request.headers["sec-fetch-site"] !== "cross-site" &&
      origin === `https://${request.headers.host}`
    );
  };
  const attempts = new Map();
  let active = 0,
    globalAttempts = [];
  function limited(address) {
    const now = Date.now();
    for (const [ip, record] of attempts)
      if (record.until <= now) attempts.delete(ip);
    globalAttempts = globalAttempts.filter((time) => time > now - 60000);
    const record = attempts.get(address) || {
      count: 0,
      until: now + 15 * 60000,
    };
    if (
      active >= 2 ||
      record.count >= 10 ||
      globalAttempts.length >= 30 ||
      attempts.size >= 1024
    )
      return true;
    record.count++;
    attempts.set(address, record);
    globalAttempts.push(now);
    return false;
  }
  return {
    sameOrigin,
    valid,
    sessionId,
    authorize(request, response) {
      const id = sessionId(request);
      const session = valid(id);
      if (!session) {
        json(response, 401, { error: "请先登录。" });
        return false;
      }
      if (
        ((request.headers.origin ||
          !["GET", "HEAD"].includes(request.method)) &&
          !sameOrigin(request)) ||
        request.headers["sec-fetch-site"] === "cross-site"
      ) {
        json(response, 403, { error: "请求来源不匹配。" });
        return false;
      }
      if (!responses.has(id)) responses.set(id, new Set());
      responses.get(id).add(response);
      let timer;
      const expire = () => {
        if (!valid(id)) return;
        timer = setTimeout(
          expire,
          Math.min(session.expiresAt - Date.now(), 2147483647),
        );
        timer.unref();
      };
      expire();
      response.once("close", () => {
        clearTimeout(timer);
        responses.get(id)?.delete(response);
        if (!responses.get(id)?.size) responses.delete(id);
      });
      return true;
    },
    maintenance(request) {
      const supplied = Buffer.from(request.headers.authorization || "");
      const expected = Buffer.from(`Bearer ${maintenanceToken}`);
      return (
        !request.headers.origin &&
        isLoopback(request.socket.remoteAddress) &&
        supplied.length === expected.length &&
        timingSafeEqual(supplied, expected)
      );
    },
    attach(socket, id) {
      const session = valid(id);
      if (!session) {
        socket.close(4401, "登录已失效，请重新登录");
        return;
      }
      socket.authSessionId = id;
      if (!sockets.has(id)) sockets.set(id, new Set());
      sockets.get(id).add(socket);
      let timer;
      const expire = () => {
        if (!valid(id)) return;
        timer = setTimeout(
          expire,
          Math.min(session.expiresAt - Date.now(), 2147483647),
        );
        timer.unref();
      };
      expire();
      socket.once("close", () => {
        clearTimeout(timer);
        sockets.get(id)?.delete(socket);
      });
    },
    async handle(request, response, route) {
      if (!route.startsWith("/api/auth/")) return false;
      try {
        const id = sessionId(request);
        if (route === "/api/auth/session" && request.method === "GET") {
          const session = valid(id);
          json(
            response,
            200,
            session
              ? { authenticated: true, ...session }
              : { authenticated: false },
          );
          return true;
        }
        if (
          !["/api/auth/login", "/api/auth/logout"].includes(route) ||
          request.method !== "POST"
        ) {
          json(response, 405, { error: "不支持此登录操作。" });
          return true;
        }
        if (
          !sameOrigin(request) ||
          request.headers["x-codex-web-request"] !== "1"
        ) {
          json(response, 403, { error: "请求来源不匹配，请重新打开本站。" });
          return true;
        }
        if (route === "/api/auth/logout") {
          revoke(id);
          await persist();
          json(
            response,
            200,
            { authenticated: false },
            { "Set-Cookie": cookie("", 0) },
          );
          return true;
        }
        if (limited(request.socket.remoteAddress)) {
          json(
            response,
            429,
            { error: "登录尝试过于频繁，请稍后重试。" },
            { "Retry-After": "900" },
          );
          return true;
        }
        active++;
        try {
          const input = await credentials(request);
          const { username: submitted, password } = input || {};
          if (
            typeof submitted !== "string" ||
            typeof password !== "string" ||
            !submitted ||
            !password ||
            submitted.length > 256 ||
            password.length > 1024 ||
            /\0/.test(submitted + password)
          ) {
            json(response, 400, { error: "请输入有效的系统用户名和密码。" });
            return true;
          }
          if (
            submitted !== username ||
            !(await authenticateSystemUser(submitted, password, config))
          ) {
            json(response, 401, {
              error:
                "用户名或密码错误，或系统账户不可用。请使用运行服务的系统账户。",
            });
            return true;
          }
          for (const [key, session] of sessions)
            if (session.expiresAt <= Date.now()) revoke(key);
          if (sessions.size >= 64) revoke(sessions.keys().next().value);
          revoke(id);
          const token = randomBytes(32).toString("base64url");
          const session = {
            username,
            expiresAt: Date.now() + config.sessionDays * 86400000,
          };
          const key = digest(token);
          sessions.set(key, session);
          try {
            await persist();
          } catch (error) {
            revoke(key);
            throw error;
          }
          json(
            response,
            200,
            { authenticated: true, ...session },
            { "Set-Cookie": cookie(token, config.sessionDays * 86400) },
          );
        } finally {
          active--;
        }
      } catch (error) {
        request.resume();
        if (!response.headersSent && !response.destroyed)
          json(response, typeof error.cause === "number" ? error.cause : 503, {
            error:
              typeof error.cause === "number"
                ? error.message
                : "登录暂不可用，请稍后重试或联系管理员。",
          });
      }
      return true;
    },
  };
}
