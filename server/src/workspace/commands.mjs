import { spawn } from "node:child_process";
export function executeCommand(params) {
  return new Promise((resolve, reject) => {
    if (
      !Array.isArray(params.command) ||
      !params.command.length ||
      params.command.some((p) => typeof p !== "string")
    )
      return reject(new Error("命令必须是参数数组"));
    const child = spawn(params.command[0], params.command.slice(1), {
      cwd: params.cwd,
      env: { ...process.env, ...params.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 120000);
    child.stdout.on("data", (bytes) => {
      stdout = (stdout + bytes).slice(-4000000);
    });
    child.stderr.on("data", (bytes) => {
      stderr = (stderr + bytes).slice(-4000000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}
