import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { copyFile, chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import WebSocket from "ws";

// 独立后端只读取认证副本，工具配置与测试记录均留在临时目录。
export async function isolatedCodex(home, extraConfig = "") {
  await copyFile(
    join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"),
    join(home, "auth.json"),
  );
  await chmod(join(home, "auth.json"), 0o600);
  await writeFile(
    join(home, "config.toml"),
    'model = "gpt-6-luna"\nthread_unload_delay_secs = 0\nweb_search = "disabled"\n[features]\napps = false\nplugins = false\nremote_plugin = false\nhooks = false\nmemories = false\nmulti_agent = false\n' +
      extraConfig,
  );
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const url = "ws://127.0.0.1:" + port;
  const child = spawn("codex", ["app-server", "--listen", url], {
    cwd: home,
    env: { ...process.env, CODEX_HOME: home },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.resume();
  const exit = once(child, "exit");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("隔离 Codex 后端启动失败");
    const connected = await new Promise((resolve) => {
      const socket = new WebSocket(url);
      socket.once("error", () => resolve(false));
      socket.once("open", () => {
        socket.close();
        resolve(true);
      });
    });
    if (connected)
      return {
        url,
        async close() {
          child.kill();
          await exit;
        },
      };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  await exit;
  throw new Error("隔离 Codex 后端启动超时");
}
