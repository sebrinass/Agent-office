"use client";

import { useState, useCallback, useEffect } from "react";
import { MessageSquare, Settings, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { AgentMessage, AgentConnectionStatus } from "@/types/agent";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { ConnectionStatus } from "./connection-status";
import { AgentSettings } from "@/components/settings/agent-settings";

interface ChatPanelProps {
  // 连接状态
  connectionStatus: AgentConnectionStatus;
  // 消息列表
  messages: AgentMessage[];
  // 是否正在发送
  isSending?: boolean;
  // 事件回调
  onSendMessage?: (content: string) => Promise<boolean>;
  onReconnect?: () => void;
}

export function ChatPanel({
  connectionStatus,
  messages,
  isSending = false,
  onSendMessage,
  onReconnect,
}: ChatPanelProps) {
  // 侧边栏展开/收起状态
  const [isOpen, setIsOpen] = useState(true);
  // 配置面板展开状态
  const [showConfig, setShowConfig] = useState(false);
  // 侧边栏宽度（像素）
  const [width, setWidth] = useState(400);
  // 是否正在调整宽度
  const [isResizing, setIsResizing] = useState(false);

  // 处理发送消息
  const handleSendMessage = useCallback(
    async (content: string): Promise<boolean> => {
      const success = await onSendMessage?.(content);
      if (success) {
        toast.success("消息已发送", { duration: 1500 });
      } else {
        toast.error("消息发送失败", { duration: 2000 });
      }
      return success ?? false;
    },
    [onSendMessage]
  );

  // 处理重连
  const handleReconnect = useCallback(() => {
    onReconnect?.();
  }, [onReconnect]);

  // 开始调整宽度
  const startResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  // 结束调整宽度
  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  // 调整宽度
  const resize = useCallback(
    (e: React.MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      // 限制宽度范围：最小 280px，最大 600px
      setWidth(Math.min(Math.max(newWidth, 280), 600));
    },
    [isResizing]
  );

  // 切换侧边栏展开/收起
  const togglePanel = useCallback(() => {
    setIsOpen(!isOpen);
  }, [isOpen]);

  // 切换配置面板
  const toggleConfig = useCallback(() => {
    setShowConfig(!showConfig);
  }, [showConfig]);

  // Esc 快捷键关闭会话窗口
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
        toast.info("会话窗口已关闭");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // 连接状态变化时显示 Toast 通知
  useEffect(() => {
    if (connectionStatus === "connected") {
      toast.success("已连接到 Gateway", { id: "connection" });
    } else if (connectionStatus === "connecting") {
      toast.loading("正在连接 Gateway...", { id: "connection" });
    } else if (connectionStatus === "disconnected") {
      toast.warning("已断开连接", { id: "connection" });
    } else if (connectionStatus === "error") {
      toast.error("连接失败，请检查 Gateway 配置", { id: "connection" });
    }
  }, [connectionStatus]);

  return (
    <>
      {/* 展开按钮（收起状态下显示） */}
      {!isOpen && (
        <button
          onClick={togglePanel}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-primary text-primary-foreground p-2 rounded-l-lg shadow-lg hover:bg-primary/90 transition-colors"
          aria-label="展开会话窗口"
        >
          <MessageSquare className="w-5 h-5" />
        </button>
      )}

      {/* 侧边栏主体 */}
      <aside
        className={cn(
          "fixed right-0 top-0 h-full bg-background border-l border-border flex flex-col z-40 transition-transform duration-300",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        style={{ width: `${width}px` }}
        onMouseMove={resize}
        onMouseUp={stopResizing}
        onMouseLeave={stopResizing}
      >
        {/* 调整宽度手柄 */}
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/20 transition-colors",
            isResizing && "bg-primary/30"
          )}
          onMouseDown={startResizing}
        />

        {/* 头部标题栏 */}
        <header className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-foreground">Agent 协作</h2>
            <span className="text-[10px] text-text-secondary hidden sm:inline">
              <kbd className="px-1 py-0.5 bg-muted rounded">Esc</kbd> 关闭
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ConnectionStatus
              status={connectionStatus}
              onReconnect={handleReconnect}
            />
            <button
              onClick={toggleConfig}
              className={cn(
                "p-2 rounded-lg transition-colors",
                showConfig
                  ? "bg-primary/10 text-primary"
                  : "text-text-secondary hover:bg-sidebar-hover hover:text-foreground"
              )}
              aria-label="配置"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={togglePanel}
              className="p-2 rounded-lg text-text-secondary hover:bg-sidebar-hover hover:text-foreground transition-colors"
              aria-label="收起会话窗口"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 配置面板 */}
        {showConfig && (
          <div className="border-b border-border shrink-0 max-h-[70vh] overflow-y-auto">
            <AgentSettings />
          </div>
        )}

        {/* 消息列表 */}
        <div className="flex-1 overflow-hidden">
          <MessageList messages={messages} />
        </div>

        {/* 消息输入 */}
        <div className="border-t border-border shrink-0">
          <MessageInput
            onSend={handleSendMessage}
            disabled={connectionStatus !== "connected"}
            isSending={isSending}
          />
        </div>
      </aside>
    </>
  );
}
