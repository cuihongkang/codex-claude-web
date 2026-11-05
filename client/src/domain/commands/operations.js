import { options, scope } from "./options.js";

import { gitDescription } from "./git.js";
import { npmDescription } from "./npm.js";
import { queryDescription } from "./query.js";
export function operationDescription(name, args, depth = 0) {
  if (depth > 3) return null;
  if (
    args.length === 1 &&
    (args[0] === "--version" ||
      (args[0] === "-V" &&
        ["python", "python3", "uv", "curl"].includes(name)) ||
      (args[0] === "-v" && ["node", "npm", "npx"].includes(name))) &&
    ["git", "npm", "npx", "node", "python", "python3", "uv", "curl"].includes(
      name,
    )
  )
    return `查看 ${name} 版本`;
  if (name === "git") return gitDescription(args);
  if (name === "npm") return npmDescription(args);
  if (name === "npx") {
    const rest = ["--yes", "-y"].includes(args[0]) ? args.slice(1) : args;
    if (rest[0] !== "prettier") return null;
    const parsed = options(
      rest.slice(1),
      [
        "--check",
        "--write",
        "--list-different",
        "--ignore-unknown",
        "--no-error-on-unmatched-pattern",
      ],
      ["--config", "--ignore-path", "--parser"],
    );
    if (!parsed) return null;
    return (
      (parsed.has("--write")
        ? "格式化文件"
        : parsed.has("--check")
          ? "检查代码格式"
          : parsed.has("--list-different")
            ? "列出格式不同的文件"
            : "预览代码格式化结果") + scope(parsed.targets)
    );
  }
  if (name === "node" && args[0] === "--test") {
    const parsed = options(
      args.slice(1),
      [],
      ["--test-concurrency", "--test-name-pattern", "--test-reporter"],
    );
    return parsed ? "运行 Node.js 测试" + scope(parsed.targets) : null;
  }
  if (["python", "python3", "node"].includes(name)) {
    const language = name === "node" ? "Node.js" : "Python";
    if (
      ["-c", "-e", "--eval"].includes(args[0]) &&
      args[1] !== undefined &&
      (name === "node" ? args[0] !== "-c" : args[0] === "-c")
    )
      return `执行 ${language} 代码`;
    if (name !== "node" && args[0] === "-m") {
      if (args[1] === "pytest")
        return "运行 Python 测试" + scope(args.slice(2), "参数");
      if (args[1] === "py_compile" && args.length > 2)
        return "检查 Python 语法" + scope(args.slice(2));
      if (args[1])
        return `运行 Python 模块 ${args[1]}` + scope(args.slice(2), "参数");
    }
    if (args[0] && !args[0].startsWith("-"))
      return `运行 ${language} 脚本 ${args[0]}` + scope(args.slice(1), "参数");
  }
  if (name === "uv" && args[0] === "run") {
    let index = 1;
    const context = [];
    while (index < args.length) {
      const arg = args[index];
      if (
        [
          "--offline",
          "--no-project",
          "--frozen",
          "--locked",
          "--no-sync",
          "--quiet",
        ].includes(arg)
      )
        index++;
      else if (
        ["--project", "--directory", "--python", "--with"].includes(arg) &&
        args[index + 1]
      ) {
        context.push(`${arg.slice(2)}：${args[index + 1]}`);
        index += 2;
      } else if (arg === "--") {
        index++;
        break;
      } else if (arg.startsWith("-")) return null;
      else break;
    }
    const executable = args[index];
    if (!executable) return null;
    const nested = operationDescription(
      executable,
      args.slice(index + 1),
      depth + 1,
    );
    return (
      `通过 uv ${nested || "运行 " + executable + scope(args.slice(index + 1), "参数")}` +
      scope(context, "环境")
    );
  }
  return queryDescription(name, args);
}
