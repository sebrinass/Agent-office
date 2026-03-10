/**
 * Office-Website Channel Message Templates
 *
 * Defines common message templates with variable substitution support.
 * Used for consistent messaging across the office-website channel.
 *
 * @module channels/office-website/templates
 */

/**
 * Template variable type
 */
export type TemplateVariables = Record<string, string | number | boolean>;

/**
 * Message template definition
 */
export interface MessageTemplate {
  id: string;
  content: string;
  description?: string;
  category?: TemplateCategory;
}

/**
 * Template categories for organization
 */
export type TemplateCategory =
  | "welcome"
  | "error"
  | "success"
  | "permission"
  | "document"
  | "session"
  | "help"
  | "status";

/**
 * Built-in message templates for office-website channel
 */
export const messageTemplates: Record<string, MessageTemplate> = {
  // ============================================================================
  // Welcome Templates
  // ============================================================================
  welcome: {
    id: "welcome",
    content: "您好！我是您的文档助手，有什么可以帮助您的吗？",
    description: "欢迎消息，用于新会话开始时",
    category: "welcome",
  },

  welcomeWithName: {
    id: "welcomeWithName",
    content: "您好，{name}！我是您的文档助手，有什么可以帮助您的吗？",
    description: "带用户名的欢迎消息",
    category: "welcome",
  },

  // ============================================================================
  // Error Templates
  // ============================================================================
  errorGeneric: {
    id: "errorGeneric",
    content: "抱歉，发生了错误：{error}",
    description: "通用错误消息",
    category: "error",
  },

  errorProcessing: {
    id: "errorProcessing",
    content: "处理您的请求时发生错误，请稍后重试。",
    description: "处理错误消息",
    category: "error",
  },

  errorTimeout: {
    id: "errorTimeout",
    content: "请求超时，请稍后重试。",
    description: "超时错误消息",
    category: "error",
  },

  errorNotFound: {
    id: "errorNotFound",
    content: "未找到{resource}，请检查后重试。",
    description: "资源未找到错误",
    category: "error",
  },

  // ============================================================================
  // Permission Templates
  // ============================================================================
  permissionDenied: {
    id: "permissionDenied",
    content: "抱歉，您没有{action}权限。",
    description: "权限拒绝消息",
    category: "permission",
  },

  permissionRequired: {
    id: "permissionRequired",
    content: "此操作需要{permission}权限，请联系管理员。",
    description: "需要权限提示",
    category: "permission",
  },

  permissionElevated: {
    id: "permissionElevated",
    content: "您的权限等级不足以执行此操作。当前等级：{currentLevel}，需要等级：{requiredLevel}",
    description: "权限等级不足提示",
    category: "permission",
  },

  // ============================================================================
  // Document Templates
  // ============================================================================
  documentSaved: {
    id: "documentSaved",
    content: "文档「{name}」已保存成功。",
    description: "文档保存成功",
    category: "document",
  },

  documentUpdated: {
    id: "documentUpdated",
    content: "文档「{name}」已更新，修改了 {changes} 处内容。",
    description: "文档更新成功",
    category: "document",
  },

  documentCreated: {
    id: "documentCreated",
    content: "文档「{name}」已创建成功。",
    description: "文档创建成功",
    category: "document",
  },

  documentDeleted: {
    id: "documentDeleted",
    content: "文档「{name}」已删除。",
    description: "文档删除成功",
    category: "document",
  },

  documentNotFound: {
    id: "documentNotFound",
    content: "未找到文档「{name}」，请确认文档ID是否正确。",
    description: "文档未找到",
    category: "document",
  },

  documentLocked: {
    id: "documentLocked",
    content: "文档「{name}」正在被 {user} 编辑，请稍后再试。",
    description: "文档锁定提示",
    category: "document",
  },

  documentAnnotated: {
    id: "documentAnnotated",
    content: "已在文档「{name}」第 {line} 行添加批注。",
    description: "文档批注添加成功",
    category: "document",
  },

  // ============================================================================
  // Session Templates
  // ============================================================================
  sessionStarted: {
    id: "sessionStarted",
    content: "会话已开始，会话ID：{sessionId}",
    description: "会话开始消息",
    category: "session",
  },

  sessionEnded: {
    id: "sessionEnded",
    content: "会话已结束。感谢使用！",
    description: "会话结束消息",
    category: "session",
  },

  sessionExpired: {
    id: "sessionExpired",
    content: "会话已过期，请重新开始。",
    description: "会话过期提示",
    category: "session",
  },

  sessionTimeout: {
    id: "sessionTimeout",
    content: "会话将在 {minutes} 分钟后超时，请及时保存您的工作。",
    description: "会话超时警告",
    category: "session",
  },

  // ============================================================================
  // Success Templates
  // ============================================================================
  successGeneric: {
    id: "successGeneric",
    content: "操作成功完成。",
    description: "通用成功消息",
    category: "success",
  },

  successWithDetails: {
    id: "successWithDetails",
    content: "{action}成功完成，耗时 {duration} 秒。",
    description: "带详情的成功消息",
    category: "success",
  },

  // ============================================================================
  // Help Templates
  // ============================================================================
  helpIntro: {
    id: "helpIntro",
    content: "我是文档助手，可以帮您：\n\n- 编辑和批注文档\n- 搜索文档内容\n- 回答文档相关问题\n- 管理文档权限\n\n输入「帮助」获取详细使用说明。",
    description: "帮助介绍消息",
    category: "help",
  },

  helpCommands: {
    id: "helpCommands",
    content: "可用命令：\n\n{commands}",
    description: "命令帮助列表",
    category: "help",
  },

  helpDocument: {
    id: "helpDocument",
    content: "文档操作帮助：\n\n- 「编辑」：编辑当前文档\n- 「批注」：添加批注\n- 「搜索」：搜索文档内容\n- 「保存」：保存文档",
    description: "文档操作帮助",
    category: "help",
  },

  // ============================================================================
  // Status Templates
  // ============================================================================
  statusProcessing: {
    id: "statusProcessing",
    content: "正在处理{task}，请稍候...",
    description: "处理中状态",
    category: "status",
  },

  statusComplete: {
    id: "statusComplete",
    content: "{task}已完成。",
    description: "完成状态",
    category: "status",
  },

  statusWaiting: {
    id: "statusWaiting",
    content: "等待用户输入...",
    description: "等待状态",
    category: "status",
  },

  statusTyping: {
    id: "statusTyping",
    content: "正在输入...",
    description: "输入状态",
    category: "status",
  },
};

