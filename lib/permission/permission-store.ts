/**
 * 权限状态管理
 * 管理三个权限状态：查看（永久开启）、批注、编辑
 * 使用 Zustand 进行状态管理，支持 localStorage 持久化
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AgentPermission } from '@/types/agent';

// 权限配置
export interface PermissionConfig {
  permission: AgentPermission;
  label: string;
  description: string;
  color: string;      // 颜色代码
  colorName: string;  // 颜色名称（用于显示）
  canToggle: boolean; // 是否可切换
}

// 权限配置表
export const PERMISSION_CONFIGS: Record<AgentPermission, PermissionConfig> = {
  view: {
    permission: 'view',
    label: '查看',
    description: 'Agent 可以读取文档内容',
    color: '#22c55e',    // 绿色
    colorName: '绿色',
    canToggle: false,    // 永久开启
  },
  annotate: {
    permission: 'annotate',
    label: '批注',
    description: 'Agent 可以添加批注',
    color: '#eab308',    // 黄色
    colorName: '黄色',
    canToggle: true,
  },
  edit: {
    permission: 'edit',
    label: '编辑',
    description: 'Agent 可以修改文档内容',
    color: '#3b82f6',    // 蓝色
    colorName: '蓝色',
    canToggle: true,
  },
};

// 权限状态
interface PermissionState {
  // 当前启用的权限列表
  permissions: AgentPermission[];
  
  // 最后更新时间
  lastUpdatedAt: number | null;
}

// 权限操作方法
interface PermissionActions {
  // 设置权限列表
  setPermissions: (permissions: AgentPermission[]) => void;
  
  // 切换单个权限
  togglePermission: (permission: AgentPermission) => void;
  
  // 启用权限
  enablePermission: (permission: AgentPermission) => void;
  
  // 禁用权限
  disablePermission: (permission: AgentPermission) => void;
  
  // 检查是否拥有权限
  hasPermission: (permission: AgentPermission) => boolean;
  
  // 重置为默认权限
  resetToDefault: () => void;
  
  // 获取权限配置
  getPermissionConfig: (permission: AgentPermission) => PermissionConfig;
  
  // 获取所有权限配置
  getAllPermissionConfigs: () => PermissionConfig[];
}

// 完整 Store 类型
type PermissionStore = PermissionState & PermissionActions;

// 默认权限（只有查看权限）
const DEFAULT_PERMISSIONS: AgentPermission[] = ['view'];

/**
 * 创建权限 Store
 */
export const usePermissionStore = create<PermissionStore>()(
  persist(
    (set, get) => ({
      // 初始状态
      permissions: DEFAULT_PERMISSIONS,
      lastUpdatedAt: null,

      // 设置权限列表
      setPermissions: (permissions) => {
        // 确保 view 权限始终存在
        const newPermissions: AgentPermission[] = permissions.includes('view')
          ? permissions
          : (['view', ...permissions] as AgentPermission[]);
        
        set({
          permissions: newPermissions,
          lastUpdatedAt: Date.now(),
        });
      },

      // 切换权限
      togglePermission: (permission) => {
        // view 权限不能关闭
        if (permission === 'view') {
          console.warn('View permission cannot be toggled - it is always enabled');
          return;
        }

        const { permissions } = get();
        const newPermissions: AgentPermission[] = permissions.includes(permission)
          ? (permissions.filter((p) => p !== permission) as AgentPermission[])
          : ([...permissions, permission] as AgentPermission[]);

        set({
          permissions: newPermissions,
          lastUpdatedAt: Date.now(),
        });
      },

      // 启用权限
      enablePermission: (permission) => {
        const { permissions } = get();
        if (!permissions.includes(permission)) {
          set({
            permissions: [...permissions, permission] as AgentPermission[],
            lastUpdatedAt: Date.now(),
          });
        }
      },

      // 禁用权限
      disablePermission: (permission) => {
        // view 权限不能禁用
        if (permission === 'view') {
          console.warn('View permission cannot be disabled - it is always enabled');
          return;
        }

        const { permissions } = get();
        set({
          permissions: permissions.filter((p) => p !== permission) as AgentPermission[],
          lastUpdatedAt: Date.now(),
        });
      },

      // 检查权限
      hasPermission: (permission) => {
        return get().permissions.includes(permission);
      },

      // 重置为默认
      resetToDefault: () => {
        set({
          permissions: DEFAULT_PERMISSIONS,
          lastUpdatedAt: Date.now(),
        });
      },

      // 获取权限配置
      getPermissionConfig: (permission) => {
        return PERMISSION_CONFIGS[permission];
      },

      // 获取所有权限配置
      getAllPermissionConfigs: () => {
        return Object.values(PERMISSION_CONFIGS);
      },
    }),
    {
      name: 'permission-store',
      storage: createJSONStorage(() => localStorage),
      // 持久化权限状态
      partialize: (state) => ({
        permissions: state.permissions,
        lastUpdatedAt: state.lastUpdatedAt,
      }),
    }
  )
);

/**
 * 状态选择器
 */
export const selectPermissions = (state: PermissionStore) => state.permissions;
export const selectHasViewPermission = (state: PermissionStore) => state.permissions.includes('view');
export const selectHasAnnotatePermission = (state: PermissionStore) => state.permissions.includes('annotate');
export const selectHasEditPermission = (state: PermissionStore) => state.permissions.includes('edit');
export const selectLastUpdatedAt = (state: PermissionStore) => state.lastUpdatedAt;

/**
 * 便捷 Hook
 */
export function usePermissions() {
  return usePermissionStore((state) => state.permissions);
}

export function useHasPermission(permission: AgentPermission) {
  return usePermissionStore((state) => state.permissions.includes(permission));
}

export function usePermissionActions() {
  return usePermissionStore((state) => ({
    setPermissions: state.setPermissions,
    togglePermission: state.togglePermission,
    enablePermission: state.enablePermission,
    disablePermission: state.disablePermission,
    resetToDefault: state.resetToDefault,
  }));
}
