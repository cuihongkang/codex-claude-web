import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ImageViewer({ url, alt, onClose }) {
  const dialog = useRef();
  const [originalSize, setOriginalSize] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label="图片预览"
      aria-modal="true"
      onClick={(event) => event.stopPropagation()}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="image-viewer-toolbar">
        <span className="image-viewer-caption" title={alt}>
          {alt || "图片"}
        </span>
        <button
          type="button"
          aria-pressed={originalSize}
          onClick={() => setOriginalSize(!originalSize)}
        >
          {originalSize ? "适应窗口" : "原始尺寸"}
        </button>
        <button
          type="button"
          aria-label="关闭图片预览"
          title="关闭图片预览（Esc）"
          autoFocus
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div
        className={
          "image-viewer-canvas" + (originalSize ? " original-size" : "")
        }
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <img
          src={url}
          alt={alt}
          title={originalSize ? "点击适应窗口" : "点击查看原始尺寸"}
          onClick={() => setOriginalSize(!originalSize)}
        />
      </div>
    </dialog>,
    document.body,
  );
}
