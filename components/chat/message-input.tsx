"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageInputProps {
  // 发送消息回调
  onSend: (content: string) => Promise<boolean> | void;
  // 是否禁用输入
  disabled?: boolean;
  // 是否正在发送
  isSending?: boolean;
  // 占位符文本
  placeholder?: string;
}

export function MessageInput({
  onSend,
  disabled = false,
  isSending = false,
  placeholder,
}: MessageInputProps) {
  const [inputValue, setInputValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动调整文本框高度
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // 重置高度以获取正确的 scrollHeight
    textarea.style.height = "auto";
    // 设置最大高度为 150px
    const newHeight = Math.min(textarea.scrollHeight, 150);
    textarea.style.height = `${newHeight}px`;
  }, []);

  // 输入变化时调整高度
  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue, adjustTextareaHeight]);

  // 处理输入变化
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
    },
    []
  );

  // 发送消息
  const handleSend = useCallback(async () => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue || disabled || isSending) return;

    const result = onSend(trimmedValue);
    if (result instanceof Promise) {
      try {
        await result;
      } catch {
      }
    }
    setInputValue("");
  }, [inputValue, disabled, isSending, onSend]);

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Enter 或 Cmd+Enter 发送消息
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
        return;
      }
      // Enter 发送，Shift+Enter 换行
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // 默认占位符
  const defaultPlaceholder = disabled
    ? "请先连接 Gateway..."
    : "输入消息... (Enter 发送, Shift+Enter 换行)";

  return (
    <div className="p-3">
      <div className="flex gap-2 items-end bg-muted/50 rounded-lg p-2">
        {/* 文本输入框 */}
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSending}
          placeholder={placeholder || defaultPlaceholder}
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent text-foreground text-sm outline-none",
            "placeholder:text-text-secondary",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
          style={{ minHeight: "24px", maxHeight: "150px" }}
        />

        {/* 发送按钮 */}
        <button
          onClick={handleSend}
          disabled={disabled || isSending || !inputValue.trim()}
          className={cn(
            "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
            "bg-primary text-primary-foreground",
            "hover:bg-primary/90",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
          )}
          aria-label="发送消息"
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* 快捷键提示 */}
      <div className="flex justify-end mt-1 px-1">
        <span className="text-xs text-text-secondary">
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd>
          {" 发送 "}
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Shift+Enter</kbd>
          {" 换行 "}
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Ctrl+Enter</kbd>
          {" 发送"}
        </span>
      </div>
    </div>
  );
}
