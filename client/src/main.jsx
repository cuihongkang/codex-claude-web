import React, { useState, useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  PanelLeft,
  SquarePen,
  Search,
  FolderPlus,
  ChevronRight,
  Plus,
  Archive,
  Pin,
  MoreHorizontal,
  Pencil,
  GitBranch,
  ArchiveRestore,
  Minimize2,
  TerminalSquare,
  X,
  Check,
  Sparkles,
  Blocks,
  Sun,
  Moon,
  Monitor,
  MessageSquare,
  LoaderCircle,
  ArrowLeft,
  ExternalLink,
  Trash2,
} from "lucide-react";
import {
  useStore,
  get,
  set,
  selectModel,
  rpc,
  newChat,
  openThread,
  loadThreads,
  listThreads,
  rename,
  archive,
  deleteThread,
  fork,
  compact,
  pin,
  addProject,
  titleOf,
  basename,
  report,
  notice,
  persist,
  setTheme,
  addAttachment,
  uid,
  loadSkills,
} from "./store";
import { Conversation, Composer } from "./chat";
import { ClaudeSidebar, ClaudeWorkspace, newClaude } from "./claude";
import { ServiceTierToggle } from "./service-tier-toggle";
import { ReasoningEffortControl } from "./reasoning-effort";
import { IconButton, Empty, FolderPicker, TerminalPanel } from "./workspace";
import "./style.css";
import { projectGroups, threadTime } from "./thread-order";
import { VersionDetails } from "./version";
import { ProjectGroup } from "./project-group";
import { ResizableSidebar } from "./sidebar-resize";
import { AccountFooter } from "./account-usage.jsx";
import { ContextWorkspace } from "./context-panel";
import { CommandDialog, commandTitles } from "./command-dialog";
import { isCompacting } from "./compaction";
import codexWebIcon from "./assets/codex-web.svg";

