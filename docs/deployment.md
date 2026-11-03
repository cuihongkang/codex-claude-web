# 部署与维护

本文面向安装和运行 Codex Web 的使用者，说明发行包安装、配置、服务管理、升级与故障处理。界面预览与快速开始见 [README](../README.md)。

## 安装发行包

预构建 npm 安装包通过 [GitHub Releases](https://github.com/hjd-hitsz/codex-web/releases) 分发。在已配置 Node.js 24+、npm、Codex CLI、`/usr/bin/zsh` 和 systemd 的 Linux 电脑上，以运行 Codex 的普通用户完成本机 Codex 登录，然后执行：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v2.4.1/codex-web-2.4.1.tgz
codex-web service install
loginctl enable-linger "$USER"
codex-web service status
curl http://127.0.0.1:8766/healthz
```

`service install` 创建缺失的后端服务并安装网页服务，启用两者的自启动；已有后端服务继续使用原配置。`enable-linger` 使用户服务可在开机后、登录前启动，是否需要管理员操作由系统授权策略决定。npm 全局命令所在目录需在 `PATH` 中，目标电脑的防火墙需允许访问网页端口。

默认网页地址为 `http://电脑IP:8766`，本机可使用 `http://127.0.0.1:8766`。网页沿用本机 Codex 登录，以服务用户的完全访问权限执行任务，通过 HTTP 提供访问，适合在可信网络中使用。

### 下载后安装与校验

也可以下载或复制 Release 中的 `codex-web-2.4.1.tgz` 和 `codex-web-2.4.1.tgz.sha256` 到同一目录，然后执行：

```bash
sha256sum -c codex-web-2.4.1.tgz.sha256
npm install -g ./codex-web-2.4.1.tgz
codex-web service install
```

安装使用 Release 的 `.tgz` 附件。安装过程中，npm 会获取运行依赖，目标电脑需具备相应缓存或能访问配置的 npm registry。

文件差异与撤销校验需要服务环境能够运行 `git`。文件变更汇总也支持 Git 仓库以外的目录；“撤销”遇到后续修改冲突时会保留当前文件。升级后先等待当前任务和网页终端结束，再重启网页服务并刷新页面，以加载新的界面和撤销接口。

## 命令与前台运行

- `codex-web` / `codex-web start`：前台运行网页服务，连接配置中的 Codex 后端。
- `codex-web backend`：前台运行 Codex app-server。
- `codex-web config init`：创建用户 `.env`，显示配置路径并保留已有文件。
- `codex-web --version` / `codex-web version --json`：查看版本或完整的版本来源信息。
- `codex-web service install`：安装或更新服务文件，启动尚未运行的服务。
- `codex-web service status`：查看网页与后端状态。
- `codex-web service start` / `stop` / `restart`：启动、停止或重启网页服务；启动网页时也会拉起后端，停止网页时后端继续运行。
- `codex-web service restart-when-idle`：等待当前任务和上下文整理结束后重启网页，打开的网页终端保持独立。

前台运行时，在两个终端分别执行 `codex-web backend` 和 `codex-web`，并保持终端打开。已有可连接的后端时，直接运行 `codex-web`。

## 配置

全局命令从 `~/.config/codex-web/.env` 读取配置；设置 `XDG_CONFIG_HOME` 时使用其下的 `codex-web` 目录，设置 `CODEX_WEB_CONFIG_DIR` 时优先使用该目录。外部环境变量优先于 `.env`。执行 `codex-web config init` 可创建配置并显示路径，已有配置和 npm 升级后的配置均会保留。

systemd 服务会记录安装时的配置目录，后续启动继续使用该目录。更换配置目录时，用新的 `CODEX_WEB_CONFIG_DIR` 执行 `codex-web service install`，再按下文方法重启网页服务。

- `HOST`：HTTP 监听地址，初始为 `0.0.0.0`，支持通过电脑 IP 访问；仅本机访问可设为 `127.0.0.1`。
- `PORT`：网页端口，初始为 `8766`。
- `CODEX_APP_SERVER_URL`：Codex 后端 WebSocket 地址，初始为 `ws://127.0.0.1:8765`；使用已有后端时填写其实际地址。
- `CODEX_HOME`：本机 Codex 配置目录，未设置时使用当前用户的 `~/.codex`。用于读取桌面端的无项目目录信息，并保存网页“未分类”对话的独立工作目录。使用独立 Codex 配置目录时，填写对应目录。
- `DEFAULT_CWD`：首次打开网页时的默认目录，未设置时使用当前用户的主目录；浏览器已经选择的项目目录优先。
- `STATIC_DIR`：网页资源目录，未设置时自动定位到当前安装包中的网页资源；相对路径以用户配置目录为基准。

相对 `DEFAULT_CWD` 同样以用户配置目录为基准。建议为工作目录填写绝对路径，便于核对任务实际使用的位置。

修改配置前先等待任务结束并退出网页终端，保存后执行 `codex-web service restart`；前台运行时重新启动网页进程。修改端口后使用新端口访问。

`CODEX_APP_SERVER_URL` 用于指定网页连接地址。已有后端服务的监听地址继续由其服务配置管理，修改连接地址时需与实际后端保持一致。Codex 后端的环境配置见下一节。

## systemd 服务

网页服务名为 `codex-lan-web.service`，后端服务名为 `codex-app-server.service`。`codex-web service install` 保留已有后端配置，更新网页服务文件，并让正在运行的服务继续运行。切换到新安装路径或配置后，通过重启使新设置生效。

安装脚本创建的后端服务从用户配置目录下的 `.env.backend` 读取环境变量，可在其中配置后端代理。已有后端服务的代理、登录环境和启动设置继续由原服务配置管理。更改后端配置后，在所有相关对话和终端空闲时重启后端服务。

查看状态与日志：

```bash
systemctl --user status codex-lan-web.service codex-app-server.service
journalctl --user -u codex-lan-web.service -n 100 --no-pager
journalctl --user -u codex-app-server.service -n 100 --no-pager
curl http://127.0.0.1:8766/healthz
```

自定义网页端口时，相应替换健康检查地址。`/healthz` 在已连接 Codex 后端时返回 HTTP 200，后端未连接时返回 HTTP 503；响应包含连接状态 `ready` 和正在运行的网页服务版本 `version`。

## 升级和回退

从目标版本的 Release 获取安装地址。当前版本的安装与服务更新命令为：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v2.4.1/codex-web-2.4.1.tgz
codex-web service install
codex-web service restart-when-idle
```

最后一个命令等待网页服务观察到的任务和上下文整理结束后自动重启，等待期间保持命令运行。打开或隐藏的网页终端不会阻塞更新，等待程序只重启网页服务。切换 Node.js 版本或 npm prefix 后，也需重新安装服务并重启，以更新服务中的安装路径。

日志显示实际等待的任务与上下文整理数量；执行重启后继续检查 `/healthz`，连接就绪时报告实际运行版本，重启或健康检查失败时保留失败状态。

升级后刷新网页，在“设置 → 关于”核对网页和服务版本。`codex-web version --json` 查看当前磁盘安装包，`/healthz` 中的 `version` 查看实际运行的服务，便于确认重启是否生效。

需要回退程序时，使用目标旧版本 Release 的 `.tgz` 安装地址重新安装，执行 `codex-web service install`，再等待空闲后重启。用户配置继续保留；涉及配置或数据迁移的版本，先查看对应发布说明。

服务安装会备份被覆盖的网页服务文件，默认位置为 `~/.local/state/codex-web/service-backups/时间戳/`；设置 `XDG_STATE_HOME` 时采用其下的对应目录。回退服务路径时，将备份的 `codex-lan-web.service` 恢复到用户服务目录，默认 `~/.config/systemd/user/`；设置 `XDG_CONFIG_HOME` 时使用其下的 `systemd/user/`。执行 `systemctl --user daemon-reload`，确认原安装路径仍可用，再等待空闲后重启网页服务。

## 数据保存与迁移

- 聊天记录和登录凭据由 Codex 自身管理。
- 草稿、置顶、项目快捷列表和主题保存在当前浏览器中。
- “未分类”对话的文件位于 `CODEX_HOME/codex-web/workspaces/chat-XXXXXX`，首次发送时分配；未设置 `CODEX_HOME` 时位于 `~/.codex/codex-web/workspaces`。迁移电脑时，可随 Codex 配置目录一起保留。
- 网页配置 `.env` 与新建后端服务使用的 `.env.backend` 位于用户配置目录，迁移时应一并保留；已有后端服务的配置按原部署方式迁移。
- 摘要翻译由服务所在电脑调用免费、免认证的 TranSmart 服务，浏览器仅访问当前网页服务；待译摘要会发送至 TranSmart，代码、路径和链接在发送前替换为占位符。成功译文缓存在当前标签页会话中，刷新页面和切换对话继续复用，关闭标签页或浏览器后清空。
- 自动对话标题使用 Codex 模型，会产生少量额外模型用量。

## 故障定位

网页不可访问时，先检查网页服务状态、监听端口和主机网络。网页可打开但显示后端未连接时，检查 Codex 后端服务日志、实际监听地址和本机 Codex 登录状态。

账户额度从本机已登录的 Codex 账户自动读取，按实际返回显示周额度和 5 小时额度。默认以圆环和百分比显示，展开详情后在同一行查看重置倒计时与具体日期时间。页面可见时每分钟校准，回到页面、任务结束和连接恢复后自动更新。读取暂缓时保留上次成功读取的数值，圆环变灰，详情显示“待更新”；恢复后自动重新同步。倒计时在详情打开期间独立更新。额度读取沿用已有后端连接，仅查询账户用量。

摘要翻译失败时，页面保留原文并提供重试入口。检查服务所在电脑能否访问 `transmart.qq.com`，以及翻译服务是否正常响应。升级后若本站 `/api/translate` 返回 404，先等待任务与网页终端空闲，再重启网页服务以加载翻译接口。

### 对话占用与后端回收

网页进入对话时先显示历史，再检查写入权。检查期间暂停输入；其他客户端持有写入权时，发送框位置显示占用说明和“重试”按钮。先在持有该对话的客户端结束任务并释放对话，再点击重试；成功后恢复输入框、草稿和附件，由用户继续发送。

网页会在对话空闲时释放自身的占用，下一次发送时自动恢复。关闭页面后，已经提交的任务继续执行，结束后释放占用。独立 Codex 客户端的占用由对应客户端和后端管理，结束任务后仍被占用时，需检查该客户端是否继续加载对话。

为使空闲对话及时释放，本项目启动的 Codex 后端使用以下命令，将无订阅对话的回收延迟设为零：

```bash
codex -c thread_unload_delay_secs=0 app-server --listen ws://127.0.0.1:8765
```

已有 `codex-app-server.service` 会保留原配置。使用 `systemctl --user cat codex-app-server.service` 检查启动命令，在原 Codex 命令中加入 `-c thread_unload_delay_secs=0`，保留原可执行路径、代理、登录环境和监听地址。该参数在后端启动时生效。

调整已有后端后，先确认所有连接到该后端的客户端均已结束相关任务和终端，再执行：

```bash
systemctl --user daemon-reload
systemctl --user restart codex-app-server.service codex-lan-web.service
```

`codex-web service restart-when-idle` 检查网页服务观察到的任务和上下文整理。重启后端还需确认其他客户端以及网页终端、对话后台终端的运行状态。

## 本机 Claude 会话（本地扩展版）

侧栏同时列出 Codex 与 Claude 会话，可筛选后端；使用“新建 Claude 对话”选择工作目录、模型和思考强度。默认值沿用本机 Claude Code 配置；已有会话空闲时也可修改并点击“应用”，运行中完成当前任务后再修改。模型下拉菜单支持 Opus、Sonnet、Haiku 和默认配置，选择“自定义模型”可输入供应商支持的完整名称，思考强度是否支持由当前模型和接口决定。Claude CLI 默认从 `~/.local/bin/claude` 启动，也可在网页服务 `.env` 中设置 `CLAUDE_BIN` 为可执行文件绝对路径。需要先在服务用户下配置好 Claude Code 登录或中转接口。

Claude 与 Codex 使用独立连接和进程。网页托管的 Claude 会话在手机、电脑浏览器间共享，关闭浏览器不会停止任务；运行中可补充消息或停止，工具授权与提问在对话中处理。网页服务重启会结束其 Claude 子进程，已有落盘会话可以续聊；更新前使用空闲重启命令，它会同时等待 Claude 任务完成。

本机 `~/.claude/projects` 中的主会话历史会出现在列表中。未接入共享的 VS Code 插件或其他 Claude 进程持有的会话只读显示。重试只重新检查连接，不清空或重读全部历史；顶部刷新按钮会在保留当前内容的同时更新历史。网页会话空闲时可点击“释放会话”，之后再由 CLI 或 VS Code 续接。不要同时在另一个客户端对网页持有的会话使用 `--resume`，Claude CLI 本身不保证跨进程互斥。

Claude 输入草稿按会话保存在当前浏览器，暂停输入后自动保存；离开或刷新页面时补存最后的输入。

Claude 的网页会话索引默认保存在 `~/.local/state/codex-web/claude-sessions.json`，历史仍由 Claude Code 保存在自己的配置目录。`CLAUDE_CONFIG_DIR` 可指定独立 Claude 配置目录，`CLAUDE_WEB_STATE_FILE` 可覆盖网页索引路径。新建会话的工作目录必须是电脑上已存在的绝对路径。

当前 Claude 界面支持文字输入、历史图片显示、工具记录、授权和提问。Codex 专属的文件变更面板、目标管理、技能菜单和新附件上传未移植到 Claude 界面。搜索框、归档按钮与账户额度的 Codex 功能沿用原后端；Claude 会话使用自己侧栏中的搜索框。

与原项目一样，网页没有独立登录验证，仅在受信任的内网或受控 VPN 中开放端口。Claude 由网页启动时默认使用 Auto 自动审核模式；可切换 Manual 手动确认、自动编辑、Plan 计划、不询问或跳过权限确认。需审批的操作仍显示“允许本次／拒绝”。已在插件中运行的共享会话保留原模式，网页在空闲时点击应用才修改；旧版共享进程需要重新打开插件会话才能使用新增的模式切换。

### 与 VS Code Claude 插件共享同一进程

Claude Code 插件提供机器级设置 `claudeCode.claudeProcessWrapper`。将它设置为一个可执行启动脚本的绝对路径，脚本内容如下；将两个路径替换为本机 Node.js 和已安装 codex-web 包的实际绝对路径：

```sh
#!/bin/sh
exec /absolute/path/to/node /absolute/path/to/codex-web/bin/claude-shared.mjs "$@"
```

给脚本添加执行权限。新打开的插件会话通过它启动，网页打开同一会话后会显示“与插件共享”，两端可以发送、查看输出、停止任务、处理授权；网页可在空闲时应用模型、思考强度和权限模式。双方的工具授权以第一个回答为准。网页断开或网页服务重启只断开共享连接，不结束插件的 Claude 进程。

已运行的旧插件进程无法自动接入。等当前工作完成后，关闭并重新打开该插件会话一次，在网页点击重试。其他未使用该脚本启动的 CLI 会话仍按原来的占用规则处理。移除插件设置即可恢复默认启动方式，不要在任务运行时关闭插件。

共享通信使用 Claude 配置目录下 `web-bridges/` 中的本机 Unix socket，目录仅当前用户可访问；不增加对外监听端口，Claude 登录、代理、工具和权限参数由插件原样传入。

Claude 网页在当前浏览器保存最近一次查看的会话快照和最多 80 条会话索引，刷新先显示缓存，再后台校准完整历史。快照最多保留最近 300 条消息且限制大小，七天后不再读取；旧消息仍会从电脑端补齐。缓存不包含待审批请求，实际运行状态以重连结果为准。清除本站浏览器数据即可删除缓存；浏览器存储禁用或空间不足时仍可正常在线使用。

Claude 长会话向上翻阅后，可点击消息区底部的“回到最新消息”回到底部，并继续自动跟随新消息。

Claude 刷新时优先展示浏览器缓存的最近消息，首次显示即定位到底部；完整历史在后台读取完成后统一校准，不逐页插入到缓存末尾。向上翻阅仍可查看完整历史。

Claude 记录中自动生成的上下文整理摘要、系统注入消息与工具返回不会归为用户手动输入；摘要及系统消息在左侧默认折叠，点击可查看原文。升级后缺少来源标记的旧浏览器历史缓存会重新校准一次，草稿保留。

Claude 运行中补充的消息按原始记录位置恢复，使用原始消息 ID 与实时回放去重；相同文字但不同 ID 的真实重复提问会保留。后台任务通知作为系统消息折叠显示。

### 浏览器消息提醒

在设置中开启“离开标签页时提醒我”。Codex 与网页已连接的 Claude 会话在任务完成、失败或等待授权/回答时提醒；当前标签页可见时保持安静。提醒列表可点击返回对应会话，刷新或重新加载历史不会补发旧事件。选择仅保存在当前浏览器，同源多个标签页共享开启状态与事件去重。

系统通知需要 HTTPS 或本机 localhost，并由用户点击开启后授权。通过内网 HTTP IP 访问、浏览器不支持或拒绝权限时，使用页内提醒列表及标签标题计数。手机浏览器还受系统后台限制影响；本功能不使用 Web Push，网页关闭、断线或被系统挂起期间不保证送达，也不补发离线历史提醒。系统通知只显示后端、事件类型与会话标题，不包含命令、回答或错误详情。支持 Service Worker 的浏览器通过通知专用 Worker 显示系统通知，不缓存会话内容。

### Android 手机 ntfy 系统通知

设置 `NTFY_URL=https://ntfy.sh/随机长主题名` 和 `NTFY_WEB_URL=现有网页地址` 后重启网页服务。也可使用自己的 HTTPS ntfy 服务，并通过 `NTFY_TOKEN` 设置其访问令牌。Android 安装官方 ntfy App，订阅同一服务与主题，允许通知并解除后台电池限制；使用不带 Google 服务的手机时可在 ntfy 中启用即时投递/常驻连接。

服务器直接推送它接收到的 Codex 事件和已接入的 Claude 会话事件，支持完成、失败、待确认；手机切到其他 App 或网页关闭后仍可接收，不需要给网页增加 HTTPS 或暴露公网端口。独立客户端中未接入网页服务的会话不在此范围。推送发送失败会重试，队列与去重信息保存在 `~/.local/state/codex-web/ntfy.json`，超过一天的旧推送丢弃。服务重启后继续处理队列；离线期间未被后端接收到的事件不会从历史补发。

ntfy 服务会接收后端名称、事件类型和用于返回会话的链接，不发送聊天正文、标题或命令。匿名服务的主题名称是订阅凭据，应使用随机长名称且不要公开。点击通知打开内网网页仍需要手机连接对应网络/VPN。此推送独立于网页里的浏览器提醒开关，取消订阅可停止手机接收，删除 `NTFY_URL` 并重启服务可停止电脑发送。
