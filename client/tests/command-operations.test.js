import test from "node:test";
import assert from "node:assert/strict";
import { commandDescription } from "../src/domain/command-description.js";

test("Git 检查和查询按用途展示，保留暂存区、目录和文件范围", () => {
  for (const [command, expected] of [
    ["git diff --check", "检查差异的空白错误"],
    ["git diff --cached --check", "检查暂存区差异的空白错误"],
    ["git diff --stat", "查看差异统计"],
    ["git diff --numstat", "查看差异行数统计"],
    ["git diff --staged --name-only", "查看暂存区变更文件"],
    ["git diff --name-status", "查看变更文件及状态"],
    ["git diff -- src/app.js", "查看代码差异（范围：src/app.js）"],
    [
      "git -C '/code/my project' --no-pager diff --check",
      "检查差异的空白错误（目录：/code/my project）",
    ],
    ["git status --short", "查看工作区状态"],
    ["git status -sb --porcelain=v1 -- src", "查看工作区状态（范围：src）"],
    ["git status -uno", "查看工作区状态"],
    ["git log -5 --oneline", "查看最近 5 条提交记录"],
    ["git log -n5 --oneline", "查看最近 5 条提交记录"],
    ["git log -- -5", "查看提交记录（范围：-5）"],
    ["git log -n 5 --max-count=10", "查看最近 10 条提交记录"],
    ["git log --max-count=10 -n 5", "查看最近 5 条提交记录"],
    ["git log --oneline main..HEAD", "查看提交记录（范围：main..HEAD）"],
    ["git show --stat HEAD", "查看提交变更统计（范围：HEAD）"],
    ["git branch --show-current", "查看当前分支"],
    ["git branch -avv", "查看分支列表"],
    ["git rev-parse --show-toplevel", "查看仓库根目录"],
    ["git rev-parse --abbrev-ref HEAD", "查看当前分支"],
    ["git rev-parse --short HEAD", "查看提交短哈希（范围：HEAD）"],
    ["git ls-files src", "列出 Git 文件（范围：src）"],
    ["git remote -v", "查看远程仓库"],
    ["git remote get-url origin", "查看远程仓库地址（远程：origin）"],
    ["git check-ignore -v dist", "检查 Git 忽略规则（范围：dist）"],
  ])
    assert.equal(commandDescription(command), expected, command);
});

test("项目检查、格式检查、测试和构建使用简洁动词", () => {
  for (const [command, expected] of [
    ["npm run check", "运行项目检查"],
    ["npm test", "运行测试"],
    ["npm run test:unit", "运行单元测试"],
    ["npm run test:components", "运行组件测试"],
    [
      "npm run build --workspace @example/client",
      "构建项目（工作区：@example/client）",
    ],
    ["npm run test -w client -w server", "运行测试（工作区：client、server）"],
    ["npm run test --workspaces", "运行测试（工作区：全部）"],
    ["npm --prefix client run build", "构建项目（目录：client）"],
    ["npm run test -- --watch", "运行测试（参数：--watch）"],
    ["npm run format:check", "检查代码格式"],
    ["npm run custom-script", "运行 npm 脚本 custom-script"],
    ["npm run constructor", "运行 npm 脚本 constructor"],
    ["npm ci", "按锁文件安装 npm 依赖"],
    ["npm install example", "安装 npm 依赖（目标：example）"],
    ["npm pack", "打包 npm 项目"],
    ["npx prettier --check src", "检查代码格式（范围：src）"],
    ["npx -y prettier --write src/app.js", "格式化文件（范围：src/app.js）"],
    [
      "node --test tests/unit.test.mjs",
      "运行 Node.js 测试（范围：tests/unit.test.mjs）",
    ],
    ["node scripts/check.mjs", "运行 Node.js 脚本 scripts/check.mjs"],
    ["python3 -m pytest -q tests", "运行 Python 测试（参数：-q、tests）"],
    [
      "python3 -m py_compile src/main.py",
      "检查 Python 语法（范围：src/main.py）",
    ],
    [
      "uv run --offline python3 tools/check.py",
      "通过 uv 运行 Python 脚本 tools/check.py",
    ],
    ["node --version", "查看 node 版本"],
    ["npm -v", "查看 npm 版本"],
  ])
    assert.equal(commandDescription(command), expected, command);
});