/**
 * Escape special regex characters in a string
 *
 * @param str - String to escape
 * @returns Escaped string safe for use in RegExp
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace template variables with actual values
 *
 * Supports {variable} syntax for variable substitution.
 * Variables are replaced with their string representation.
 * Variable names are properly escaped to prevent regex injection.
 *
 * @param template - Template string with {variable} placeholders
 * @param variables - Object containing variable names and values
 * @returns Template string with variables replaced
 *
 * @example
 * ```typescript
 * const result = renderTemplate("您好，{name}！", { name: "张三" });
 * // result: "您好，张三！"
 * ```
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  let result = template;

  // Replace all {variable} patterns
  // Escape variable names to prevent regex injection from special characters
  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = escapeRegExp(key);
    const pattern = new RegExp(`\\{${escapedKey}\\}`, "g");
    result = result.replace(pattern, String(value));
  }

  return result;
}

/**
 * Get a template by ID and render it with variables
 *
 * @param templateId - Template ID
 * @param variables - Variables to substitute
 * @returns Rendered template string, or empty string if template not found
 *
 * @example
 * ```typescript
 * const message = getTemplate("welcomeWithName", { name: "张三" });
 * // message: "您好，张三！我是您的文档助手，有什么可以帮助您的吗？"
 * ```
 */
export function getTemplate(templateId: string, variables?: TemplateVariables): string {
  const template = messageTemplates[templateId];

  if (!template) {
    console.warn(`[office-website] Template not found: ${templateId}`);
    return "";
  }

  if (variables) {
    return renderTemplate(template.content, variables);
  }

  return template.content;
}

