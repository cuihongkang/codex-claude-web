import { options, scope } from "./options.js";

export function queryDescription(name, args) {
  if (name === "ps") {
    const parsed = options(
      args.filter((arg, index) => !(index === 0 && /^[auxwf]+$/.test(arg))),
      ["-e", "-f", "-a", "-x", "-w", "-H", "--forest", "--no-headers", "-T"],
      [
        "-o",
        "--format",
        "-p",
        "--pid",
        "--ppid",
        "-C",
        "-u",
        "--user",
        "--sort",
      ],
    );
    if (!parsed || parsed.targets.length) return null;
    const pid = parsed.value("-p", "--pid"),
      parent = parsed.value("--ppid"),
      executable = parsed.value("-C");
    return parent
      ? `查看进程 ${parent} 的子进程`
      : pid
        ? `查看进程 ${pid}`
        : executable
          ? `查看 ${executable} 进程`
          : "查看进程列表";
  }
  if (name === "pgrep") {
    const parsed = options(
      args,
      ["-a", "-f", "-l", "-i", "-x", "-n", "-o"],
      ["-u", "-P"],
    );
    return parsed?.targets.length
      ? `查找进程 ${parsed.targets.join("、")}`
      : null;
  }
  if (name === "systemctl") {
    const parsed = options(
      args,
      [
        "--user",
        "--system",
        "--no-pager",
        "--plain",
        "--no-legend",
        "--all",
        "-a",
        "--failed",
      ],
      ["--type", "--state", "-p", "--property"],
    );
    if (!parsed) return null;
    const [action, ...services] = parsed.targets;
    const subject = parsed.has("--user") ? "用户服务" : "服务";
    const labels = {
      status: `查看${subject}状态`,
      "is-active": `检查${subject}运行状态`,
      "is-enabled": `检查${subject}启用状态`,
      cat: `读取${subject}配置`,
      show: `查看${subject}属性`,
      "list-units": `列出${subject}`,
      "list-unit-files": `列出${subject}配置`,
    };
    const label = Object.hasOwn(labels, action) ? labels[action] : null;
    return label
      ? label + (services.length ? " " + services.join("、") : "")
      : null;
  }
  if (name === "journalctl") {
    const parsed = options(
      args,
      [
        "--user",
        "--no-pager",
        "-b",
        "--boot",
        "-e",
        "--pager-end",
        "-r",
        "--reverse",
        "-f",
        "--follow",
      ],
      [
        "-u",
        "--unit",
        "--user-unit",
        "-n",
        "--lines",
        "--since",
        "--until",
        "-p",
        "--priority",
        "-o",
        "--output",
      ],
    );
    if (!parsed) return null;
    const units = parsed.allValues("-u", "--unit", "--user-unit"),
      count = parsed.value("-n", "--lines");
    if (count !== undefined && !/^\d+$/.test(count)) return null;
    return `${parsed.has("-f", "--follow") ? "持续查看" : "查看"}${units.length ? "服务日志 " + units.join("、") : "系统日志"}${count ? `（最近 ${count} 行）` : ""}${scope(parsed.targets)}`;
  }
  const fileQueries = {
    du: [
      "查看磁盘占用",
      ["-s", "-h", "-a", "-c", "-k", "-m", "--summarize", "--human-readable"],
      ["-d", "--max-depth"],
    ],
    df: ["查看磁盘空间", ["-h", "-i", "-T", "--human-readable", "--total"]],
    file: ["查看文件类型", ["-b", "-L", "-i", "--mime", "--mime-type"]],
    stat: ["查看文件信息", ["-L", "-f", "--file-system"], ["-c", "--format"]],
  };
  if (Object.hasOwn(fileQueries, name)) {
    const [label, flags, values] = fileQueries[name],
      parsed = options(args, flags, values);
    return parsed
      ? label + (parsed.targets.length ? " " + parsed.targets.join("、") : "")
      : null;
  }
  if ((name === "command" && args[0] === "-v") || name === "which") {
    const parsed = options(name === "command" ? args.slice(1) : args, ["-a"]);
    return parsed?.targets.length
      ? "查找命令位置 " + parsed.targets.join("、")
      : null;
  }
  if (name === "curl") {
    const parsed = options(
      args,
      [
        "-I",
        "--head",
        "-f",
        "--fail",
        "-s",
        "--silent",
        "-S",
        "--show-error",
        "-L",
        "--location",
        "--compressed",
        "-k",
        "--insecure",
        "-O",
        "--remote-name",
      ],
      [
        "--max-time",
        "-m",
        "--connect-timeout",
        "--noproxy",
        "--proxy",
        "-x",
        "-H",
        "--header",
        "-A",
        "--user-agent",
        "-X",
        "--request",
        "-o",
        "--output",
      ],
    );
    if (!parsed?.targets.length) return null;
    const method = parsed.value("-X", "--request"),
      output = parsed.value("-o", "--output");
    if (method && !["GET", "HEAD"].includes(method)) return null;
    const urls = parsed.targets.join("、");
    const head = parsed.has("-I", "--head") || method === "HEAD";
    if (
      parsed.allValues("-o", "--output").length > 1 ||
      (output && parsed.targets.length > 1)
    )
      return null;
    if (output || parsed.has("-O", "--remote-name"))
      return `${head ? "保存响应头" : "下载"} ${urls}${output ? " 到 " + output : ""}`;
    return `${head ? "查看响应头" : "请求地址"} ${urls}`;
  }
  return null;
}
