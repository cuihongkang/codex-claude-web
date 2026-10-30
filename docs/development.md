# 开发者指南

本文面向修改、测试和发布 Codex Web 的开发者。安装发行包及日常使用见 [README](../README.md)，运行配置和故障处理见[部署与维护](deployment.md)。实现设计见[架构说明](architecture.md)，版本选择和完整发布流程见[版本管理](versioning.md)。

## 本地环境与源码启动

开发环境需要 Linux、Node.js 24+、npm、已登录的 Codex CLI 和 `/usr/bin/zsh`。本项目使用根目录 npm workspaces 和单一 `package-lock.json` 管理前后端依赖。

克隆仓库后，在项目根目录安装依赖并创建配置：

```bash
git clone https://github.com/hjd-hitsz/codex-web.git
cd codex-web
npm ci
```

首次配置时，执行 `cp .env.example .env` 创建配置文件；已有 `.env` 时直接使用现有配置。源码命令从项目根目录 `.env` 加载环境变量，外部环境变量优先；配置项含义见[配置说明](deployment.md#配置)。

在不同终端分别启动后端、网页桥接和前端开发服务器：

```bash
# 终端一：已有后端监听配置中的地址时可复用
npm run start:backend
```

```bash
# 终端二：网页桥接服务
npm start
```

```bash
# 终端三：前端开发服务器
npm run dev
```

打开 Vite 输出的地址。开发服务器将 `/rpc`、`/healthz` 和 `/api/translate` 代理到网页桥接端口，模型调用和工具执行由 Codex 后端处理，摘要翻译由桥接直接调用远程翻译服务。

验证生产构建时，执行 `npm run build`，再通过网页桥接地址访问，默认 `http://127.0.0.1:8766`。生产服务直接读取 `client/dist`，前端更新后重新构建并刷新网页即可；桥接代码更新后需要重启网页服务。

## 项目结构

```text
bin/codex-web.mjs      全局命令入口和用户配置加载
client/
  src/                 前端组件、状态和 JSON-RPC 客户端
  tests/               消息、过程分组、翻译和权限策略测试
  vite.config.js       构建与开发代理
server/
  src/config.mjs       环境配置和默认目录
  src/server.mjs       HTTP、WebSocket 转发与终端恢复
  src/summary-translation.mjs  TranSmart 匿名 HTTP API 与本站翻译接口
  src/version.mjs      正式版本与 Git / 安装包构建来源
  tests/               配置和桥接集成测试
scripts/               后端启动、组件测试、systemd 安装及发布脚本
tests/components/      隔离环境中的实际 React 组件测试
docs/architecture.md   架构与协议实现
docs/deployment.md     使用者部署、配置与故障处理
docs/versioning.md     版本管理与发布流程
CHANGELOG.md           未发布变更与正式版本总览
package-lock.json      全项目依赖锁文件
```

前端采用 React，Node.js 桥接服务负责静态资源和 WebSocket JSON-RPC 转发。组件职责、状态流转、协议和生命周期约束见[架构说明](architecture.md)。

服务图标源文件为 `client/src/assets/codex-web.svg`。侧栏和欢迎页使用内联 SVG，浏览器标签页使用 `client/public` 中的 PNG、ICO 和触屏图标，通过本站独立路径读取。修改 SVG 后，在安装了 `gdk-pixbuf-thumbnailer` 的 Linux 环境中执行 `npm run icons:generate`，同步生成并提交兼容资源；普通构建与发行包安装直接使用这些资源。验证时同时检查浏览器实际请求的图标地址、响应类型及标签页显示，手机浏览器的验证独立于窄屏页面布局检查。

快捷命令的 CLI 对照、网页复用入口、专用能力边界及浏览器回归方法见[命令覆盖记录](cli-command-coverage.md)。

## 格式与验证

```bash
npm run format
npm test
npm run check
```

`format` 使用 Prettier 格式化项目。`test` 包含单元测试、隔离的桥接协议测试和 React 组件测试；`check` 依次执行版本一致性、格式检查、全部测试、生产构建和发行包安装测试。提交修改前执行 `npm run check`。

测试采用模拟后端，不消耗模型额度，也不修改真实聊天。协议或生命周期变更应补充对应回归测试；真实后端验证使用临时会话或明确的测试数据。各测试目录的覆盖范围见[架构说明中的测试章节](architecture.md#测试)。

批注浏览器回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/annotations.mjs`。脚本复制当前生产资源，在独立浏览器配置目录中使用模拟 WebSocket 历史，验证多批注草稿、悬浮编辑、缩放、窄屏、刷新恢复、失败重试及正文统一提交；截图和构建来源记录默认写入 `.cache/annotations-browser`，可通过 `BROWSER_OUTPUT_DIR` 指定目录。

视觉调整的浏览器检查使用生产构建与隔离的模拟历史，覆盖正文、代码块、工作过程、输入框草稿、右侧详情、设置弹窗及欢迎页。浅色、深色、跟随系统深色和窄屏分别核对文字对比度、选中状态、换行、控件位置及全宽布局。80%、100%、125%、150% 和 200% 缩放按物理窗口尺寸除以缩放倍数设置 CSS 视口，并同步设置设备像素比，检查发送按钮和底栏的可见性。修改前后采用相同数据和视口截图，图片及构建信息保存在 `.cache` 中。

账户额度浏览器回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/account-usage.mjs`。脚本注入隔离的 Pro 和 Plus 账户，核对默认圆环、账户行高度和单行重置信息，通过实际点击、Enter、空格、Esc 与外部点击验证详情收放；推进本地时钟并触发 30 秒倒计时回调，确认时间更新及后端请求数量。额度自动读取测试把 60 秒轮询缩短至 200 毫秒并按需启用，组件测试另行断言两个生产间隔。继续验证额度通知、接口失败、回到前台与设置页精简，覆盖浅色、深色、跟随系统深色、五档缩放、390px 窄屏和基础字号放大。截图及构建来源写入 `.cache/account-usage-compact-browser/after`。修改前先将旧 `client/dist` 与 `build-info.json` 复制到 `.cache/account-usage-compact-before/`，分别命名为 `dist` 与 `build-info.json`，再以 `BROWSER_BEFORE=1` 运行同一脚本，记录原有展开大卡片的对照结果。

README 的界面截图维护在 `docs/images/`：`desktop-light.png` 与 `desktop-dark.png` 使用相同演示数据和 1440 × 900 的桌面视口，`mobile.png` 使用 390 × 844 的手机视口及 2 倍设备像素比。更新截图前重新构建，在独立浏览器配置中使用隔离演示项目和模拟消息，实际打开文件预览、切换主题与布局；核对正文、变更汇总和输入框可见，并将构建来源与检查记录留在 `.cache`。README 通过 `picture` 随阅读环境切换桌面截图，手机截图放在可展开区域；更新后实际渲染 Markdown，检查图片、相对链接、折叠区域及窄屏排版。

Markdown HTML 回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/markdown-html.mjs`。脚本使用当前 README、仓库内图片和隔离演示消息，通过程序实际消息区与文件面板验证 HTML 排版、折叠块、图标尺寸、本地候选图、深浅主题与系统主题、文内导航、大图预览及焦点恢复；另核对脚本过滤和窄屏布局。截图与构建来源写入 `.cache/markdown-html-browser/after`。修改前将旧 `client/dist` 和 `build-info.json` 复制到 `.cache/markdown-html-before/`，以 `BROWSER_BEFORE=1` 运行同一脚本复现消息与文件预览直接显示 HTML 文字，结果写入 `before` 目录。组件回归包含安全属性过滤、代码原文、相对路径、候选图失败与迟到读取、实际 README，以及既有的公式、Mermaid 和批注测试。

工具记录浏览器回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/tool-activities.mjs`。脚本在独立浏览器配置中注入 `tests/fixtures/tool-activities.mjs` 的模拟历史，验证图片直接显示、点击放大与焦点恢复、搜索结果仅显示标题链接（缺少标题时显示网址）、搜索记录折叠与恢复、可读网页操作和工具结果，以及深浅主题、80% 至 200% 缩放与窄屏；截图和构建来源写入 `.cache/tool-activities-browser/after`。搜索结果精简的修改前对照先把 `client/dist` 与 `build-info.json` 分别复制到 `.cache/tool-activities-before/dist` 与 `.cache/tool-activities-before/build-info.json`，再用 `BROWSER_BEFORE=1` 运行同一脚本，确认搜索结果仍显示摘要及内部字段，结果写入 `before` 目录。

文件打开回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/files.mjs`，本机需有支持 H.264 编码的 `ffmpeg`。脚本生成临时音视频、PDF、BMP 和二进制样本，注入隔离的模拟历史，实际点击并验证播放、进度跳转、媒体切换后的资源清理、图片与 PDF 预览、文件下载字节、文本编辑和失败重试，覆盖深浅主题与窄屏。截图、下载样本和构建来源保存在 `.cache/file-preview-browser/after`。修改前对照将旧构建及来源复制到 `.cache/file-preview-before/dist` 与 `.cache/file-preview-before/build-info.json`，以 `BROWSER_BEFORE=1` 分别记录音频的二进制提示与 PDF 被当作源码显示的结果。`server/tests/file-content.test.mjs` 覆盖 MIME、附件文件名、原始字节、Range、大文件及取消读取；桥接测试验证 HTTP 路由，文件面板组件测试覆盖类型切换、保存保护、草稿与迟到读取隔离。

单独验证发行包时执行：

```bash
npm run test:package
```

该测试在临时 npm prefix 中全局安装打包产物，检查命令入口、静态资源、构建来源、用户配置和服务生成。后端与服务管理命令使用模拟实现。安装优先复用 npm 缓存，缺少包元数据或依赖时访问配置的 registry，因此执行环境需要相应缓存或网络连接。

## 从源码运行后台服务

在项目根目录执行：

```bash
npm run build
npm run service:install
npm run service:status
```

安装脚本创建用户级 `codex-lan-web.service`，直接运行当前项目中的桥接服务。已有 `codex-app-server.service` 保留代理、环境和启动设置；缺失时创建后端服务。被覆盖的网页服务配置备份到用户状态目录下的 `codex-web/service-backups`。

仅修改前端时重新构建并刷新网页。修改桥接后，通过以下命令等待任务与上下文整理结束再重启：

```bash
npm run service:restart-when-idle
```

确认任务与终端均已结束时，也可使用 `npm run service:restart`。终端状态和输出保存在桥接进程中，重启前应保护运行中的工作。迁移源码目录后，先重新安装服务以更新路径，再重启。

空闲判断只使用连接就绪状态、对话轮次与上下文整理占用。打开的网页终端与任务分别处理，等待程序只执行网页服务重启。日志在等待数量改变时更新，重启后检查 `/healthz` 并报告实际运行版本；自动化交付还需核对 `lan/state` 的所需接口。`server/tests/restart-when-idle.test.mjs` 在临时目录提供模拟 systemctl 与 HTTP/WebSocket 服务，验证终端保持打开、任务和整理占用、等待期间新轮次、健康检查重试及重启失败，不操作真实服务。

源码部署与全局安装使用相同服务名，同一用户使用一套部署。从源码切换到全局包时，将项目 `.env` 中需要保留的配置迁移到用户配置目录，再按[发行包安装说明](deployment.md#安装发行包)更新服务。

桥接静态资源路由发生变化时，构建前端后还需重启网页服务。增加按需加载模块时，同时验证生产资源路由与发行包内的 JavaScript、CSS 分块。

## 打包与发布

项目通过 GitHub Release 分发预构建 npm 安装包。手动构建发行包时执行：

```bash
npm ci
npm run check
npm pack
```

`npm pack` 的 `prepack` 会重新构建网页并生成 `codex-web-X.Y.Z.tgz`，其中 `X.Y.Z` 为根包版本。`package.json` 的 `files` 白名单包含命令行入口、前端构建资源、构建来源、桥接代码与运行脚本；开发源码、测试、聊天数据和实际环境配置在包外。运行依赖由目标机器上的 npm 安装。

日常开发保持包版本，有实际影响的变化先记入 [CHANGELOG.md](../CHANGELOG.md) 的“未发布”。准备发布时按批次选择版本：

```bash
npm run version:check
npm run version:prepare -- minor
```

`version:prepare` 同步包版本、锁文件、变更日志和 README、部署文档中的安装链接，并生成待审阅的发布说明。发布说明面向第三方使用者，只用简短条目说明新增可用能力、具体操作改善和可见问题修复，合并同一功能的相关修改并保留提交链接。回归测试、内部重构、协议适配、构建工具及发布流程维护等开发工作记入提交记录；安装、升级和使用内容统一维护在 README 或部署文档。版本确定后，检查、推送或上传失败均保留该版本并修复重试。

`.github/workflows/release.yml` 在推送版本标签后检查并准备 Release。工作流使用仓库的 `GITHUB_TOKEN` 和 `contents: write` 权限，将 npm 包与 SHA-256 文件完整上传到同版本草稿，并下载验证校验和、版本来源及临时全局安装。已配置定时发布的版本保持草稿，由独立的持久调度任务在目标时间主动触发 `.github/workflows/scheduled-release.yml`，GitHub cron 提供补偿检查；其他版本直接发布。持久任务须在实际非交互环境中验证调用与结果检查，并记录下次触发时间、失败重试和日志；具体建立与验收流程见[定时发布](versioning.md#定时发布与正文同步)。两个工作流共用发布并发组。独立发布说明保留一级标题，GitHub Release 正文仅上传变更列表；修改说明后，默认分支工作流同步已有 Release 的正文。发布前需在实际标签的 `GITHUB_REF_NAME` 环境下执行完整检查。标签、定时时间、附件验证及同版本重试步骤统一见[版本管理](versioning.md#准备和发布)。

如需改为 npm registry 分发，维护者需先取得包名发布权限并完成 npm 身份验证，再用实际版本替换以下 `X.Y.Z`：

```bash
npm publish ./codex-web-X.Y.Z.tgz --access public
```

发布成功后，使用者可通过包名安装。选择作用域包名时，先修改根 `package.json` 的 `name` 并更新锁文件，再重新验证和打包；全局命令名仍为 `codex-web`。

## 构建来源

版本来源的生成机制、开发构建标识和正式发布身份见[版本管理](versioning.md#正式版本与开发构建)。网页来源在构建时固定，源码桥接来源在进程启动时固定；排查更新时分别核对网页“设置 → 关于”和 `/healthz` 中的信息。

## Claude 本地扩展验证

`server/tests/claude-sessions.test.mjs` 使用模拟子进程验证独占进程、外部占用、历史读取、授权、中断和释放；默认测试不会操作真实 Claude 会话。

真实浏览器测试使用隔离的模拟会话：

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROME_PATH=/path/to/chromium \
node tests/browser/claude.mjs
```

测试覆盖两种后端在同一侧栏展示、完整历史分页、外部会话只读、授权、两个浏览器共享进程、停止、刷新恢复草稿及手机布局，截图写入 `.cache/claude-browser/`。可用 `BROWSER_OUTPUT_DIR` 指定截图目录。`BASELINE_ONLY=1 STATIC_TEST_DIR=/path/to/old/client/dist` 可生成原版本的隔离基线截图。

`tests/fixtures/claude-live-probe.mjs` 和 `claude-control-probe.mjs` 是手动启用的真实接口验证，会调用本机 Claude、创建专用临时会话并消耗少量模型额度，不属于默认测试。后者只测试临时目录中的一个文件和运行中取消；不会续接既有用户会话。
