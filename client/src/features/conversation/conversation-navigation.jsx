import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { List, Search, X } from "lucide-react";
import { messageNavigationEntries } from "../../domain/message-navigation.js";

export function ConversationNavigation({ groups, scroll, onNavigate }) {
  const entries = useMemo(() => messageNavigationEntries(groups), [groups]);
  const entryIds = JSON.stringify(entries.map((entry) => entry.id));
  const [activeId, setActiveId] = useState(null);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef();
  const trigger = useRef();
  const list = useRef();
  const menuId = useId();
  const expanded = open || hovered;
  const filtered = entries.filter((entry) =>
    entry.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const activeIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.id === activeId),
  );
  const marks = entries.slice(
    Math.min(Math.max(0, activeIndex - 5), Math.max(0, entries.length - 12)),
    Math.min(Math.max(12, activeIndex + 7), entries.length),
  );

  useEffect(() => {
    const container = scroll.current;
    if (!container || !entries.length) return;
    const targets = [...container.querySelectorAll("[data-message-id]")];
    let frame;
    const update = () => {
      frame = null;
      const top = container.getBoundingClientRect().top + 32;
      let low = 0;
      let high = targets.length - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (targets[middle].getBoundingClientRect().top <= top)
          low = middle + 1;
        else high = middle - 1;
      }
      const current =
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        100
          ? targets.at(-1)
          : targets[Math.max(0, high)];
      setActiveId(current?.dataset.messageId || null);
    };
    const schedule = () => {
      if (frame == null) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    observer.observe(container.firstElementChild);
    container.addEventListener("scroll", schedule, { passive: true });
    update();
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", schedule);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [entryIds, scroll]);

  useEffect(() => {
    if (!expanded) return;
    const element = root.current;
    const document = element.ownerDocument;
    const closeOutside = (event) => {
      if (!element.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [expanded]);

  useEffect(() => {
    if (!expanded || query) return;
    const container = list.current;
    const current = container?.querySelector('[aria-current="location"]');
    if (!current) return;
    const top =
      current.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    if (top < 0 || top + current.offsetHeight > container.clientHeight)
      container.scrollTop +=
        top - container.clientHeight / 2 + current.offsetHeight / 2;
  }, [expanded, activeId, query]);

  const close = () => {
    setOpen(false);
    setHovered(false);
    setQuery("");
  };
  if (!entries.length) return null;
  return (
    <nav
      className="conversation-navigation"
      data-expanded={expanded}
      aria-label="对话消息导航"
      ref={root}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          close();
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className="conversation-navigation-trigger"
        ref={trigger}
        aria-label="对话目录"
        aria-expanded={expanded}
        aria-controls={expanded ? menuId : undefined}
        title={`对话目录 · ${entries.length} 条消息`}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        <List size={17} />
        <span className="conversation-navigation-marks" aria-hidden="true">
          {marks.map((entry) => (
            <span key={entry.id} data-active={entry.id === activeId} />
          ))}
        </span>
        <small>
          {activeIndex + 1}/{entries.length}
        </small>
      </button>
      {expanded && (
        <div className="conversation-navigation-menu" id={menuId}>
          <div className="conversation-navigation-heading">
            <strong>对话目录</strong>
            <span>{entries.length} 条消息</span>
            <button
              type="button"
              aria-label="收起对话目录"
              onClick={() => {
                close();
                trigger.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          </div>
          <label className="conversation-navigation-search">
            <Search size={14} />
            <input
              type="search"
              aria-label="搜索对话消息"
              placeholder="搜索消息…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <ol className="conversation-navigation-entries" ref={list}>
            {filtered.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  title={entry.label}
                  aria-current={entry.id === activeId ? "location" : undefined}
                  onClick={() => {
                    const container = scroll.current;
                    const target = [
                      ...container.querySelectorAll("[data-message-id]"),
                    ].find((element) => element.dataset.messageId === entry.id);
                    if (!target) return;
                    onNavigate();
                    container.scrollTo({
                      top: Math.max(
                        0,
                        target.getBoundingClientRect().top -
                          container.getBoundingClientRect().top +
                          container.scrollTop -
                          20,
                      ),
                    });
                    setActiveId(entry.id);
                    close();
                    target.focus({ preventScroll: true });
                  }}
                >
                  <span className="conversation-navigation-number">
                    {entry.number}
                  </span>
                  <span className="conversation-navigation-label">
                    {entry.label}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {!filtered.length && (
            <p className="conversation-navigation-empty">没有匹配的消息</p>
          )}
        </div>
      )}
    </nav>
  );
}
