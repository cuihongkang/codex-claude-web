# CLI 快捷命令对照

对照基于 2026-10-29 本机安装的 `codex-cli 0.162.1`，检查其命令定义、命令分发及 `codex app-server generate-ts --experimental` 生成的协议。网页按已确认的功能范围增加 `/init`、`/goal` 和清理后台终端的 `/stop`。

统一注册表位于 `client/src/features/commands/composer-commands.js`，共 18 个命令，各命令使用独立名称。菜单选择、Ctrl+Enter 和发送按钮共用分发逻辑。Enter 在普通消息中换行，在命令建议中确认选项。未知命令和不支持的参数显示错误并保留输入；命令执行失败保留草稿和附件以便重试。

## 新增能力

- `/init`：检查当前实际工作目录。已有 `AGENTS.md` 时保留并打开；缺少时通过正常轮次要求模型阅读项目、生成贡献指南，并在写入前再次检查已有文件。生成任务沿用当前模型、思考强度与速度，消息附件保持在输入框中。
- `/goal [目标 | edit | pause | resume | clear]`：无参数或 `edit` 打开目标管理窗口；输入目标文字后设置并开始目标；`pause` 暂停、`resume` 恢复、`clear` 清除。窗口支持编辑目标与可选 token 预算，预算留空表示不限。新对话先创建实际对话，所有显式修改携带 `origin: user`，通过 `thread/goal/get`、`thread/goal/set` 和 `thread/goal/clear` 完成。
- `/stop`：打开当前对话的后台终端列表，完整读取 `thread/backgroundTerminals/list` 分页，显示命令、目录与进程标识；点击“停止全部后台终端”调用 `thread/backgroundTerminals/clean`。聊天区原有停止按钮继续中断当前任务轮次。

## 原有命令

以下命令沿用原来的界面和行为，均单独执行：

- `/new`：在当前项目开始新对话。
- `/model`：打开模型与思考强度设置。
- `/plan`：切换计划与执行模式。
- `/review`：打开变更面板并审查当前项目未提交的更改。
- `/compact`：整理当前对话上下文。提交后常显准备、整理状态和耗时，整理期间保留可编辑草稿与附件并暂停发送、补充、审查及重复整理；所属轮次完成、失败或中断后显示结果并恢复发送，失败可重新整理。刷新页面与重连恢复实际整理状态。
- `/skills`：打开已安装技能列表。
- `/files`：打开项目文件面板。
- `/diff`：打开变更面板。
- `/terminal`：打开网页终端。
- `/project`：打开工作目录选择。
- `/search`：搜索历史对话。
- `/status`：打开设置，查看外观、快捷键和版本信息；账户额度统一通过侧栏圆环查看。
- `/fork`：创建当前对话的分支。
- `/rename`：打开对话重命名窗口。
- `/delete`：打开对话删除确认窗口。

网页现有的速度、外观、文件引用、插件、归档及其他交互继续使用原入口。新增 CLI 能力需先明确功能范围，再同步注册表、实现和覆盖记录。

## 回归验证

`tests/components/commands.mjs` 使用模拟后端核对完整的 18 项注册清单、独立命令名称、已移除命令的拒绝执行、原有入口、项目指令保护、提交失败重试、切换对话隔离、目标管理与预算，以及后台终端分页清理。`tests/components/compaction.mjs` 验证整理期间的发送限制、状态与结果、草稿附件保留及重试。`server/tests/subscriptions.test.mjs` 覆盖目标与后台终端请求所需的恢复、释放和新建空对话保留，以及整理请求确认后的订阅持有、多页面占用和重连核对。

浏览器回归使用生产构建和隔离 WebSocket 模拟数据，实际点击和输入验证菜单、移除命令、项目指令、目标管理、后台终端清理及上下文整理的提交、执行、刷新恢复、完成和失败重试，并保存浅色、深色、桌面和窄屏截图：

```bash
npm run build
CHROME_PATH=/path/to/chromium node tests/browser/commands.mjs
```

截图、构建来源和请求清单保存在被 Git 忽略的 `.cache/commands-browser`。完整检查使用 `npm run check`。

`tests/browser/compaction-reload.mjs` 同时验证旧桥接的分页恢复与现代桥接的整理快照：进行中的任务在完整刷新后继续恢复，刷新期间结束的任务显示实际结果；已显示的完成结果、切换后返回的提示及手动关闭的提示，在新页面接收旧结果快照时保持收起。组件回归补充重复结果通知、新整理任务与旧结果隔离、相同对话元数据更新及切换时保留进行中的任务。

整理完成提示的浏览器回归覆盖 390px 深色界面的发送按钮与 1440px 浅色界面的 Ctrl+Enter，断言提交后提示自动关闭，并保存发送前后截图。修改前的生产构建及构建信息分别复制到 `.cache/compaction-dismiss-before/dist` 与 `.cache/compaction-dismiss-before/build-info.json`，设置 `COMPACTION_DISMISS_BEFORE=1` 运行同一脚本，可复现发送后提示仍显示的行为；通过 `BROWSER_OUTPUT_DIR` 分别保存修改前后结果。组件回归同时验证空消息保留提示、请求等待期间立即关闭、发送失败保留草稿附件及重试、切换对话和迟到响应隔离。README 与其他文档引用的界面图片展示普通任务及文件预览，整理完成提示未出现在这些图片中，现有图片继续适用。
