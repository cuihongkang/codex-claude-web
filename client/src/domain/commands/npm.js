import { options, scope } from "./options.js";

export function npmDescription(args) {
  let index = 0;
  const prefix = [];
  while (["--workspace", "-w", "--prefix"].includes(args[index])) {
    if (!args[index + 1]) return null;
    prefix.push(args[index], args[index + 1]);
    index += 2;
  }
  const action = args[index++];
  let script;
  if (action === "run" || action === "run-script") script = args[index++];
  else if (["test", "start", "stop", "restart"].includes(action))
    script = action;
  const parsed = options(
    [...prefix, ...args.slice(index)],
    ["--silent", "-s", "--if-present", "--workspaces"],
    ["--workspace", "-w", "--prefix"],
  );
  if (!parsed) return null;
  let label;
  if (script) {
    const labels = {
      check: "运行项目检查",
      test: "运行测试",
      "test:unit": "运行单元测试",
      "test:components": "运行组件测试",
      "test:package": "运行发行包测试",
      build: "构建项目",
      lint: "检查代码规范",
      typecheck: "检查类型",
      format: "格式化文件",
      "format:check": "检查代码格式",
    };
    label = Object.hasOwn(labels, script)
      ? labels[script]
      : `运行 npm 脚本 ${script}`;
  } else if (action === "ci") label = "按锁文件安装 npm 依赖";
  else if (action === "install" || action === "i") label = "安装 npm 依赖";
  else if (action === "pack") label = "打包 npm 项目";
  else return null;
  const workspaces = parsed.has("--workspaces")
      ? ["全部"]
      : parsed.allValues("--workspace", "-w"),
    directory = parsed.value("--prefix");
  return (
    label +
    scope(workspaces, "工作区") +
    (directory ? scope([directory], "目录") : "") +
    scope(parsed.targets, script ? "参数" : "目标")
  );
}
