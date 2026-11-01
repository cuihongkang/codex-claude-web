# 开发者指南

本文面向修改、测试和发布 Codex Web 的开发者。安装发行包及日常使用见 [README](../README.md)，运行配置和故障处理见[部署与维护](deployment.md)。实现设计见[架构说明](architecture.md)，版本选择和完整发布流程见[版本管理](versioning.md)。

## 本地环境与源码启动

开发环境需要 Linux、Node.js 24+、npm、OpenSSL、Linux PAM、pamtester、已登录的 Codex CLI 和 `/usr/bin/zsh`。本项目使用根目录 npm workspaces 和单一 `package-lock.json` 管理前后端依赖。

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

打开 Vite 输出的 HTTPS 地址。Vite 与桥接复用证书，代理验证桥接证书；本地开发同样使用系统账户登录。开发服务器将 `/rpc`、`/healthz` 和 `/api` 代理到网页桥接端口，模型调用和工具执行由 Codex 后端处理，摘要翻译由桥接直接调用远程翻译服务。

验证生产构建时，执行 `npm run build`，再通过网页桥接地址访问，默认 `https://127.0.0.1:8766`。生产服务直接读取 `client/dist`，前端更新后重新构建并刷新网页即可；桥接代码更新后需要重启网页服务。

## 项目结构

```text
bin/codex-web.mjs      全局命令入口和用户配置加载
client/
  src/app/             页面布局、侧栏、登录和弹窗
  src/application/     状态容器、用例和请求生命周期
  src/domain/          消息、历史、排序、差异和命令规则
  src/infrastructure/  RPC、存储、翻译和浏览器适配
  src/features/        按功能组织的界面与交互
  src/ui/              基础控件与纯展示
  src/styles/          有序加载的职责样式模块
  tests/               消息、过程分组、翻译和权限策略测试
  vite.config.js       构建与开发代理
server/
  src/config.mjs       环境配置和默认目录
  src/server.mjs       进程启动与依赖组装
  src/application.mjs  HTTPS/WSS 应用生命周期
  src/http/            HTTP 路由与静态资源
  src/bridge/          请求、事件、订阅与后端连接
  src/summary-translation.mjs  TranSmart 匿名 HTTP API 与本站翻译接口
  src/version.mjs      正式版本与 Git / 安装包构建来源
  tests/               配置和桥接集成测试
scripts/               后端启动、组件测试、systemd 安装及发布脚本
shared/                跨端纯逻辑和传输限制
tests/components/      隔离环境中的实际 React 组件测试
tests/helpers/         认证、桥接和输入事件等测试夹具
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

长对话切换回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/history-performance.mjs`。脚本使用生产构建、独立浏览器和 15 轮、3,210 条记录、33 页的隔离历史，每页模拟 50 毫秒往返；记录首屏和完整恢复耗时，验证最近消息及输入先可用、自动完整分页、普通状态更新复用 Markdown、读取期间草稿与实时更新保留、历史前插时的阅读位置、目录跳转和快速切换隔离，覆盖深浅主题、80% 至 200% 缩放及窄屏。证据与构建来源保存在 `.cache/history-performance/after`。修改前的构建及来源分别保存为 `.cache/history-performance-before/dist` 和 `build-info.json`，以 `BROWSER_BEFORE=1` 记录同机对照，耗时用于比较同机行为。单元及组件回归同时验证旧接口完整轮次回退、分页失败后的可读记录与重试、实时结果优先及切换隔离。现有 README 图片展示完整加载后的界面，布局和内容继续适用。

侧栏收纳回归执行 `SIDEBAR_DENSITY=1 CHROME_PATH=/path/to/chromium node tests/browser/project-pins.mjs`，使用隔离的 Atlas/Beacon 与最近有活动的未分类对话、超过 60 条的后端分页，验证未分类始终位于末尾、固定与未固定的默认收放、每组最新五条、全部展开及收起、刷新重置、键盘操作、深浅主题、80% 至 200% 缩放和手机布局。截图与构建信息保存在 `.cache/sidebar-density-browser/after/`。旧构建及来源位于 `.cache/sidebar-density-before/`，追加 `SIDEBAR_DENSITY_BEFORE=1` 保存旧版全部展开的对照截图。