test("进程、服务、日志、网络和系统查询保留操作对象", () => {
  for (const [command, expected] of [
    ["pwd", "查看当前工作目录"],
    ["pwd -P", "查看当前工作目录"],
    ["ps aux", "查看进程列表"],
    ["ps -eo pid,ppid,args", "查看进程列表"],
    ["ps -p 123 -o pid,args", "查看进程 123"],
    ["ps -o pid,args --ppid 123", "查看进程 123 的子进程"],
    ["pgrep -af node", "查找进程 node"],
    [
      "systemctl --user status example.service --no-pager",
      "查看用户服务状态 example.service",
    ],
    [
      "systemctl --user cat example.service",
      "读取用户服务配置 example.service",
    ],
    [
      "journalctl --user -u example.service -n 20 --no-pager",
      "查看服务日志 example.service（最近 20 行）",
    ],
    [
      "journalctl -u first.service -u second.service",
      "查看服务日志 first.service、second.service",
    ],
    ["du -sh client/dist", "查看磁盘占用 client/dist"],
    ["df -h /", "查看磁盘空间 /"],
    ["file image.png", "查看文件类型 image.png"],
    ["stat -c '%s' image.png", "查看文件信息 image.png"],
    ["command -v node npm", "查找命令位置 node、npm"],
    ["which -a node", "查找命令位置 node"],
    [
      "curl -fsS --max-time 5 http://localhost:8766/healthz",
      "请求地址 http://localhost:8766/healthz",
    ],
    ["curl -IL https://example.com", "查看响应头 https://example.com"],
    [
      "curl -o report.txt https://example.com/report",
      "下载 https://example.com/report 到 report.txt",
    ],
    [
      "curl -I -o headers.txt https://example.com",
      "保存响应头 https://example.com 到 headers.txt",
    ],
  ])
    assert.equal(commandDescription(command), expected, command);
});

test("环境包装与组合命令复用描述，技能标题隐藏路径", () => {
  for (const [command, expected] of [
    ["env", "查看环境变量"],
    [
      "env -u HTTPS_PROXY curl -I https://example.com",
      "移除环境变量 HTTPS_PROXY后查看响应头 https://example.com",
    ],
    ["env MODE=test npm run check", "设置环境变量 MODE后运行项目检查"],
    ["env -i pwd", "清空环境变量后查看当前工作目录"],
    [
      "git diff --check && npm run check; pwd",
      "检查差异的空白错误，成功后运行项目检查；查看当前工作目录",
    ],
    [
      "cat /skills/demo/SKILL.md; git status --short",
      "阅读技能 demo；查看工作区状态",
    ],
    [
      "git diff --check || unknown-tool",
      "检查差异的空白错误，失败后执行命令 unknown-tool",
    ],
  ])
    assert.equal(commandDescription(command), expected, command);
});

test("未识别的操作和改变用途的选项保留命令原文", () => {
  for (const command of [
    "git diff --output=patch.txt",
    "git diff --ext-diff",
    "git -c alias.x=status x",
    "git branch new-branch",
    "git branch -D old-branch",
    "git config user.name value",
    "git remote set-url origin https://example.com/repo",
    "systemctl restart example.service",
    "curl --upload-file local.txt https://example.com",
    "curl -X POST https://example.com",
    "npm --unknown run check",
    "env --split-string command",
    "git log -n",
    "constructor",
    "toString",
    "__proto__",
    "systemctl constructor",
  ])
    assert.equal(commandDescription(command), command, command);
});