function ThreadMenu({ thread, onClose }) {
  const s = useStore();
  const action = (fn) => {
    onClose();
    Promise.resolve().then(fn).catch(report);
  };
  return (
    <div className="dropdown" role="menu">
      <button
        onClick={() => action(() => set({ modal: { type: "rename", thread } }))}
      >
        <Pencil size={14} />
        重命名
      </button>
      <button onClick={() => action(() => pin(thread.id))}>
        <Pin size={14} />
        {s.pins.includes(thread.id) ? "取消置顶" : "置顶对话"}
      </button>
      <button onClick={() => action(() => fork(thread))}>
        <GitBranch size={14} />
        创建分支
      </button>
      <button onClick={() => action(() => archive(thread))}>
        {s.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{" "}
        {s.archived ? "恢复对话" : "归档对话"}
      </button>
      {s.current?.id === thread.id && (
        <button
          disabled={
            s.busy ||
            !!s.active[thread.id] ||
            isCompacting(s.compactions[thread.id])
          }
          onClick={() => action(compact)}
        >
          <Minimize2 size={14} />
          整理上下文
        </button>
      )}
      <button
        className="danger-action"
        onClick={() => action(() => set({ modal: { type: "delete", thread } }))}
      >
        <Trash2 size={14} />
        删除对话
      </button>
    </div>
  );
}
function ThreadRow({ thread }) {
  const s = useStore(),
    [menu, show] = useState(false),
    [tooltip, setTooltip] = useState(null);
  const tooltipId = useId();
  const title = titleOf(thread);
  const showTitle = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({
      left: rect.left,
      ...(rect.bottom < window.innerHeight / 2
        ? { top: rect.bottom }
        : { bottom: window.innerHeight - rect.top }),
    });
  };
  const titleVisible = !!tooltip;
  useEffect(() => {
    if (!titleVisible) return;
    const dismiss = () => setTooltip(null);
    const onKeyDown = (event) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [titleVisible]);
  const archiveLabel = s.archived ? "恢复对话" : "归档对话";
  const now = Date.now() / 1000,
    diff = now - threadTime(thread);
  const date =
    diff < 3600
      ? Math.max(1, Math.floor(diff / 60)) + "分"
      : diff < 86400
        ? Math.floor(diff / 3600) + "时"
        : new Date(threadTime(thread) * 1000).toLocaleDateString("zh-CN", {
            month: "numeric",
            day: "numeric",
          });
  return (
    <div
      className={
        "thread-row " +
        (s.provider === "codex" && s.current?.id === thread.id
          ? "selected"
          : "")
      }
    >
      <button
        className="thread-link"
        aria-describedby={tooltip ? tooltipId : undefined}
        onMouseEnter={showTitle}
        onMouseLeave={() => setTooltip(null)}
        onFocus={showTitle}
        onBlur={() => setTooltip(null)}
        onClick={() => {
          setTooltip(null);
          openThread(thread.id);
        }}
      >
        {s.active[thread.id] ? (
          <span className="pulse-dot" />
        ) : s.pins.includes(thread.id) ? (
          <Pin size={12} />
        ) : (
          <span className="thread-indent" />
        )}
        <span>{title}</span>
        <small title={thread.completedAt == null ? "创建时间" : "最近完成时间"}>
          {date}
        </small>
      </button>
      {tooltip &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="thread-title-tooltip"
            style={tooltip}
          >
            {title}
          </div>,
          document.body,
        )}
      <div className="thread-actions">
        <button
          title={archiveLabel}
          aria-label={archiveLabel + " " + titleOf(thread)}
          onClick={() => archive(thread).catch(report)}
        >
          {s.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        </button>
        <button
          aria-label={"管理对话 " + titleOf(thread)}
          onClick={() => show(!menu)}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      {menu && (
        <>
          <div className="click-away" onClick={() => show(false)} />
          <ThreadMenu thread={thread} onClose={() => show(false)} />
        </>
      )}
    </div>
  );
}
function Sidebar() {
  const s = useStore();
  const [filter, setFilter] = useState("all");
  const pinned = s.threads.filter((t) => s.pins.includes(t.id));
  const groups = projectGroups(
    s.threads,
    s.projects,
    s.pins,
    s.projectlessDirectories,
    s.projectlessRoot,
    s.projectOrder || [],
  );
  return (
    <>
      <div
        className={"sidebar-backdrop " + (s.sidebar ? "visible" : "")}
        onClick={() => set({ sidebar: false })}
      />
      <ResizableSidebar open={s.sidebar}>
        <div className="sidebar-top">
          <button className="brand" onClick={() => newChat()}>
            <img src={codexWebIcon} width={24} height={24} alt="" />
            <strong>Codex + Claude</strong>
            <span>Web</span>
          </button>
          <IconButton
            icon={PanelLeft}
            title="收起侧栏"
            onClick={() => {
              set({ sidebar: false });
              document.body.classList.toggle("sidebar-collapsed");
            }}
          />
        </div>
        <nav className="primary-nav">
          <button onClick={newClaude}>
            <SquarePen size={17} />
            <span>新建 Claude 对话</span>
          </button>
          <button onClick={() => newChat()}>
            <SquarePen size={17} />
            <span>新建 Codex 对话</span>
            <kbd>⇧ ⌘ O</kbd>
          </button>
          <button onClick={() => set({ modal: { type: "search" } })}>
            <Search size={17} />
            <span>搜索 Codex 对话</span>
            <kbd>⌘ K</kbd>
          </button>
          <button onClick={() => set({ modal: { type: "skills" } })}>
            <Sparkles size={17} />
            <span>Codex 技能</span>
          </button>
          <button onClick={() => set({ modal: { type: "plugins" } })}>
            <Blocks size={17} />
            <span>Codex 插件与连接</span>
          </button>
        </nav>
        <div className="sidebar-section-title">
          <select
            aria-label="筛选会话后端"
            className="provider-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部会话</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
          <div>
            <IconButton
              icon={Archive}
              title={s.archived ? "查看最近对话" : "查看归档对话"}
              active={s.archived}
              onClick={() => {
                set({ archived: !s.archived });
                loadThreads().catch(report);
              }}
            />
            <IconButton
              icon={FolderPlus}
              title="添加项目"
              onClick={() => set({ modal: { type: "project" } })}
            />
          </div>
        </div>
        <div className="thread-list">
          {filter !== "codex" && <ClaudeSidebar />}
          <div hidden={filter === "claude"}>
            <div className="sidebar-section-title">
              Codex {s.archived ? "已归档" : "项目与对话"}
            </div>
            {pinned.length > 0 && (
              <div className="project-group">
                <div className="pinned-heading">
                  <Pin size={12} />
                  置顶
                </div>
                {pinned.map((t) => (
                  <ThreadRow key={t.id} thread={t} />
                ))}
              </div>
            )}
            {[...groups].map(([path, threads]) => (
              <ProjectGroup key={path} path={path}>
                {threads.map((t) => (
                  <ThreadRow key={t.id} thread={t} />
                ))}
              </ProjectGroup>
            ))}
            {!s.threads.length && (
              <div className="sidebar-empty">
                {s.booting
                  ? "正在载入…"
                  : s.archived
                    ? "还没有归档的对话"
                    : "创建一段新对话，开始工作。"}
              </div>
            )}
            {s.threadCursor && (
              <button
                className="load-more"
                onClick={() => loadThreads(true).catch(report)}
              >
                加载更多对话
              </button>
            )}
          </div>
        </div>
        <div className="sidebar-footer">
          <AccountFooter />
        </div>
      </ResizableSidebar>
    </>
  );
}
function Header() {
  const s = useStore(),
    [menu, show] = useState(false);
  return (
    <header className="topbar">
      <IconButton
        icon={PanelLeft}
        title="显示侧栏"
        onClick={() => {
          document.body.classList.remove("sidebar-collapsed");
          set({ sidebar: !s.sidebar });
        }}
      />
      <div className="breadcrumb">
        <button
          title={s.projectless ? "未指定项目；可选择文件夹" : s.cwd}
          onClick={() => set({ modal: { type: "directory" } })}
        >
          {s.projectless ? "未分类" : basename(s.cwd)}
        </button>
        <ChevronRight size={13} />
        <span>{s.current ? titleOf(s.current) : "新对话"}</span>
        {s.current && (
          <div className="header-menu">
            <IconButton
              icon={MoreHorizontal}
              title="对话操作"
              onClick={() => show(!menu)}
            />
            {menu && (
              <>
                <div className="click-away" onClick={() => show(false)} />
                <ThreadMenu thread={s.current} onClose={() => show(false)} />
              </>
            )}
          </div>
        )}
      </div>
      <div className="topbar-actions">
        <IconButton
          icon={Plus}
          title="在当前目录新建对话"
          onClick={() => newChat(undefined, { reuseDirectory: true })}
        />
      </div>
    </header>
  );
}
function SearchDialog() {
  const s = useStore();
  const [q, query] = useState(""),
    [results, update] = useState(s.threads),
    [loading, load] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    const n = ++epoch.current;
    const timer = setTimeout(() => {
      load(true);
      listThreads({
        archived: s.archived,
        searchTerm: q || undefined,
      })
        .then((r) => {
          if (n === epoch.current) update(r.slice(0, 60));
        })
        .catch(report)
        .finally(() => {
          if (n === epoch.current) load(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  return (
    <>
      <label className="search-input">
        <Search size={20} />
        <input
          autoFocus
          placeholder="按标题或内容搜索对话"
          value={q}
          onChange={(e) => query(e.target.value)}
        />
        {loading && <LoaderCircle size={16} className="spin" />}
      </label>
      <div className="search-results">
        {results.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              set({ modal: null });
              openThread(t.id);
            }}
          >
            <MessageSquare size={17} />
            <span>
              <b>{titleOf(t)}</b>
              <small>{t.cwd}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
        {!results.length && !loading && (
          <Empty icon={Search} title="没有找到对话" />
        )}
      </div>
    </>
  );
}
function RenameDialog({ thread }) {
  const [name, update] = useState(titleOf(thread));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        rename(thread, name)
          .then(() => set({ modal: null }))
          .catch(report);
      }}
    >
      <label className="field-label">
        对话名称
        <input
          autoFocus
          value={name}
          onChange={(e) => update(e.target.value)}
        />
      </label>
      <div className="modal-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => set({ modal: null })}
        >
          取消
        </button>
        <button className="primary" disabled={!name.trim()}>
          保存
        </button>
      </div>
    </form>
  );
}
function SkillsDialog() {
  const s = useStore(),
    [q, query] = useState("");
  useEffect(() => {
    loadSkills().catch(report);
  }, [s.cwd]);
  return (
    <>
      <label className="panel-search">
        <Search size={15} />
        <input
          autoFocus
          value={q}
          placeholder="搜索已安装技能"
          onChange={(e) => query(e.target.value)}
        />
      </label>
      <div className="catalog-list">
        {s.skills
          .filter((x) =>
            (x.name + " " + x.description)
              .toLowerCase()
              .includes(q.toLowerCase()),
          )
          .map((skill) => (
            <button
              className="catalog-card"
              key={skill.path}
              onClick={() => {
                addAttachment({
                  id: uid(),
                  name: skill.name,
                  input: { type: "skill", name: skill.name, path: skill.path },
                });
                set({ modal: null });
                notice("技能已加入下一条消息");
              }}
            >
              <div className="catalog-icon">
                <Sparkles size={21} />
              </div>
              <div>
                <strong>{skill.name}</strong>
                <p>{skill.shortDescription || skill.description}</p>
              </div>
              <Plus size={16} />
            </button>
          ))}
        {!s.skills.length && (
          <Empty icon={Sparkles} title="此目录没有可用技能" />
        )}
      </div>
    </>
  );
}
function PluginsDialog() {
  const [data, update] = useState(null),
    [error, err] = useState("");
  useEffect(() => {
    Promise.all([
      rpc("plugin/installed"),
      rpc("mcpServerStatus/list", { limit: 100 }),
    ])
      .then(([plugins, mcp]) => update({ plugins, mcp }))
      .catch((e) => err(e.message));
  }, []);
  return (
    <div className="catalog-list">
      {error && <div className="inline-error">{error}</div>}
      {!data && !error && <div className="loading">读取本机插件…</div>}
      {data && (
        <>
          <p className="section-description">
            已安装插件及 MCP 工具连接，与本机 Codex 配置保持一致。
          </p>
          {data.plugins.marketplaces
            ?.flatMap((m) => m.plugins || [])
            .map((p) => (
              <div className="catalog-card" key={p.id}>
                <div className="catalog-icon">
                  <Blocks size={20} />
                </div>
                <div>
                  <strong>{p.interface?.displayName || p.name}</strong>
                  <p>{p.interface?.shortDescription || p.id}</p>
                </div>
                <span className="status-tag">
                  {p.enabled ? "已启用" : "已停用"}
                </span>
              </div>
            ))}
          <h3 className="section-label">MCP 服务器</h3>
          {data.mcp.data?.map((server) => (
            <div className="catalog-card" key={server.name}>
              <div className="catalog-icon">
                <TerminalSquare size={20} />
              </div>
              <div>
                <strong>{server.name}</strong>
                <p>
                  {Object.keys(server.tools || {}).length} 项工具 ·{" "}
                  {server.authStatus || "已配置"}
                </p>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
function SettingsDialog() {
  const s = useStore();
  return (
    <div className="settings-body">
      <h3>外观</h3>
      <div className="theme-options">
        {[
          ["light", Sun, "浅色"],
          ["dark", Moon, "深色"],
          ["system", Monitor, "跟随系统"],
        ].map(([v, Icon, label]) => (
          <button
            key={v}
            className={s.theme === v ? "selected" : ""}
            onClick={() => setTheme(v)}
          >
            <Icon size={21} />
            {label}
            {s.theme === v && <Check size={14} />}
          </button>
        ))}
      </div>
      <h3>快捷键</h3>
      <div className="shortcut-list">
        <span>
          搜索对话<kbd>Ctrl / ⌘ K</kbd>
        </span>
        <span>
          新对话<kbd>Ctrl / ⌘ Shift O</kbd>
        </span>
        <span>
          显示终端<kbd>Ctrl / ⌘ `</kbd>
        </span>
        <span>
          消息换行<kbd>Shift Enter</kbd>
        </span>
      </div>
      <h3>关于</h3>
      <VersionDetails />
      <p className="section-description">
        Codex Web · 自建网页客户端
        <br />
        连接本机官方 codex
        app-server，使用本机账户、项目文件和会话历史。桌面专属的自动化调度、内置浏览器与桌面控制目前由桌面客户端提供。
      </p>
    </div>
  );
}
function ModelDialog() {
  const s = useStore();
  return (
    <div className="settings-body">
      <p className="section-description">设置应用于下一条消息。</p>
      <div className="model-options">
        {s.models.map((m) => (
          <button
            key={m.id}
            className={m.model === s.model ? "selected" : ""}
            onClick={() => selectModel(m)}
          >
            <span>
              <b>{m.displayName || m.model}</b>
              <small>{m.description}</small>
            </span>
            {m.model === s.model && <Check size={17} />}
          </button>
        ))}
      </div>
      <ReasoningEffortControl inline />
      <h3>速度模式</h3>
      <ServiceTierToggle />
      <p className="section-description">
        速度设置应用于下一轮任务，Fast 模式会增加用量。
      </p>
      <div className="dialog-done">
        <button className="primary" onClick={() => set({ modal: null })}>
          完成
        </button>
      </div>
    </div>
  );
}
function DeleteDialog({ thread }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deleteThread(thread);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="delete-dialog">
      <p>
        删除“<strong>{titleOf(thread)}</strong>”？
      </p>
      <p className="section-description">
        删除后无法从网页恢复此对话。项目文件会保留。
      </p>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => set({ modal: null })}
        >
          取消
        </button>
        <button className="danger-button" disabled={busy} onClick={remove}>
          {busy ? "正在删除…" : "删除对话"}
        </button>
      </div>
    </div>
  );
}
function Modal() {
  const s = useStore();
  useEffect(() => {
    if (
      s.modal?.type === "command" &&
      s.modal.thread &&
      s.modal.thread.id !== s.current?.id
    )
      set({ modal: null });
  }, [s.current?.id, s.modal]);
  if (!s.modal) return null;
  const { type } = s.modal;
  const titles = {
    command: commandTitles[s.modal.view],
    search: "搜索对话",
    rename: "重命名对话",
    delete: "删除对话",
    directory: "选择工作目录",
    project: "添加项目",
    skills: "技能",
    plugins: "插件与连接",
    settings: "设置",
    model: "模型与思考强度",
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) set({ modal: null });
      }}
    >
      <section
        className={"modal modal-" + type}
        role="dialog"
        aria-modal="true"
        aria-label={titles[type]}
      >
        <div className="modal-heading">
          <h2>{titles[type]}</h2>
          <IconButton
            icon={X}
            title="关闭窗口"
            onClick={() => set({ modal: null })}
          />
        </div>
        {type === "command" ? (
          <div
            className="command-dialog"
            key={s.modal.view + (s.modal.thread?.id || "")}
          >
            <CommandDialog modal={s.modal} />
          </div>
        ) : type === "delete" ? (
          <DeleteDialog thread={s.modal.thread} />
        ) : type === "model" ? (
          <ModelDialog />
        ) : type === "search" ? (
          <SearchDialog />
        ) : type === "rename" ? (
          <RenameDialog thread={s.modal.thread} />
        ) : type === "skills" ? (
          <SkillsDialog />
        ) : type === "plugins" ? (
          <PluginsDialog />
        ) : type === "settings" ? (
          <SettingsDialog />
        ) : (
          <FolderPicker
            onChoose={(path) => {
              if (type === "project") addProject(path);
              else if (s.current) newChat(path);
              else set({ cwd: path, projectless: false, projectlessCwd: null });
              set({ modal: null });
            }}
          />
        )}
      </section>
    </div>
  );
}
function App() {
  const s = useStore();
  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
  }, [s.theme]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") {
        if (
          !get().modal &&
          document.querySelector('.context-tools button[aria-expanded="true"]')
        ) {
          set({ contextOpen: false });
          document
            .querySelector(
              '.context-tools button[aria-controls="conversation-context"]',
            )
            ?.focus();
        }
        set({ modal: null, sidebar: false });
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        set({ modal: { type: "search" } });
      }
      if (e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        if (get().provider === "claude") newClaude();
        else newChat();
      }
      if (e.key === "`") {
        e.preventDefault();
        set({ terminalOpen: !get().terminalOpen });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-shell">
        {s.provider === "claude" ? (
          <ClaudeWorkspace />
        ) : (
          <>
            <Header />
            {!s.connected && (
              <div className="connection-banner">
                <LoaderCircle size={14} className="spin" />
                正在连接电脑，连接恢复后会自动载入对话。
              </div>
            )}
            <div className="workspace">
              <section className="chat-pane">
                <Conversation>
                  <ContextWorkspace />
                </Conversation>
                {s.error && (
                  <div className="error-banner">
                    <span>{s.error}</span>
                    <IconButton
                      icon={X}
                      title="关闭错误提示"
                      onClick={() => set({ error: "" })}
                    />
                  </div>
                )}
                <Composer />
              </section>
            </div>
            {s.terminalOpen && <TerminalPanel />}
          </>
        )}
      </main>
      <Modal />
      {s.notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {s.notice}
        </div>
      )}
    </div>
  );
}
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h2>页面遇到错误</h2>
        <p>{this.state.error.message}</p>
        <button onClick={() => location.reload()}>重新载入</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