固定文件夹回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/project-pins.mjs`。脚本使用生产构建、隔离浏览器与模拟 Atlas/Beacon 对话，实际点击图钉和归档按钮，验证固定后全部归档、刷新恢复、空项目新建、取消固定、草稿与同类项目顺序保留、键盘操作、深浅主题及手机布局，结果和截图写入 `.cache/project-pins-browser/after/`。旧构建及来源保存在 `.cache/project-pins-before/dist` 与 `.cache/project-pins-before/build-info.json`，通过 `BROWSER_BEFORE=1` 复现重新加载后空文件夹消失，保存对照截图。取消固定的鼠标与键盘焦点回归同时核对图钉及加号的实际透明度：鼠标移开后隐藏，Tab 聚焦时显示；固定状态仅常显图钉，加号在点击新建对话并移开鼠标后隐藏。通过 `PIN_VISIBILITY_BEFORE=1` 读取 `.cache/project-pin-visibility-before/` 保存的构建及来源，复现鼠标点击保留焦点导致按钮常显，结果保存到 `.cache/project-pins-browser/visibility-before/`。固定记录复用 `cx-projects`，已有手动项目继续保留。README 的桌面及手机侧栏图片使用当前生产构建重新生成。

项目模型偏好回归执行 `CHROME_PATH=/path/to/chromium node tests/browser/project-models.mjs`，使用生产构建、隔离的 Atlas/Beacon 项目与模拟后端，通过模型选择框和强度滑块的键盘操作验证保留强度、最近档位、项目切换、刷新恢复及实际发送参数，保存桌面深浅主题和手机截图。修改前的构建及来源分别保存在 `.cache/project-model-before/dist` 和 `.cache/project-model-before/build-info.json`，以 `BROWSER_BEFORE=1` 复现切换模型重置强度；执行证据写入 `.cache/project-model-browser/`。组件回归同时覆盖历史及迟到恢复、未分类隔离和选择目录时保留草稿附件。README 图片使用当前生产构建重新生成，并通过 Markdown HTML 浏览器回归检查加载与排版。

同项目新建与服务端保存回归增加 `PROJECT_MODEL_SERVER=1`，从历史恢复一个不同于配置默认值的模型和强度，在尚未手动调整时点击右上角新建，断言完整保留当前选择。测试通过临时 `CODEX_HOME` 和实际项目存储模块写入文件，清空浏览器存储后重新加载，并重新创建存储实例核对项目设置。结果写入 `.cache/project-model-server-browser/`；修改前构建与构建来源保存到 `.cache/project-model-server-before/`，配合 `BROWSER_BEFORE=1` 复现回退到配置值。服务端单元及桥接测试覆盖跨项目连续写入、重建恢复、跨连接同步、旧缓存补齐、无效输入和损坏文件保护；组件测试覆盖保存失败重试及当前选择优先。

```bash
npm run format
npm run architecture:check
npm test
npm run check
```

`format` 使用 Prettier 格式化项目。`architecture:check` 检查生产源码单文件 500 行上限、导入完整性、循环和分层依赖；`test` 包含单元测试、隔离的桥接协议测试和 React 组件测试；`check` 依次执行版本一致性、架构检查、格式检查、全部测试、生产构建和发行包安装测试。提交修改前执行 `npm run check`。

`.github/workflows/check.yml` 对分支推送和 PR 执行同一完整检查，使用只读仓库权限；同一引用有新检查时取消旧运行。发布工作流在版本标签上独立重复完整检查。

状态容器和 RPC 客户端的单元回归分别位于 `client/tests/application-state.test.js` 和 `client/tests/rpc-client.test.js`。服务应用生命周期回归位于 `server/tests/application.test.mjs`，使用临时 HTTPS 服务验证实例缓存隔离、监听失败和关闭后连接清理。组件总入口 `tests/components/client.mjs` 只组织夹具和场景，新增场景放入对应模块；桥接订阅、写入与整理分别维护测试文件并复用 `tests/helpers/bridge.mjs`。

分支标题回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/fork-titles.mjs`。脚本使用隔离模拟历史和生产构建，实际点击回复分支按钮与侧栏菜单，验证兼容客户端编号、连续分支到两位数、刷新恢复、深浅主题及手机侧栏；截图和构建信息保存到 `.cache/fork-titles-browser/after`。修改前将旧 `client/dist` 与 `build-info.json` 复制到 `.cache/fork-titles-before/`，以 `BROWSER_BEFORE=1` 运行同一脚本，复现后缀逐次叠加并保存对照截图。单元与组件测试另覆盖旧后缀、手动改名、独立同名对话、60 字符截断、归档分页和筛选外编号。README 的现有演示图片未展示分支标题，相关图片继续使用既有演示内容。

