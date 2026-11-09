import React, { useRef, useState } from "react";

// 尺寸和内容状态由所属控件持有，手柄只统一方向、标记与拖动反馈。
export function ResizeHandle({
  direction = "x",
  className = "",
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  ...props
}) {
  const [dragging, setDragging] = useState(false);
  const pointer = useRef(null);
  const finish = (handler) => (event) => {
    if (pointer.current === event.pointerId) {
      pointer.current = null;
      setDragging(false);
    }
    handler?.(event);
  };
  return (
    <div
      {...props}
      className={`resize-handle resize-handle-${direction} ${className}`.trim()}
      data-resizing={dragging || undefined}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.button === 0 && event.isPrimary) {
          pointer.current = event.pointerId;
          setDragging(true);
        }
      }}
      onPointerUp={finish(onPointerUp)}
      onPointerCancel={finish(onPointerCancel)}
      onLostPointerCapture={finish(onLostPointerCapture)}
    />
  );
}
