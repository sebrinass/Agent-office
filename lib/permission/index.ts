/**
 * 权限模块导出
 */

// 状态管理
export {
  usePermissionStore,
  usePermissions,
  useHasPermission,
  usePermissionActions,
  selectPermissions,
  selectHasViewPermission,
  selectHasAnnotatePermission,
  selectHasEditPermission,
  selectLastUpdatedAt,
  PERMISSION_CONFIGS,
  type PermissionConfig,
} from './permission-store';

// 权限守卫
export {
  PermissionError,
  checkPermission,
  checkOperationPermission,
  requirePermission,
  requireOperationPermission,
  withPermissionGuard,
  withOperationGuard,
  checkPermissions,
  getPermissionSummary,
  usePermissionGuard,
  RequirePermission,
  RequireOperationPermission,
  type PermissionCheckResult,
} from './permission-guard';
