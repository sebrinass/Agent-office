"use client";

import { useCallback } from "react";
import { Eye, MessageSquarePlus, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentPermission } from "@/types/agent";
import {
  usePermissionStore,
  PERMISSION_CONFIGS,
  type PermissionConfig,
} from "@/lib/permission/permission-store";

// 权限图标映射
const permissionIcons: Record<AgentPermission, typeof Eye> = {
  view: Eye,
  annotate: MessageSquarePlus,
  edit: Pencil,
};

interface PermissionButtonProps {
  config: PermissionConfig;
  isActive: boolean;
  onToggle: () => void;
}

/**
 * 单个权限按钮
 */
function PermissionButton({ config, isActive, onToggle }: PermissionButtonProps) {
  const Icon = permissionIcons[config.permission];

  // 查看权限不能关闭
  const isDisabled = !config.canToggle;

  return (
    <button
      onClick={onToggle}
      disabled={isDisabled}
      className={cn(
        "relative flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200",
        "border-2",
        // 激活状态
        isActive && [
          "shadow-lg",
          "scale-110",
        ],
        // 未激活状态
        !isActive && [
          "opacity-40",
          "hover:opacity-70",
        ],
        // 禁用状态（查看权限）
        isDisabled && [
          "cursor-default",
          "opacity-100",
        ],
        // 可切换状态
        !isDisabled && [
          "cursor-pointer",
          "hover:scale-105",
          "active:scale-95",
        ]
      )}
      style={{
        borderColor: config.color,
        backgroundColor: isActive ? `${config.color}20` : 'transparent',
        boxShadow: isActive ? `0 0 12px ${config.color}40` : 'none',
      }}
      title={`${config.label}: ${config.description}${isDisabled ? ' (永久开启)' : ''}`}
      aria-label={`${config.label}权限${isActive ? '已开启' : '已关闭'}${isDisabled ? '，不可关闭' : '，点击切换'}`}
      aria-pressed={isActive}
    >
      {/* 图标 */}
      <Icon
        className="w-4 h-4"
        style={{ color: config.color }}
      />

      {/* 激活指示灯 */}
      {isActive && (
        <span
          className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full animate-pulse"
          style={{ backgroundColor: config.color }}
        />
      )}
    </button>
  );
}

interface PermissionControlsProps {
  // 是否显示标签
  showLabels?: boolean;
  // 自定义类名
  className?: string;
}

/**
 * 权限控制组件
 * 显示三个权限按钮：查看（绿）、批注（黄）、编辑（蓝）
 */
export function PermissionControls({
  showLabels = false,
  className,
}: PermissionControlsProps) {
  const permissions = usePermissionStore((state) => state.permissions);
  const togglePermission = usePermissionStore((state) => state.togglePermission);

  // 获取所有权限配置
  const allConfigs = Object.values(PERMISSION_CONFIGS);

  // 处理权限切换
  const handleToggle = useCallback(
    (permission: AgentPermission) => {
      togglePermission(permission);
    },
    [togglePermission]
  );

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        className
      )}
      role="group"
      aria-label="Agent 权限控制"
    >
      {allConfigs.map((config) => {
        const isActive = permissions.includes(config.permission);

        return (
          <div key={config.permission} className="flex items-center gap-1.5">
            {/* 权限按钮 */}
            <PermissionButton
              config={config}
              isActive={isActive}
              onToggle={() => handleToggle(config.permission)}
            />

            {/* 标签（可选） */}
            {showLabels && (
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {config.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 权限状态显示组件（只读）
 */
export function PermissionStatus({
  className,
}: {
  className?: string;
}) {
  const permissions = usePermissionStore((state) => state.permissions);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {Object.values(PERMISSION_CONFIGS).map((config) => {
        const isActive = permissions.includes(config.permission);
        const Icon = permissionIcons[config.permission];

        return (
          <div
            key={config.permission}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded",
              isActive ? "opacity-100" : "opacity-40"
            )}
            title={`${config.label}: ${isActive ? '已开启' : '已关闭'}`}
          >
            <Icon
              className="w-3.5 h-3.5"
              style={{ color: isActive ? config.color : undefined }}
            />
            {!isActive && (
              <span className="text-[10px] text-muted-foreground line-through">
                {config.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 权限详情面板
 */
export function PermissionDetails({
  className,
}: {
  className?: string;
}) {
  const permissions = usePermissionStore((state) => state.permissions);
  const togglePermission = usePermissionStore((state) => state.togglePermission);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="text-sm font-medium text-foreground">
        Agent 权限设置
      </div>
      <div className="space-y-2">
        {Object.values(PERMISSION_CONFIGS).map((config) => {
          const isActive = permissions.includes(config.permission);
          const Icon = permissionIcons[config.permission];

          return (
            <button
              key={config.permission}
              onClick={() => togglePermission(config.permission)}
              disabled={!config.canToggle}
              className={cn(
                "w-full flex items-start gap-3 p-3 rounded-lg border transition-all",
                isActive
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-background",
                config.canToggle && "cursor-pointer hover:border-primary/30",
                !config.canToggle && "cursor-default opacity-80"
              )}
            >
              {/* 图标 */}
              <div
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full",
                  isActive && "bg-primary/10"
                )}
                style={{
                  backgroundColor: isActive ? `${config.color}20` : undefined,
                }}
              >
                <Icon
                  className="w-4 h-4"
                  style={{ color: isActive ? config.color : undefined }}
                />
              </div>

              {/* 内容 */}
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{config.label}</span>
                  {!config.canToggle && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      永久开启
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {config.description}
                </p>
              </div>

              {/* 开关指示 */}
              <div
                className={cn(
                  "w-2 h-2 rounded-full mt-1.5",
                  isActive ? "bg-primary" : "bg-muted"
                )}
                style={{
                  backgroundColor: isActive ? config.color : undefined,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
