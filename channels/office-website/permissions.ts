/**
 * Office-Website Channel Permissions
 *
 * Defines permission scopes and provides permission checking functions
 * for the office-website channel.
 *
 * @module channels/office-website/permissions
 */

import type { OpenClawConfig } from "../../config/config.js";

/**
 * Permission types for office-website
 */
export type PermissionType = "view" | "annotate" | "edit" | "manage" | "memory_read" | "memory_write";

/**
 * Permission scope definition
 */
export interface PermissionScope {
  name: string;
  description: string;
  requires: PermissionType[];
}

/**
 * Document permissions
 */
export interface DocumentPermissions {
  canView: boolean;
  canAnnotate: boolean;
  canEdit: boolean;
}

/**
 * Channel permission scopes
 *
 * These define the available permissions for the office-website channel.
 */
export const officeWebsitePermissions: Record<string, PermissionScope> = {
  "document.read": {
    name: "document.read",
    description: "Read document content",
    requires: ["view"],
  },
  "document.edit": {
    name: "document.edit",
    description: "Edit document content",
    requires: ["edit"],
  },
  "document.annotate": {
    name: "document.annotate",
    description: "Add annotations to document",
    requires: ["annotate"],
  },
  "session.manage": {
    name: "session.manage",
    description: "Manage sessions",
    requires: ["manage"],
  },
  "memory.read": {
    name: "memory.read",
    description: "Read conversation memory",
    requires: ["memory_read"],
  },
  "memory.write": {
    name: "memory.write",
    description: "Write to conversation memory",
    requires: ["memory_write"],
  },
};

/**
 * Check if a permission is granted
 *
 * @param permissions - Current document permissions
 * @param required - Required permission type
 */
export function checkPermission(
  permissions: DocumentPermissions,
  required: PermissionType,
): boolean {
  switch (required) {
    case "view":
      return permissions.canView;
    case "annotate":
      return permissions.canAnnotate;
    case "edit":
      return permissions.canEdit;
    case "manage":
      // Management requires edit permission
      return permissions.canEdit;
    case "memory_read":
      // Memory read requires view permission
      return permissions.canView;
    case "memory_write":
      // Memory write requires annotate permission
      return permissions.canAnnotate;
    default:
      return false;
  }
}

/**
 * Check multiple permissions
 *
 * @param permissions - Current document permissions
 * @param required - Array of required permission types
 */
export function checkPermissions(
  permissions: DocumentPermissions,
  required: PermissionType[],
): { granted: boolean; missing: PermissionType[] } {
  const missing: PermissionType[] = [];

  for (const permission of required) {
    if (!checkPermission(permissions, permission)) {
      missing.push(permission);
    }
  }

  return {
    granted: missing.length === 0,
    missing,
  };
}

/**
 * Check a permission scope
 *
 * @param permissions - Current document permissions
 * @param scopeName - Name of the permission scope to check
 */
export function checkPermissionScope(
  permissions: DocumentPermissions,
  scopeName: string,
): { granted: boolean; missing: PermissionType[] } {
  const scope = officeWebsitePermissions[scopeName];
  if (!scope) {
    return { granted: false, missing: [] };
  }

  return checkPermissions(permissions, scope.requires);
}

/**
 * Get permission error message
 *
 * @param missing - Array of missing permissions
 */
export function getPermissionErrorMessage(missing: PermissionType[]): string {
  if (missing.length === 0) {
    return "";
  }

  const permissionNames: Record<PermissionType, string> = {
    view: "查看",
    annotate: "批注",
    edit: "编辑",
    manage: "管理",
    memory_read: "读取记忆",
    memory_write: "写入记忆",
  };

  const names = missing.map((p) => permissionNames[p] || p);
  return `缺少权限: ${names.join(", ")}`;
}

/**
 * Create permission middleware
 *
 * Returns a middleware function that checks permissions before allowing access.
 */
export function createPermissionMiddleware(
  cfg: OpenClawConfig,
  requiredPermissions: PermissionType[],
) {
  return (permissions: DocumentPermissions) => {
    const result = checkPermissions(permissions, requiredPermissions);
    if (!result.granted) {
      throw new Error(getPermissionErrorMessage(result.missing));
    }
    return true;
  };
}

/**
 * Resolve permissions from configuration
 *
 * Gets the default permissions for an account from the configuration.
 */
export function resolvePermissions(
  cfg: OpenClawConfig,
  accountId?: string,
): DocumentPermissions {
  const accounts = cfg.channels?.["office-website"]?.accounts as
    | Record<string, { defaultPermissions?: Partial<DocumentPermissions> }>
    | undefined;

  const id = accountId || "default";
  const accountPermissions = accounts?.[id]?.defaultPermissions;

  return {
    canView: accountPermissions?.canView ?? true,
    canAnnotate: accountPermissions?.canAnnotate ?? false,
    canEdit: accountPermissions?.canEdit ?? false,
  };
}

/**
 * Merge permissions
 *
 * Combines base permissions with override permissions.
 */
export function mergePermissions(
  base: DocumentPermissions,
  override: Partial<DocumentPermissions>,
): DocumentPermissions {
  return {
    canView: override.canView ?? base.canView,
    canAnnotate: override.canAnnotate ?? base.canAnnotate,
    canEdit: override.canEdit ?? base.canEdit,
  };
}
