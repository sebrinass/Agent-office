"use client";

import { useState, useCallback } from "react";
import { Link, Unlink, Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentConnectionStatus } from "@/types/agent";

interface GatewayConfigProps {
  // 当前 Gateway 地址
  gatewayUrl: string;
  // 连接状态
  connectionStatus: AgentConnectionStatus;
  // 连接回调
  onConnect: (url: string) => void;
  // 断开连接回调
  onDisconnect: () => void;
  // 保存配置回调
  onSave: (url: string) => void;
}

export function GatewayConfig({
  gatewayUrl,
  connectionStatus,
  onConnect,
  onDisconnect,
  onSave,
}: GatewayConfigProps) {
  const [inputUrl, setInputUrl] = useState(gatewayUrl);
  const [isSaving, setIsSaving] = useState(false);

  // 是否已连接
  const isConnected = connectionStatus === "connected";
  // 是否正在连接
  const isConnecting = connectionStatus === "connecting";

  // 处理 URL 输入变化
  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputUrl(e.target.value);
    },
    []
  );

  // 处理连接
  const handleConnect = useCallback(() => {
    if (inputUrl.trim()) {
      onConnect(inputUrl.trim());
    }
  }, [inputUrl, onConnect]);

  // 处理断开连接
  const handleDisconnect = useCallback(() => {
    onDisconnect();
  }, [onDisconnect]);

  // 处理保存配置
  const handleSave = useCallback(() => {
    setIsSaving(true);
    onSave(inputUrl.trim());
    setTimeout(() => setIsSaving(false), 500);
  }, [inputUrl, onSave]);

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !isConnected && !isConnecting) {
        handleConnect();
      }
    },
    [handleConnect, isConnected, isConnecting]
  );

  return (
    <div className="p-3 space-y-3">
      {/* 标题 */}
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Link className="w-4 h-4" />
        <span>Gateway 配置</span>
      </div>

      {/* URL 输入框 */}
      <div className="space-y-1">
        <label className="text-xs text-text-secondary">WebSocket 地址</label>
        <input
          type="text"
          value={inputUrl}
          onChange={handleUrlChange}
          onKeyDown={handleKeyDown}
          disabled={isConnected}
          placeholder="ws://localhost:3000/gateway"
          className={cn(
            "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background",
            "text-foreground placeholder:text-text-secondary",
            "focus:outline-none focus:ring-2 focus:ring-primary/50",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        />
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        {/* 连接/断开按钮 */}
        {isConnected ? (
          <button
            onClick={handleDisconnect}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
              "bg-red-500/10 text-red-500 hover:bg-red-500/20",
              "transition-colors text-sm font-medium"
            )}
          >
            <Unlink className="w-4 h-4" />
            断开连接
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={!inputUrl.trim() || isConnecting}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "transition-colors text-sm font-medium",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                连接中...
              </>
            ) : (
              <>
                <Link className="w-4 h-4" />
                连接
              </>
            )}
          </button>
        )}

        {/* 保存按钮 */}
        <button
          onClick={handleSave}
          disabled={!inputUrl.trim() || isSaving}
          className={cn(
            "flex items-center justify-center gap-1 px-3 py-2 rounded-lg",
            "bg-muted text-foreground hover:bg-muted/80",
            "transition-colors text-sm",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
          title="保存配置"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* 状态提示 */}
      {connectionStatus === "error" && (
        <div className="text-xs text-red-500 bg-red-500/10 rounded px-2 py-1">
          连接失败，请检查地址是否正确
        </div>
      )}

      {/* 帮助提示 */}
      <div className="text-xs text-text-secondary">
        输入 OpenClaw Gateway 的 WebSocket 地址，例如 ws://localhost:3000/gateway
      </div>
    </div>
  );
}
