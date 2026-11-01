import { options, scope } from "./options.js";

export function gitDescription(args) {
  const directories = [];
  let index = 0;
  while (index < args.length) {
    if (["--no-pager", "--no-optional-locks"].includes(args[index])) index++;
    else if (args[index] === "-C" && args[index + 1]) {
      directories.push(args[index + 1]);
      index += 2;
    } else break;
  }
  const action = args[index++],
    rest = args.slice(index);
  let label;
  if (action === "diff") {
    const parsed = options(
      rest,
      [
        "--check",
        "--stat",
        "--numstat",
        "--shortstat",
        "--name-only",
        "--name-status",
        "--cached",
        "--staged",
        "--no-color",
        "--patch",
        "-p",
        "--exit-code",
        "--quiet",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-space-at-eol",
        "--ignore-all-space",
        "-w",
        "--ignore-space-change",
        "-b",
        "--no-renames",
      ],
      ["-U", "--unified", "--diff-filter", "--color"],
    );
    if (!parsed) return null;
    const staged = parsed.has("--cached", "--staged") ? "暂存区" : "";
    label = parsed.has("--check")
      ? `检查${staged}差异的空白错误`
      : parsed.has("--numstat")
        ? `查看${staged}差异行数统计`
        : parsed.has("--stat", "--shortstat")
          ? `查看${staged}差异统计`
          : parsed.has("--name-status")
            ? `查看${staged}变更文件及状态`
            : parsed.has("--name-only")
              ? `查看${staged}变更文件`
              : `查看${staged}代码差异`;
    label += scope(parsed.targets);
  } else if (action === "status") {
    const parsed = options(
      rest,
      [
        "-s",
        "--short",
        "-b",
        "--branch",
        "--porcelain",
        "-u",
        "--untracked-files",
        "--ignored",
        "--ahead-behind",
        "--no-ahead-behind",
        "--renames",
        "--no-renames",
      ],
      ["--porcelain", "-u", "--untracked-files", "--ignore-submodules"],
    );
    if (!parsed) return null;
    label = "查看工作区状态" + scope(parsed.targets);
  } else if (action === "log" || action === "show") {
    const logArgs = [];
    let literal = false;
    for (const arg of rest) {
      if (arg === "--") literal = true;
      if (!literal && /^-\d+$/.test(arg)) logArgs.push("-n", arg.slice(1));
      else logArgs.push(arg);
    }
    const parsed = options(
      logArgs,
      [
        "--oneline",
        "--stat",
        "--name-only",
        "--name-status",
        "--no-patch",
        "-s",
        "-p",
        "--decorate",
        "--all",
        "--graph",
        "--date-order",
        "--reverse",
        "--abbrev-commit",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
      ],
      [
        "-n",
        "--max-count",
        "--format",
        "--pretty",
        "--date",
        "--since",
        "--until",
        "--author",
        "--grep",
      ],
    );
    if (!parsed) return null;
    const count = parsed.value("-n", "--max-count");
    if (count !== undefined && !/^\d+$/.test(count)) return null;
    label =
      action === "log"
        ? count
          ? `查看最近 ${count} 条提交记录`
          : "查看提交记录"
        : parsed.has("--stat")
          ? "查看提交变更统计"
          : "查看 Git 对象详情";
    label += scope(parsed.targets);
  } else if (action === "branch") {
    const parsed = options(
      rest,
      [
        "--show-current",
        "-a",
        "--all",
        "-r",
        "--remotes",
        "-v",
        "--verbose",
        "--list",
        "--no-color",
      ],
      ["--sort", "--contains", "--merged", "--no-merged"],
    );
    if (!parsed || (parsed.targets.length && !parsed.has("--list")))
      return null;
    label = parsed.has("--show-current") ? "查看当前分支" : "查看分支列表";
    label += scope(parsed.targets);
  } else if (action === "rev-parse") {
    const parsed = options(rest, [
      "--show-toplevel",
      "--show-prefix",
      "--git-dir",
      "--abbrev-ref",
      "--short",
      "--verify",
      "--is-inside-work-tree",
    ]);
    if (!parsed) return null;
    if (parsed.has("--show-toplevel")) label = "查看仓库根目录";
    else if (parsed.has("--show-prefix")) label = "查看仓库内相对目录";
    else if (parsed.has("--git-dir")) label = "查看 Git 数据目录";
    else if (parsed.has("--is-inside-work-tree"))
      label = "检查当前目录是否属于工作区";
    else if (parsed.has("--abbrev-ref") && parsed.targets.join() === "HEAD")
      label = "查看当前分支";
    else
      label = `查看${parsed.has("--short") ? "提交短哈希" : "Git 引用"}${scope(parsed.targets)}`;
  } else if (action === "ls-files" || action === "check-ignore") {
    const parsed =
      action === "ls-files"
        ? options(rest, [
            "-c",
            "--cached",
            "-m",
            "--modified",
            "-d",
            "--deleted",
            "-o",
            "--others",
            "--exclude-standard",
            "-z",
            "-s",
            "--stage",
            "--error-unmatch",
          ])
        : options(rest, [
            "-v",
            "--verbose",
            "-q",
            "--quiet",
            "--no-index",
            "-z",
          ]);
    if (!parsed) return null;
    label =
      (action === "ls-files" ? "列出 Git 文件" : "检查 Git 忽略规则") +
      scope(parsed.targets);
  } else if (action === "remote") {
    if (
      !rest.length ||
      (rest.length === 1 && ["-v", "--verbose"].includes(rest[0]))
    )
      label = "查看远程仓库";
    else if (rest[0] === "get-url") {
      const parsed = options(rest.slice(1), ["--all", "--push"]);
      if (!parsed) return null;
      label = "查看远程仓库地址" + scope(parsed.targets, "远程");
    }
  }
  return label ? label + scope(directories, "目录") : null;
}