/**
 * Get template definition by ID
 *
 * @param templateId - Template ID
 * @returns Template definition or undefined if not found
 */
export function getTemplateDefinition(templateId: string): MessageTemplate | undefined {
  return messageTemplates[templateId];
}

/**
 * List all templates by category
 *
 * @param category - Template category to filter by
 * @returns Array of templates in the category
 */
export function listTemplatesByCategory(category: TemplateCategory): MessageTemplate[] {
  return Object.values(messageTemplates).filter((t) => t.category === category);
}

/**
 * List all available templates
 *
 * @returns Array of all templates
 */
export function listAllTemplates(): MessageTemplate[] {
  return Object.values(messageTemplates);
}

/**
 * Check if a template exists
 *
 * @param templateId - Template ID to check
 * @returns True if template exists
 */
export function hasTemplate(templateId: string): boolean {
  return templateId in messageTemplates;
}

/**
 * Create a custom template instance
 *
 * Useful for one-off templates that aren't in the registry.
 *
 * @param content - Template content with {variable} placeholders
 * @param variables - Variables to substitute
 * @returns Rendered string
 */
export function createTemplate(content: string, variables?: TemplateVariables): string {
  if (variables) {
    return renderTemplate(content, variables);
  }
  return content;
}

/**
 * Template builder for fluent API
 *
 * @example
 * ```typescript
 * const message = templateBuilder("welcomeWithName")
 *   .set("name", "张三")
 *   .build();
 * ```
 */
export class TemplateBuilder {
  private templateId: string;
  private variables: TemplateVariables = {};

  constructor(templateId: string) {
    this.templateId = templateId;
  }

  /**
   * Set a variable value
   */
  set(key: string, value: string | number | boolean): this {
    this.variables[key] = value;
    return this;
  }

  /**
   * Set multiple variables at once
   */
  setAll(variables: TemplateVariables): this {
    Object.assign(this.variables, variables);
    return this;
  }

  /**
   * Build the final message
   */
  build(): string {
    return getTemplate(this.templateId, this.variables);
  }
}

/**
 * Create a template builder
 *
 * @param templateId - Template ID
 * @returns Template builder instance
 */
export function templateBuilder(templateId: string): TemplateBuilder {
  return new TemplateBuilder(templateId);
}

/**
 * Common template constants for quick access
 */
export const Templates = {
  // Welcome
  WELCOME: "welcome",
  WELCOME_WITH_NAME: "welcomeWithName",

  // Errors
  ERROR_GENERIC: "errorGeneric",
  ERROR_PROCESSING: "errorProcessing",
  ERROR_TIMEOUT: "errorTimeout",
  ERROR_NOT_FOUND: "errorNotFound",

  // Permission
  PERMISSION_DENIED: "permissionDenied",
  PERMISSION_REQUIRED: "permissionRequired",
  PERMISSION_ELEVATED: "permissionElevated",

  // Document
  DOCUMENT_SAVED: "documentSaved",
  DOCUMENT_UPDATED: "documentUpdated",
  DOCUMENT_CREATED: "documentCreated",
  DOCUMENT_DELETED: "documentDeleted",
  DOCUMENT_NOT_FOUND: "documentNotFound",
  DOCUMENT_LOCKED: "documentLocked",
  DOCUMENT_ANNOTATED: "documentAnnotated",

  // Session
  SESSION_STARTED: "sessionStarted",
  SESSION_ENDED: "sessionEnded",
  SESSION_EXPIRED: "sessionExpired",
  SESSION_TIMEOUT: "sessionTimeout",

  // Success
  SUCCESS_GENERIC: "successGeneric",
  SUCCESS_WITH_DETAILS: "successWithDetails",

  // Help
  HELP_INTRO: "helpIntro",
  HELP_COMMANDS: "helpCommands",
  HELP_DOCUMENT: "helpDocument",

  // Status
  STATUS_PROCESSING: "statusProcessing",
  STATUS_COMPLETE: "statusComplete",
  STATUS_WAITING: "statusWaiting",
  STATUS_TYPING: "statusTyping",
} as const;

export default Templates;
