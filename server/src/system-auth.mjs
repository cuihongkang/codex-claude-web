import { spawn } from "node:child_process";
import { userInfo } from "node:os";

export function authenticateSystemUser(username, password, config) {
  const account = userInfo();
  if (
    username !== account.username ||
    /(?:^|\/)(?:nologin|false)$/.test(account.shell || "") ||
    !password ||
    /[\r\n\0]/.test(password)
  )
    return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.pamtesterPath,
      [
        config.pamService,
        username,
        "authenticate(PAM_SILENT|PAM_DISALLOW_NULL_AUTHTOK)",
        "acct_mgmt(PAM_SILENT)",
      ],
      {
        stdio: ["pipe", "ignore", "ignore"],
        detached: true,
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8" },
      },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    const unavailable = () =>
      reject(
        new Error("登录暂不可用，请稍后重试或联系管理员。", { cause: 503 }),
      );
    child.once("error", () => {
      clearTimeout(timer);
      unavailable();
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (signal || code === null) unavailable();
      else resolve(code === 0);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(password + "\n");
  });
}
