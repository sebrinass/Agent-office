"use client";

import { useCallback } from "react";
import { Wifi, WifiOff, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { AgentConnectionStatus } from "@/types/agent";

interface ConnectionStatusProps {
  // 连接状态
  status: AgentConnectionStatus;
  // 重连回调
  onReconnect?: () => void;
  // 是否显示文字标签
  showLabel?: boolean;
}

// 状态配置
const statusConfig: Record<
  AgentConnectionStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    icon: typeof Wifi;
    animate?: boolean;
  }
> = {
  connected: {
    label: "已连接",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    icon: Wifi,
  },
  connecting: {
    label: "连接中",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    icon: Loader2,
    animate: true,
  },
  disconnected: {
    label: "已断开",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    icon: WifiOff,
  },
  error: {
    label: "连接错误",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    icon: WifiOff,
  },
};

export function ConnectionStatus({
  status,
  onReconnect,
  showLabel = false,
}: ConnectionStatusProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  // 处理重连点击
  const handleClick = useCallback(() => {
    if ((status === "disconnected" || status === "error") && onReconnect) {
      toast.loading("正在重新连接...", { id: "reconnect", duration: 2000 });
      onReconnect();
    }
  }, [status, onReconnect]);

  // 是否可点击（断开或错误状态时可点击重连）
  const isClickable = (status === "disconnected" || status === "error") && onReconnect;

  return (
    <button
      onClick={handleClick}
      disabled={!isClickable}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors",
        config.bgColor,
        isClickable && "cursor-pointer hover:opacity-80",
        !isClickable && "cursor-default"
      )}
      title={
        isClickable
          ? "点击重连"
          : config.label
      }
      aria-label={`连接状态: ${config.label}`}
    >
      {/* 状态图标 */}
      <div className="relative">
        <Icon
          className={cn(
            "w-3.5 h-3.5",
            config.color,
            config.animate && "animate-spin"
          )}
        />
        {/* 连接中脉冲动画 */}
        {config.animate && (
          <div className={cn(
            "absolute inset-0 w-3.5 h-3.5 rounded-full",
            config.color.replace("text-", "bg-"),
            "animate-ping opacity-30"
          )} />
        )}
      </div>

      {/* 状态文字 */}
      {showLabel && (
        <span className={cn("text-xs font-medium", config.color)}>
          {config.label}
        </span>
      )}

      {/* 重连图标（断开或错误状态时显示） */}
      {isClickable && (
        <RefreshCw className={cn("w-3 h-3", config.color)} />
      )}
    </button>
  );
}
