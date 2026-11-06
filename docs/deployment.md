# 部署与维护

本文面向安装和运行 Codex Web 的使用者，说明发行包安装、配置、服务管理、升级与故障处理。界面预览与快速开始见 [README](../README.md)。

## 安装发行包

预构建 npm 安装包通过 [GitHub Releases](https://github.com/hjd-hitsz/codex-web/releases) 分发。在已配置 Node.js 24+、npm、Codex CLI、OpenSSL、Linux PAM、`pamtester`、`/usr/bin/zsh` 和 systemd 的 Linux 电脑上，以运行 Codex 的普通用户完成本机 Codex 登录，然后执行：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v3.1.1/codex-web-3.1.1.tgz
codex-web service install
loginctl enable-linger "$USER"
codex-web service status
curl --cacert "${CODEX_WEB_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/codex-web}/tls/certificate.pem" https://127.0.0.1:8766/healthz
```

`service install` 创建缺失的后端服务并安装网页服务，启用两者的自启动；已有后端服务继续使用原配置。`enable-linger` 使用户服务可在开机后、登录前启动，是否需要管理员操作由系统授权策略决定。npm 全局命令所在目录需在 `PATH` 中，目标电脑的防火墙需允许访问网页端口。

默认网页地址为 `https://电脑IP:8766`，本机可使用 `https://127.0.0.1:8766`。网页登录使用运行服务的系统账户，成功后沿用本机 Codex 授权，以服务用户的完全访问权限执行任务。访问和登录均使用加密连接。

### 下载后安装与校验

也可以下载或复制 Release 中的 `codex-web-3.1.1.tgz` 和 `codex-web-3.1.1.tgz.sha256` 到同一目录，然后执行：

```bash
sha256sum -c codex-web-3.1.1.tgz.sha256
npm install -g ./codex-web-3.1.1.tgz
codex-web service install
```

安装使用 Release 的 `.tgz` 附件。安装过程中，npm 会获取运行依赖，目标电脑需具备相应缓存或能访问配置的 npm registry。

文件差异与撤销校验需要服务环境能够运行 `git`。文件变更汇总也支持 Git 仓库以外的目录；“撤销”遇到后续修改冲突时会保留当前文件。升级后先等待当前任务和网页终端结束，再重启网页服务并刷新页面，以使用更新后的功能。

## 计划与执行

计划模式先调查需求并给出完整方案，支持继续提交修改意见。方案完成后可批准执行，批准成功后自动回到执行模式；发送失败时保留方案供重试。刷新后恢复方案和待批准状态，底部未发送草稿与附件在批准时保持独立。计划调查、修改和批准后的执行均使用当前选择的模型，并计入该模型的正常用量。

## HTTPS 与系统登录

系统登录需要 Linux PAM 与 `pamtester`。Debian / Ubuntu 可由管理员安装：

```bash
sudo apt-get install pamtester openssl
```

网页登录只允许运行 Codex Web 的系统账户，使用该账户的系统密码。账户须有可用密码，且处于允许登录的状态。默认使用系统的 `login` PAM 服务，管理员可通过 `AUTH_PAM_SERVICE` 指定专用策略。仅配置 SSH 密钥、没有可用系统密码的账户，需要先在系统中设置密码。网页服务继续以普通用户身份运行。

登录状态默认保留 30 天，`AUTH_SESSION_DAYS` 可设为 1～90 天。刷新网页、重新打开浏览器或重启服务后，有效登录会自动恢复。退出会让同一浏览器的所有标签页返回登录页面，其他设备继续保持登录。到期或清除浏览器 Cookie 后需要重新登录。未发送草稿保留在原浏览器，已经提交的任务继续运行。

### 证书配置

未指定证书时，首次启动生成一年有效的本站证书，保存在 `CODEX_WEB_CONFIG_DIR/tls`（默认 `~/.config/codex-web/tls`）。证书包含 localhost、当前主机名及生成时的本机 IP，私钥仅服务用户可读。首次访问前，在服务电脑查看指纹，并与浏览器显示的证书核对，再按设备的证书管理方式安装该证书：

```bash
openssl x509 -in "${CODEX_WEB_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/codex-web}/tls/certificate.pem" -noout -fingerprint -sha256
```

登录页和“设置 → 网页登录”中的“浏览器证书安装”提供证书下载与 Ubuntu、Windows、macOS、iPhone/iPad、Android 安装步骤。先向管理员核对证书，再下载并安装到用于访问的设备上。安装后重新打开浏览器，确认地址栏的证书警告消失，再输入登录密码。

Ubuntu 上，在文件管理器中打开证书下载目录，右键选择“在终端打开”。将下载的 DER 格式证书转换为 PEM 格式并安装到系统信任库，按提示输入本机管理员密码：

```bash
openssl x509 -inform DER -in codex-web.cer -out codex-web.crt
sudo install -m 644 codex-web.crt /usr/local/share/ca-certificates/codex-web.crt
sudo update-ca-certificates
```

重复下载时请核对实际文件名。完全退出浏览器后重新访问；Chrome / Chromium 仍有警告时，在“设置 → 隐私和安全 → 安全 → 管理证书”的自定义或受信任证书中导入 `codex-web.crt`。Firefox 可在“设置 → 隐私与安全 → 证书 → 查看证书 → 证书颁发机构”中导入，并信任此证书以标识网站。浏览器版本不同，入口名称可能略有差异；完成后重启浏览器并检查证书警告。

首次证书警告发生在网页打开之前。核对证书后，可通过浏览器的“高级 → 继续访问”进入下载页面；浏览器没有继续入口时，请管理员直接提供证书。证书更新后，各设备需要重新核对并安装。使用证书机构签发的证书仍有警告时，请管理员检查证书配置或提供所需的信任证书。

也可在网页配置文件中指定受浏览器信任的证书链与私钥：

```dotenv
TLS_CERT=/absolute/path/to/fullchain.pem
TLS_KEY=/absolute/path/to/privkey.pem
AUTH_SESSION_DAYS=30
```

两项证书路径须同时设置，并允许服务用户读取；私钥权限应设为 600。域名、IP 或证书有效期变化时更新证书并在空闲时重启网页服务。需要重新生成自动证书时，在服务停止后将整个 `tls` 目录移至备份位置，再启动服务；客户端需重新核对和信任新证书。

网页端口只接受 HTTPS。旧的 HTTP 书签应改为 HTTPS；切换地址前，请先保存旧页面中的未发送草稿；新地址会单独保存浏览器偏好。使用域名反向代理时，浏览器到代理及代理到网页服务两段都使用 TLS，代理应验证上游证书，并保留原始 Host、Origin 和 WebSocket 升级头。Codex 后端的 `ws://` 仅限本机回环地址，跨主机后端必须使用 `wss://`。

### 登录故障

用户名或密码错误、账户锁定或到期时，请确认用户名、密码和账户状态。提示“登录暂不可用”时，由管理员检查 `pamtester` 是否安装及服务日志。非标准安装路径可通过 `AUTH_PAMTESTER=/absolute/path/to/pamtester` 指定。尝试次数过多时，请按页面提示稍后重试。

## 命令与前台运行

- `codex-web` / `codex-web start`：前台运行网页服务，连接已启用的 Codex 和 Claude Code。
- `codex-web backend`：前台运行 Codex app-server。
- `codex-web config init`：创建用户 `.env`，显示配置路径并保留已有文件。
- `codex-web --version` / `codex-web version --json`：查看版本或完整的版本来源信息。
- `codex-web service install`：安装或更新服务文件，启动尚未运行的服务。
- `codex-web service status`：查看网页与后端状态。
- `codex-web service start` / `stop` / `restart`：启动、停止或重启网页服务；启动网页时也会拉起后端，停止网页时后端继续运行。
- `codex-web service restart-when-idle`：等待当前任务和上下文整理结束后重启网页，打开的网页终端保持独立。

前台运行时，在两个终端分别执行 `codex-web backend` 和 `codex-web`，并保持终端打开。已有可连接的后端时，直接运行 `codex-web`。

## Claude Code 与模型配置

除默认 Codex 外，可在设置的“模型与服务配置”中启用 Claude Code。选择本机已安装的 Claude Code 可执行文件，沿用其现有原生配置目录；默认使用 `CLAUDE_CONFIG_DIR`，未设置时为 `~/.claude`。网页服务使用其系统账户启动程序，复用已有认证、技能、插件和历史。Codex 同样沿用现有 `CODEX_HOME`（默认 `~/.codex`）。

在 Claude Code 的“供应商与模型”中添加服务名称、API 地址、凭据和模型标识。多个供应商共用此 Claude Code 后端。在输入框的模型菜单选择“供应商 · 模型”，新对话会使用对应后端；已有 Claude 对话可在任务结束后更换供应商或模型并继续。

API 地址需支持 Messages 请求及工具调用，填写服务基地址，例如 `https://model.example`，请求路径会追加 `/v1/messages`；服务有统一路径前缀时将其保留在基地址中。按服务提供的接口选择标准 Messages 或 Anthropic 协议。模型标识和支持的思考强度、速度档位以服务实际配置为准。API Key 保存在服务器，编辑时留空保留原凭据，勾选清除会移除已保存凭据。

自定义模型可填写可选的显示别名，留空沿用原名称。别名随供应商配置保存在服务器，其他浏览器连接同一服务后使用相同名称，实际调用使用原始模型标识。

自定义模型可在“模型参数”中填写上下文容量，单位为 tokens。填写模型服务当前实际加载的容量，模型说明中的最大支持容量用于核对服务配置；重新加载模型并调整容量后，同步更新此值。网页底部的上下文用量采用当前对话的原生计量。

Claude Code 的对话、配置和原生账户状态继续保存在本机 CLI 原有目录。使用原生账户时，沿用本机 CLI 的认证；使用外部供应商时，任务使用网页配置的地址、凭据和模型。账户行按当前对话显示身份：原生账户可显示服务返回的额度窗口及额外用量，外部供应商显示外部计费状态。账户额度读取失败可重试，对话和文件操作继续使用各自的连接状态。

两个后端均提供文件浏览、编辑、文件和目录模糊查询及网页终端。Claude Code 同样提供计划与批准、代码审查、目标、后台终端清理、分支与消息编辑；原生技能、命令、插件和工具连接按当前工作目录加载。后台终端由 `/stop` 查看和停止，聊天区停止按钮中断当前轮次。切换供应商或修改配置前，先结束当前任务及需要继续保留的后台终端。

`/init` 检查并保留当前目录已有的 `AGENTS.md`，缺少时生成项目指令。Claude Code 每次提交读取当前目录及祖先目录的 `AGENTS.override.md` 或 `AGENTS.md`，同目录优先 override，更具体目录的规则优先；文件修改和删除从下一轮生效。已有的 `CLAUDE.md` 继续生效。

后端和供应商配置默认保存至 `CODEX_WEB_CONFIG_DIR/backends.json`，可通过 `CODEX_WEB_BACKENDS_FILE` 指定文件位置。配置包含固定的 `codex`、`claude` 两项，各自支持启停，并指向本机 CLI 的实际程序和原生配置目录。保存配置前等待所属后端的任务结束。

## 配置

全局命令从 `~/.config/codex-web/.env` 读取配置；设置 `XDG_CONFIG_HOME` 时使用其下的 `codex-web` 目录，设置 `CODEX_WEB_CONFIG_DIR` 时优先使用该目录。外部环境变量优先于 `.env`。执行 `codex-web config init` 可创建配置并显示路径，已有配置和 npm 升级后的配置均会保留。

systemd 服务会记录安装时的配置目录，后续启动继续使用该目录。更换配置目录时，用新的 `CODEX_WEB_CONFIG_DIR` 执行 `codex-web service install`，再按下文方法重启网页服务。

- `HOST`：HTTPS 监听地址，初始为 `0.0.0.0`，支持通过电脑 IP 访问；仅本机访问可设为 `127.0.0.1`。
- `PORT`：网页端口，初始为 `8766`。
- `CODEX_APP_SERVER_URL`：Codex 后端 WebSocket 地址，初始为 `ws://127.0.0.1:8765`；使用已有后端时填写其实际地址。
- `CODEX_WEB_CONFIG_DIR`：Codex Web 自身配置与状态目录，默认 `$XDG_CONFIG_HOME/codex-web`，未设置 `XDG_CONFIG_HOME` 时为 `~/.config/codex-web`。连接设置、网页登录、证书、项目选择和网页索引统一保存在其中。
- `CODEX_HOME`：本机 Codex CLI 已使用的配置目录，默认 `~/.codex`。
- `CLAUDE_CONFIG_DIR`：本机 Claude Code CLI 已使用的配置目录，默认 `~/.claude`。
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
curl --cacert "${CODEX_WEB_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/codex-web}/tls/certificate.pem" https://127.0.0.1:8766/healthz
```

自定义网页端口时，相应替换健康检查地址。`/healthz` 在至少一个已启用后端就绪时返回 HTTP 200，全部后端未就绪时返回 HTTP 503；响应包含连接状态 `ready` 和正在运行的网页服务版本 `version`。

### Claude Code 执行服务

Claude Code 的任务使用独立执行服务。关闭网页、重启网页服务或网页服务异常退出后，已提交的对话任务和后台终端继续运行，重新打开网页后恢复状态。网页交互终端仍由网页服务管理，重启前先保存其需要保留的工作。

使用 systemd 用户服务部署时，Claude Code 首次启用后自动建立名称为 `codex-web-claude-<标识>.service` 的执行服务，其中标识由 Codex Web 保存的 Claude 执行状态目录确定。查看状态与日志：

```bash
systemctl --user list-units --all 'codex-web-claude-*'
journalctl --user -u 'codex-web-claude-*' -n 100 --no-pager
```

修改 Claude Code 运行配置或升级程序后，新网页服务自动核对执行服务。仍有对话、提问、整理或后台任务时继续使用原服务，空闲后完成更新。需要完全停止或更换执行服务时，先结束任务、处理待答提问并通过 `/stop` 清理后台终端；普通网页重启只重新连接。前台运行且没有 systemd 用户管理器时，执行服务日志保存在 `CODEX_WEB_CONFIG_DIR/backends/claude/worker.log`。

## 升级和回退

从目标版本的 Release 获取安装地址。当前版本的安装与服务更新命令为：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v3.1.1/codex-web-3.1.1.tgz
codex-web service install
codex-web service restart-when-idle
```

最后一个命令等待网页服务观察到的任务和上下文整理结束后自动重启，等待期间保持命令运行。Claude Code 独立执行服务继续保留后台任务，代码及配置更新在该服务完全空闲后完成。打开或隐藏的网页终端不会阻塞更新，等待程序只重启网页服务。切换 Node.js 版本或 npm prefix 后，也需重新安装服务并重启，以更新服务中的安装路径。

日志显示实际等待的任务与上下文整理数量；执行重启后继续检查 `/healthz`，连接就绪时报告实际运行版本，重启或健康检查失败时保留失败状态。

升级后刷新网页，在“设置 → 关于”核对产品版本。`codex-web version --json` 查看当前磁盘安装包，`/healthz` 中的 `version` 查看实际运行的服务，便于确认重启是否生效。

需要回退程序时，使用目标旧版本 Release 的 `.tgz` 安装地址重新安装，执行 `codex-web service install`，再等待空闲后重启。用户配置继续保留；涉及配置或数据迁移的版本，先查看对应发布说明。

服务安装会备份被覆盖的网页服务文件，默认位置为 `~/.local/state/codex-web/service-backups/时间戳/`；设置 `XDG_STATE_HOME` 时采用其下的对应目录。回退服务路径时，将备份的 `codex-lan-web.service` 恢复到用户服务目录，默认 `~/.config/systemd/user/`；设置 `XDG_CONFIG_HOME` 时使用其下的 `systemd/user/`。执行 `systemctl --user daemon-reload`，确认原安装路径仍可用，再等待空闲后重启网页服务。

## 数据保存与迁移

- Codex 和 Claude Code 的原生对话、配置及登录凭据继续由各自 CLI 管理。网页对话索引和供应商设置保存在 `CODEX_WEB_CONFIG_DIR`；迁移网页时保留该目录，并将后端连接指向本机 CLI 的实际配置目录。网页登录与模型服务认证分别管理，系统密码仅用于登录验证，不会保存。
- 草稿、置顶、固定文件夹、项目快捷列表和主题保存在当前浏览器中。固定文件夹在全部对话归档后仍会在刷新或重新打开网页时显示；手动添加的项目自动固定，取消固定后在下次加载时按未归档对话重新确定是否显示。使用同一浏览器及站点地址可恢复固定记录，清除站点数据会清除这些记录。
- Codex 每个项目上次选择的模型和思考强度保存在服务所在电脑的 `CODEX_WEB_CONFIG_DIR/project-models.json`。Claude Code 项目选择保存在 `CODEX_WEB_CONFIG_DIR/backends/claude/project-models.json`，迁移服务时分别保留。同项目新建沿用当前选择，跨项目及重新打开网页时恢复目标项目设置，清空浏览器数据后可再次从服务端读取。保存失败时会提示重试。切换模型时保留当前思考强度，目标模型缺少该档位时采用最近的可用档位，距离相同时选较低档。
- “未分类”对话的文件保存在 `CODEX_WEB_CONFIG_DIR/workspaces/chat-XXXXXX`，首次发送时分配。迁移电脑时随 Codex Web 配置目录一起保留。
- 网页配置 `.env` 与新建后端服务使用的 `.env.backend` 位于用户配置目录，迁移时应一并保留；已有后端服务的配置按原部署方式迁移。
- 摘要翻译由服务所在电脑调用免费、免认证的 TranSmart 服务，浏览器仅访问当前网页服务；待译摘要会发送至 TranSmart，代码、路径和链接在发送前替换为占位符。
- 自动对话标题使用 Codex 模型，会产生少量额外模型用量。

## 故障定位

网页不可访问时，先检查网页服务状态、监听端口和主机网络。网页可打开但显示后端未连接时，按当前对话所属服务检查 Codex 后端日志与监听地址，或 Claude Code 可执行文件、原有配置目录和供应商连接。列表中某个后端读取失败时，已有对话会继续显示，按实际错误处理后点击重试。

账户额度会自动更新。若额度变灰并显示“待更新”，可稍后重试并检查网络连接。恢复连接后会自动更新。外部供应商的账单及余额在所属服务中核对；输入区的上下文用量反映当前对话占用，与账户额度分别显示。

Claude Code 请求失败时，错误提示显示认证、额度、连接或接口协议等实际问题，并可展开诊断详情。检查并修改对应供应商配置后，可以编辑失败消息重新提交。模型执行期间的草稿和附件继续保留。

摘要翻译失败时，页面保留原文并提供重试入口。检查服务所在电脑能否访问 `transmart.qq.com`，以及翻译服务是否正常响应。升级后翻译仍不可用时，等待任务与网页终端结束，再重启网页服务。

### 对话被占用

提示对话被占用时，先在另一个 Codex 窗口中结束该对话的任务并关闭对话，再返回网页点击“重试”。恢复后可继续编辑和发送，原有草稿及附件会保留。

网页会在对话空闲时释放自身的占用，下一次发送时自动恢复。关闭页面后，已经提交的任务继续执行，结束后释放占用。独立 Codex 客户端的占用由对应客户端和后端管理，结束任务后仍被占用时，需检查该客户端是否继续加载对话。

为使空闲对话及时释放，本项目启动的 Codex 后端使用以下命令，让无人使用的对话及时解除占用：

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
