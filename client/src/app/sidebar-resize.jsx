import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const WIDTH_KEY = "cx-sidebar-width";

function readWidth() {
  try {
    const preference = JSON.parse(localStorage.getItem(WIDTH_KEY));
    const value =
      typeof preference === "number" ? preference : preference?.scale;
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? preference
      : null;
  } catch {
    return null;
  }
}

export function ResizableSidebar({ open, children }) {
  const [preferredWidth, setWidth] = useState(readWidth);
  const [layout, setLayout] = useState(null);
  const sidebar = useRef(null);
  const guide = useRef(null);
  const drag = useRef(null);

  function measure() {
    const style = getComputedStyle(sidebar.current);
    const baseline = guide.current.getBoundingClientRect();
    return {
      width: sidebar.current.getBoundingClientRect().width,
      min: parseFloat(style.minWidth),
      max: parseFloat(style.maxWidth),
      base: baseline.width,
      step: baseline.height,
      available: sidebar.current.parentElement.clientWidth,
    };
  }

  function changeWidth(width) {
    const { min, max, base } = measure();
    setWidth({ scale: Math.max(min, Math.min(max, width)) / base });
  }

  function finishResize(event) {
    const active = drag.current;
    if (event?.pointerId !== undefined && active?.pointerId !== event.pointerId)
      return;
    drag.current = null;
    document.body.classList.remove("sidebar-resizing");
    if (active?.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
  }

  useEffect(() => {
    if (typeof preferredWidth === "number") return;
    try {
      if (preferredWidth === null) localStorage.removeItem(WIDTH_KEY);
      else localStorage.setItem(WIDTH_KEY, JSON.stringify(preferredWidth));
    } catch {
      // 浏览器存储不可用时，宽度选择仍在当前页面内生效。
    }
  }, [preferredWidth]);

  useLayoutEffect(() => {
    let previous;
    const update = () => {
      if (!sidebar.current.getClientRects().length) return;
      const next = measure();
      if (
        previous &&
        ["min", "max", "base", "step", "available"].some(
          (key) => previous[key] !== next[key],
        )
      )
        finishResize();
      previous = next;
      setLayout((current) =>
        current && Object.keys(next).every((key) => current[key] === next[key])
          ? current
          : next,
      );
      // 旧版保存的像素宽度按首次显示时的默认宽度迁移为相对比例。
      setWidth((current) =>
        typeof current === "number" ? { scale: current / next.base } : current,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(sidebar.current.parentElement);
    observer.observe(sidebar.current);
    observer.observe(guide.current);
    update();
    window.addEventListener("resize", finishResize);
    window.addEventListener("blur", finishResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", finishResize);
      window.removeEventListener("blur", finishResize);
      finishResize();
    };
  }, []);

  function startResize(event) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      element: event.currentTarget,
      pointerId: event.pointerId,
      x: event.clientX,
      width: measure().width,
    };
    document.body.classList.add("sidebar-resizing");
  }

  function moveResize(event) {
    if (drag.current?.pointerId !== event.pointerId) return;
    changeWidth(drag.current.width + event.clientX - drag.current.x);
  }

  function resizeWithKeyboard(event) {
    const { width, min, max, step } = measure();
    const next = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: min,
      End: max,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    changeWidth(next);
  }

  return (
    <aside
      ref={sidebar}
      id="project-sidebar"
      className={"sidebar " + (open ? "mobile-open" : "")}
      style={{ "--sidebar-scale": preferredWidth?.scale }}
    >
      {children}
      <span ref={guide} className="sidebar-width-guide" aria-hidden="true" />
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="调整侧栏宽度"
        aria-orientation="vertical"
        aria-controls="project-sidebar"
        aria-valuemin={layout?.min}
        aria-valuemax={layout?.max}
        aria-valuenow={layout?.width}
        title="拖动调整侧栏宽度，双击恢复默认"
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
        onDoubleClick={() => setWidth(null)}
        onKeyDown={resizeWithKeyboard}
      />
    </aside>
  );
}
