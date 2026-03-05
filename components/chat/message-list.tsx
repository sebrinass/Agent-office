"use client";

import { useEffect, useRef } from "react";
import { User, Bot, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentMessage } from "@/types/agent";

interface MessageListProps {
  messages: AgentMessage[];
  // 自动滚动到底部
  autoScroll?: boolean;
}

// 格式化时间戳
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 获取角色图标
function RoleIcon({ role }: { role: AgentMessage["role"] }) {
  switch (role) {
    case "user":
      return (
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-primary" />
        </div>
      );
    case "agent":
      return (
        <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-blue-500" />
        </div>
      );
    case "system":
      return (
        <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
          <AlertCircle className="w-4 h-4 text-amber-500" />
        </div>
      );
    default:
      return null;
  }
}

// 获取角色标签
function getRoleLabel(role: AgentMessage["role"]): string {
  switch (role) {
    case "user":
      return "用户";
    case "agent":
      return "Agent";
    case "system":
      return "系统";
    default:
      return "未知";
  }
}

// 单条消息组件
function MessageItem({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3",
        isUser && "bg-primary/5",
        isSystem && "bg-amber-500/5"
      )}
    >
      <RoleIcon role={message.role} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={cn(
              "text-sm font-medium",
              isUser && "text-primary",
              message.role === "agent" && "text-blue-500",
              isSystem && "text-amber-500"
            )}
          >
            {getRoleLabel(message.role)}
          </span>
          <span className="text-xs text-text-secondary">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>
        <div className="text-sm text-foreground whitespace-pre-wrap break-words">
          {message.content}
        </div>
        {/* 元数据显示 */}
        {message.metadata && Object.keys(message.metadata).length > 0 && (
          <div className="mt-2 text-xs text-text-secondary bg-muted/50 rounded px-2 py-1">
            {JSON.stringify(message.metadata, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageList({ messages, autoScroll = true }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  // 空状态
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <Bot className="w-12 h-12 text-text-secondary mb-3" />
        <p className="text-text-secondary text-sm">
          暂无消息
        </p>
        <p className="text-text-secondary/70 text-xs mt-1">
          连接 Gateway 后开始与 Agent 协作
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      role="log"
      aria-live="polite"
      aria-label="消息列表"
    >
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {/* 底部锚点，用于自动滚动 */}
      <div ref={bottomRef} />
    </div>
  );
}
