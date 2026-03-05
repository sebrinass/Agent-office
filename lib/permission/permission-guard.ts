/**
 * 权限检查中间件
 * 用于检查操作权限，拒绝无权限操作
 */

import type { AgentPermission, DocumentOperationType } from '@/types/agent';
import { usePermissionStore } from './permission-store';

// 操作类型到权限的映射
const OPERATION_PERMISSION_MAP: Record<DocumentOperationType, AgentPermission> = {
  insert: 'edit',      // 插入需要编辑权限
  replace: 'edit',     // 替换需要编辑权限
  delete: 'edit',      // 删除需要编辑权限
  annotate: 'annotate', // 批注需要批注权限
};

// 权限错误类型
export class PermissionError extends Error {
  public readonly requiredPermission: AgentPermission;
  public readonly operation: string;

  constructor(operation: string, requiredPermission: AgentPermission) {
    super(
      `Permission denied: "${operation}" requires "${requiredPermission}" permission`
    );
    this.name = 'PermissionError';
    this.requiredPermission = requiredPermission;
    this.operation = operation;
  }
}

// 权限检查结果
export interface PermissionCheckResult {
  allowed: boolean;
  permission: AgentPermission;
  hasPermission: boolean;
  error?: PermissionError;
}

/**
 * 检查单个权限
 */
export function checkPermission(permission: AgentPermission): PermissionCheckResult {
  const permissions = usePermissionStore.getState().permissions;
  const hasPermission = permissions.includes(permission);

  return {
    allowed: hasPermission,
    permission,
    hasPermission,
    error: hasPermission
      ? undefined
      : new PermissionError(permission, permission),
  };
}

/**
 * 检查操作权限
 */
export function checkOperationPermission(
  operation: DocumentOperationType
): PermissionCheckResult {
  const requiredPermission = OPERATION_PERMISSION_MAP[operation];
  return checkPermission(requiredPermission);
}

/**
 * 权限守卫函数
 * 如果没有权限则抛出错误
 */
export function requirePermission(permission: AgentPermission): void {
  const result = checkPermission(permission);
  if (!result.allowed && result.error) {
    throw result.error;
  }
}

/**
 * 操作权限守卫函数
 * 如果没有权限则抛出错误
 */
export function requireOperationPermission(operation: DocumentOperationType): void {
  const result = checkOperationPermission(operation);
  if (!result.allowed && result.error) {
    throw result.error;
  }
}

/**
 * 创建权限检查中间件
 * 用于包装操作函数
 */
export function withPermissionGuard<T extends (...args: unknown[]) => unknown>(
  permission: AgentPermission,
  fn: T
): T {
  return ((...args: Parameters<T>) => {
    requirePermission(permission);
    return fn(...args);
  }) as T;
}

/**
 * 创建操作权限检查中间件
 * 用于包装文档操作函数
 */
export function withOperationGuard<T extends (...args: unknown[]) => unknown>(
  operation: DocumentOperationType,
  fn: T
): T {
  return ((...args: Parameters<T>) => {
    requireOperationPermission(operation);
    return fn(...args);
  }) as T;
}

/**
 * 批量权限检查
 */
export function checkPermissions(
  permissions: AgentPermission[]
): Record<AgentPermission, boolean> {
  const currentPermissions = usePermissionStore.getState().permissions;
  
  return permissions.reduce(
    (acc, permission) => {
      acc[permission] = currentPermissions.includes(permission);
      return acc;
    },
    {} as Record<AgentPermission, boolean>
  );
}

/**
 * 获取当前权限状态摘要
 */
export function getPermissionSummary(): {
  view: boolean;
  annotate: boolean;
  edit: boolean;
} {
  const permissions = usePermissionStore.getState().permissions;
  
  return {
    view: permissions.includes('view'),
    annotate: permissions.includes('annotate'),
    edit: permissions.includes('edit'),
  };
}

/**
 * 权限检查 Hook
 * 用于 React 组件中检查权限
 */
export function usePermissionGuard() {
  const permissions = usePermissionStore((state) => state.permissions);

  const hasPermission = (permission: AgentPermission): boolean => {
    return permissions.includes(permission);
  };

  const hasOperationPermission = (operation: DocumentOperationType): boolean => {
    const requiredPermission = OPERATION_PERMISSION_MAP[operation];
    return hasPermission(requiredPermission);
  };

  const checkAndThrow = (permission: AgentPermission): void => {
    if (!hasPermission(permission)) {
      throw new PermissionError(permission, permission);
    }
  };

  const checkOperationAndThrow = (operation: DocumentOperationType): void => {
    const requiredPermission = OPERATION_PERMISSION_MAP[operation];
    checkAndThrow(requiredPermission);
  };

  return {
    permissions,
    hasPermission,
    hasOperationPermission,
    checkAndThrow,
    checkOperationAndThrow,
    getSummary: getPermissionSummary,
  };
}

/**
 * 权限装饰器（用于类方法）
 * 注意：这是 TypeScript 装饰器，需要在 tsconfig 中启用 experimentalDecorators
 */
export function RequirePermission(permission: AgentPermission) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
      requirePermission(permission);
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * 操作权限装饰器
 */
export function RequireOperationPermission(operation: DocumentOperationType) {
  return RequirePermission(OPERATION_PERMISSION_MAP[operation]);
}