测试采用模拟后端，不消耗模型额度，也不修改真实聊天。协议或生命周期变更应补充对应回归测试；真实后端验证使用临时会话或明确的测试数据。各测试目录的覆盖范围见[架构设计中的验证章节](architecture.md#7-可执行约束与验证)。

输入性能回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/composer-performance.mjs`。脚本使用独立浏览器配置和模拟 WebSocket，载入 60 轮 Markdown 历史及 31 个侧栏对话，通过浏览器输入事件一次写入大段文字并连续补充，记录输入事件到下一绘制帧的耗时和 React 历史渲染次数；断言输入期间历史渲染次数为零，耗时作为同机对照记录。继续验证组合输入、Enter 换行、刷新恢复、发送失败与等待期间继续编辑，保存桌面深浅主题和窄屏截图。结果和构建来源保存在 `.cache/composer-performance/after`；修改前将 `client/dist` 与 `build-info.json` 复制到 `.cache/composer-performance-before/`，分别保存为 `dist` 与 `build-info.json`，以 `BROWSER_BEFORE=1` 运行同一脚本记录历史随输入重渲染的对照结果。`tests/components/composer-performance.mjs` 独立验证共享快照引用、渲染次数、即时发送值、持久化、草稿清理与对话切换。此修复保留界面布局，README 及其他文档引用的现有截图仍与页面一致。

批注浏览器回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/annotations.mjs`。脚本复制当前生产资源，在独立浏览器配置目录中使用模拟 WebSocket 历史，验证多批注草稿、悬浮编辑、缩放、窄屏、刷新恢复、失败重试及正文统一提交；截图和构建来源记录默认写入 `.cache/annotations-browser`，可通过 `BROWSER_OUTPUT_DIR` 指定目录。

后台恢复浏览器回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/connection-recovery.mjs`。脚本使用隔离模拟 WebSocket 与真实标签切换，在桌面和手机尺寸下验证连接正常时持续更新、断线后延迟重连、后台历史补齐、工作过程展开状态、同步期间编辑草稿及向上翻阅位置。记录消息和输入框的 DOM 实例及移除事件，确认恢复期间保留已有界面，并核对页面时间来源保持一致。截图及构建路径写入 `.cache/background-recovery-browser/after`。修改前将旧 `client/dist` 复制到 `.cache/background-recovery-before/dist`，以 `BROWSER_BEFORE=1` 运行同一脚本，复现消息与输入框被移除、显示加载提示和工作过程收起，结果写入 `before` 目录。

视觉调整的浏览器检查使用生产构建与隔离的模拟历史，覆盖正文、代码块、工作过程、输入框草稿、右侧详情、设置弹窗及欢迎页。浅色、深色、跟随系统深色和窄屏分别核对文字对比度、选中状态、换行、控件位置及全宽布局。80%、100%、125%、150% 和 200% 缩放按物理窗口尺寸除以缩放倍数设置 CSS 视口，并同步设置设备像素比，检查发送按钮和底栏的可见性。修改前后采用相同数据和视口截图，图片及构建信息保存在 `.cache` 中。

账户额度浏览器回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/account-usage.mjs`。脚本注入隔离的 Pro 和 Plus 账户，核对默认圆环、账户行高度和单行重置信息，通过实际点击、Enter、空格、Esc 与外部点击验证详情收放；推进本地时钟并触发 30 秒倒计时回调，确认时间更新及后端请求数量。额度自动读取测试把 60 秒轮询缩短至 200 毫秒并按需启用，组件测试另行断言两个生产间隔。继续验证额度通知、接口失败、回到前台与设置页精简，覆盖浅色、深色、跟随系统深色、五档缩放、390px 窄屏和基础字号放大。截图及构建来源写入 `.cache/account-usage-compact-browser/after`。修改前先将旧 `client/dist` 与 `build-info.json` 复制到 `.cache/account-usage-compact-before/`，分别命名为 `dist` 与 `build-info.json`，再以 `BROWSER_BEFORE=1` 运行同一脚本，记录原有展开大卡片的对照结果。

界面发生可见变化时，同步检查 README 和其他文档引用的仓库图片，在同一提交中更新受影响的截图。README 的界面截图维护在 `docs/images/`：`desktop-light.png` 与 `desktop-dark.png` 使用相同演示数据和 1440 × 900 的桌面视口，`mobile.png` 与 `mobile-sidebar.png` 使用 390 × 844 的手机视口及 2 倍设备像素比，分别展示对话与侧栏额度。执行 `npm run build` 后运行 `CHROME_PATH=/path/to/chromium node tests/browser/readme.mjs`，脚本在独立浏览器配置中使用隔离演示项目、Plus 双窗口额度和模拟消息，实际打开文件预览、切换主题与手机侧栏，并检查默认折叠圆环及展开后的单行重置信息。生成的截图默认写入 `docs/images/`，可通过 `BROWSER_OUTPUT_DIR` 指定其他目录；展开状态的检查截图、构建来源和检查记录写入 `.cache/readme-screenshots/after`。README 通过 `picture` 随阅读环境切换桌面截图，手机截图放在可展开区域；更新后运行 Markdown HTML 浏览器回归，检查实际渲染中的图片、相对链接、折叠区域及窄屏排版。

Markdown HTML 回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/markdown-html.mjs`。脚本使用当前 README、仓库内图片和隔离演示消息，通过程序实际消息区与文件面板验证 HTML 排版、折叠块、图标尺寸、本地候选图、深浅主题与系统主题、文内导航、大图预览及焦点恢复；另核对脚本过滤和窄屏布局。截图与构建来源写入 `.cache/markdown-html-browser/after`。修改前将旧 `client/dist` 和 `build-info.json` 复制到 `.cache/markdown-html-before/`，以 `BROWSER_BEFORE=1` 运行同一脚本复现消息与文件预览直接显示 HTML 文字，结果写入 `before` 目录。组件回归包含安全属性过滤、代码原文、相对路径、候选图失败与迟到读取、实际 README，以及既有的公式、Mermaid 和批注测试。

工具记录浏览器回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/tool-activities.mjs`。脚本在独立浏览器配置中注入 `tests/fixtures/tool-activities.mjs` 的模拟历史，验证图片直接显示、点击放大与焦点恢复、搜索结果仅显示标题链接（缺少标题时显示网址）、搜索记录折叠与恢复、可读网页操作和工具结果，以及深浅主题、80% 至 200% 缩放与窄屏；截图和构建来源写入 `.cache/tool-activities-browser/after`。搜索结果精简的修改前对照先把 `client/dist` 与 `build-info.json` 分别复制到 `.cache/tool-activities-before/dist` 与 `.cache/tool-activities-before/build-info.json`，再用 `BROWSER_BEFORE=1` 运行同一脚本，确认搜索结果仍显示摘要及内部字段，结果写入 `before` 目录。

文件打开回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/files.mjs`，本机需有支持 H.264 编码的 `ffmpeg`。脚本生成临时音视频、PDF、BMP 和二进制样本，注入隔离的模拟历史，实际点击并验证播放、进度跳转、媒体切换后的资源清理、图片与 PDF 预览、文件下载字节、文本编辑和失败重试，覆盖深浅主题与窄屏。截图、下载样本和构建来源保存在 `.cache/file-preview-browser/after`。修改前对照将旧构建及来源复制到 `.cache/file-preview-before/dist` 与 `.cache/file-preview-before/build-info.json`，以 `BROWSER_BEFORE=1` 分别记录音频的二进制提示与 PDF 被当作源码显示的结果。`server/tests/file-content.test.mjs` 覆盖 MIME、附件文件名、原始字节、Range、大文件及取消读取；桥接测试验证 HTTPS 路由，文件面板组件测试覆盖类型切换、保存保护、草稿与迟到读取隔离。

单独验证发行包时执行：

```bash
npm run test:package
```

该测试在临时 npm prefix 中全局安装打包产物，检查命令入口、静态资源、构建来源、用户配置和服务生成。后端与服务管理命令使用模拟实现。安装优先复用 npm 缓存，缺少包元数据或依赖时访问配置的 registry，因此执行环境需要相应缓存或网络连接。

文件引用与批注展示回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium USER_CONTEXT=1 BROWSER_OUTPUT_DIR=.cache/user-message-context/after node tests/browser/annotations.mjs`。脚本使用隔离模拟历史，验证目录与文件引用、目录定位及子文件打开、批注原文收放、文件打开、编辑恢复、移除引用、批注修改与统一提交、刷新，以及深浅主题、80% 至 200% 缩放和窄屏。旧构建通过 `BROWSER_BUILD_DIR` 与 `BROWSER_BUILD_INFO` 指定，以 `BROWSER_BEFORE=1` 复现引用说明外露和编辑时批注协议进入输入框；截图与构建记录写入指定目录。目录跳转的修改前对照使用 `REFERENCE_NAVIGATION_BEFORE=1` 及旧构建，实际点击目录引用后确认面板保持折叠。单元与组件检查覆盖完整封装解析、普通文本保留、批注来源、编辑去重及失败重试，以及目录切换的未保存编辑确认、读取失败、目录与文件的迟到响应隔离。README 现有图片展示普通任务消息，未包含文件引用或批注，图片内容保持适用。

此次交互对照使用本机 Codex VS Code 客户端 `26.1021.22027` 的打包资源：`app-initial` 中的 `Ht`、`Ut` 与 `Sn` 分离上下文和用户请求；`src` 中的 `Su`、`Cu` 恢复文件引用，提交时生成文件上下文并保留正文；`comment-editor` 保留引用标签和路径，并在编辑模式转换时恢复。实际客户端界面控制连接不可用时，以这些实现作为行为证据，客户端运行界面的视觉对照另行记录。提取资源与查验记录仅保存在 `.cache/client-inspection/`。

右侧详情隔离回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium CONTEXT_RESET=1 BROWSER_OUTPUT_DIR=.cache/context-reset/after node tests/browser/annotations.mjs`。脚本以隔离 WebSocket 历史和独立浏览器配置，实际打开文件差异与变更面板并点击新建，检查默认收起、重新展开的概览、文件列表、深浅主题和手机布局。修改前的生产构建及构建信息分别保存在 `.cache/context-reset-before/dist` 与 `.cache/context-reset-before/build-info.json`，通过 `BROWSER_BEFORE=1`、`BROWSER_BUILD_DIR` 和 `BROWSER_BUILD_INFO` 指定并复现残留；截图和构建来源写入指定目录。组件回归补充文件、变更、子代理与待打开文件的清理，以及原对话未保存文件的恢复。README 及其他文档引用的现有截图展示任务对话与文件预览，本次修复的新建状态未出现在这些图片中，图片内容保持适用。

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

空闲判断只使用连接就绪状态、对话轮次与上下文整理占用。打开的网页终端与任务分别处理，等待程序只执行网页服务重启。日志在等待数量改变时更新，重启后检查 `/healthz` 并报告实际运行版本；自动化交付还需核对 `lan/state` 的所需接口。`server/tests/restart-when-idle.test.mjs` 在临时目录提供模拟 systemctl 与 HTTPS/WSS 服务，验证终端保持打开、任务和整理占用、等待期间新轮次、健康检查重试及重启失败，不操作真实服务。

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

版本来源的生成机制、开发构建标识和正式发布身份见[版本管理](versioning.md#正式版本与开发构建)。网页来源在构建时固定，源码桥接来源在进程启动时固定；排查更新时分别核对 `build-info.json` 和 `/healthz` 中的信息；网页“设置 → 关于”仅展示产品版本号。

子代理主代理消息回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium node tests/browser/subagent-messages.mjs`。脚本使用隔离模拟后端，实际打开子代理详情，验证初始任务的位置、发送者标注、后续消息自动补齐、刷新去重、只读行为及桌面深浅主题和手机布局。旧构建和构建信息分别保存在 `.cache/subagent-messages-before/dist` 与 `.cache/subagent-messages-before/build-info.json`，使用 `BROWSER_BEFORE=1` 复现只有子代理回复的状态；截图及来源保存在 `.cache/subagent-messages-browser/`。服务端测试使用临时 rollout，覆盖调用与接收者核对、轮次定位、其他代理隔离、未接收消息和写入中的尾行；组件测试覆盖实时补齐及切换隔离。README 与其他文档现有截图展示主对话、文件预览和账户状态，未包含子代理详情，现有图片保持适用。

加密消息回归在上述浏览器命令前增加 `BROWSER_ENCRYPTED=1`，使用临时父子 rollout 和真实桥接读取函数生成消息，检查加密状态、消息顺序、刷新、后续明文与深浅主题及手机布局。截图和构建来源写入 `.cache/subagent-encryption-browser/after/`。修复前的读取模块可保存在 `.cache/subagent-encryption-before/agent-messages.mjs`，再增加 `BROWSER_CIPHERTEXT_BEFORE=1` 复现密文长气泡，截图写入同目录的 `before/`。测试数据均为人工构造的记录；加密状态的单元回归同时覆盖结构化标记、非固定前缀、重复发送和其他发送者隔离。

## 系统登录回归

`server/tests/auth.test.mjs` 通过临时 CODEX_HOME、实际 TLS/WSS 服务及模拟 PAM 验证程序覆盖未登录访问、跨站请求、会话持久化、退出与过期、限流、维护连接及后台任务保护。测试凭据只用于隔离验证，不操作系统账户或真实 Codex 对话。`server/tests/tls.test.mjs` 检查证书并发生成、重复启动、权限与自定义证书；`server/tests/dev-https.test.mjs` 验证域名证书在本机 HTTPS/WSS 代理中的证书校验、Cookie 与来源转发。

浏览器回归使用 `CHROME_PATH=/path/to/chromium PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/auth.mjs`，在生产构建和临时模拟后端上实际填写登录表单，检查刷新、跨标签页退出、草稿恢复、过期、证书下载、设备安装指引、关于页隐藏开发标记、深浅主题及手机布局。截图及构建信息保存在 `.cache/auth-browser`。

固定项目排序回归先执行 `npm run build`，再运行 `CHROME_PATH=/path/to/chromium PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/project-priority.mjs`。脚本使用独立浏览器配置和模拟 WebSocket，对照钉选空项目、较早对话与未钉选项目的最新对话，实际点击固定、取消固定、展开收起及新建入口，验证立即重排、草稿保留和刷新恢复，并保存桌面深浅主题与手机侧栏截图。修改前先将生产构建及 `build-info.json` 保存为 `.cache/project-priority-before/dist` 和 `.cache/project-priority-before/build-info.json`，使用 `BROWSER_BEFORE=1` 复现原顺序；结果和截图写入 `.cache/project-priority/before` 与 `after`。README 现有截图中的唯一钉选项目已位于未钉选项前方，现有图片与此排序规则一致。
