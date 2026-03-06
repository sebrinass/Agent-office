/**
 * 文档信息同步模块
 * 负责将当前文档信息同步到 OpenClaw Gateway
 */

import type { AgentPermission } from '@/types/agent';

// 文档上下文
export interface DocumentSyncContext {
  documentId: string;
  documentName: string;
  documentType: string;
  content?: string;
  selectedText?: string;
  permissions: {
    canView: boolean;
    canAnnotate: boolean;
    canEdit: boolean;
  };
}

// 文档同步配置
export interface DocumentSyncConfig {
  baseUrl: string;
  token?: string;
  sessionId: string;
  syncInterval?: number;
  onSyncSuccess?: () => void;
  onSyncError?: (error: Error) => void;
}

// 文档变更事件
export interface DocumentChangeEvent {
  type: 'content' | 'selection' | 'permission' | 'metadata';
  documentId: string;
  timestamp: number;
}

/**
 * 文档同步管理器
 */
export class DocumentSyncManager {
  private config: DocumentSyncConfig;
  private currentContext: DocumentSyncContext | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private lastSyncTime = 0;
  private pendingSync = false;
  private listeners: Set<(event: DocumentChangeEvent) => void> = new Set();

  constructor(config: DocumentSyncConfig) {
    this.config = {
      syncInterval: 5000, // 默认 5 秒同步一次
      ...config,
    };
  }

  /**
   * 更新文档上下文
   */
  async updateContext(context: Partial<DocumentSyncContext>): Promise<boolean> {
    if (!this.currentContext) {
      return false;
    }

    // 合并上下文
    const previousContext = { ...this.currentContext };
    this.currentContext = {
      ...this.currentContext,
      ...context,
    };

    // 检测变更类型
    const changeType = this.detectChangeType(previousContext, this.currentContext);
    if (changeType) {
      this.emitChange({
        type: changeType,
        documentId: this.currentContext.documentId,
        timestamp: Date.now(),
      });
    }

    // 触发同步
    return this.sync();
  }

  /**
   * 设置当前文档
   */
  setCurrentDocument(context: DocumentSyncContext): void {
    this.currentContext = context;
    this.sync().catch((error) => {
      console.error('Failed to sync document:', error);
    });
  }

  /**
   * 清除当前文档
   */
  clearCurrentDocument(): void {
    this.currentContext = null;
  }

  /**
   * 同步文档信息到 Gateway
   */
  async sync(): Promise<boolean> {
    if (!this.currentContext) {
      return false;
    }

    // 防止重复同步
    if (this.pendingSync) {
      return false;
    }

    this.pendingSync = true;

    try {
      const syncUrl = `${this.config.baseUrl}/api/office-website/document`;

      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.token ? { 'Authorization': `Bearer ${this.config.token}` } : {}),
        },
        body: JSON.stringify({
          sessionId: this.config.sessionId,
          document: this.currentContext,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.lastSyncTime = Date.now();
      this.config.onSyncSuccess?.();
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.config.onSyncError?.(err);
      return false;
    } finally {
      this.pendingSync = false;
    }
  }

  /**
   * 开始定时同步
   */
  startPeriodicSync(): void {
    if (this.syncTimer) {
      return;
    }

    this.syncTimer = setInterval(() => {
      this.sync().catch((error) => {
        console.error('Periodic sync failed:', error);
      });
    }, this.config.syncInterval);
  }

  /**
   * 停止定时同步
   */
  stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * 更新选中文本
   */
  updateSelection(selectedText: string): Promise<boolean> {
    return this.updateContext({ selectedText });
  }

  /**
   * 更新权限
   */
  updatePermissions(permissions: AgentPermission[]): Promise<boolean> {
    return this.updateContext({
      permissions: {
        canView: permissions.includes('view'),
        canAnnotate: permissions.includes('annotate'),
        canEdit: permissions.includes('edit'),
      },
    });
  }

  /**
   * 更新文档内容
   */
  updateContent(content: string): Promise<boolean> {
    return this.updateContext({ content });
  }

  /**
   * 获取当前上下文
   */
  getCurrentContext(): DocumentSyncContext | null {
    return this.currentContext;
  }

  /**
   * 订阅变更事件
   */
  subscribe(listener: (event: DocumentChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stopPeriodicSync();
    this.listeners.clear();
    this.currentContext = null;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * 检测变更类型
   */
  private detectChangeType(
    previous: DocumentSyncContext,
    current: DocumentSyncContext,
  ): DocumentChangeEvent['type'] | null {
    if (previous.content !== current.content) {
      return 'content';
    }
    if (previous.selectedText !== current.selectedText) {
      return 'selection';
    }
    if (
      previous.permissions.canView !== current.permissions.canView ||
      previous.permissions.canAnnotate !== current.permissions.canAnnotate ||
      previous.permissions.canEdit !== current.permissions.canEdit
    ) {
      return 'permission';
    }
    if (
      previous.documentId !== current.documentId ||
      previous.documentName !== current.documentName ||
      previous.documentType !== current.documentType
    ) {
      return 'metadata';
    }
    return null;
  }

  /**
   * 触发变更事件
   */
  private emitChange(event: DocumentChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Document change listener error:', error);
      }
    }
  }
}

/**
 * 创建文档同步管理器
 */
export function createDocumentSyncManager(config: DocumentSyncConfig): DocumentSyncManager {
  return new DocumentSyncManager(config);
}

/**
 * 从 ONLYOFFICE 编辑器获取文档信息
 */
export function getDocumentInfoFromEditor(): DocumentSyncContext | null {
  // 检查是否在 ONLYOFFICE 编辑器环境中
  if (typeof window === 'undefined') {
    return null;
  }

  // 尝试获取 ONLYOFFICE API
  const docEditor = (window as any).DocEditor || (window as any).Aloha;
  if (!docEditor) {
    return null;
  }

  try {
    // 获取文档信息
    const documentInfo = {
      documentId: docEditor.documentId || `doc-${Date.now()}`,
      documentName: docEditor.documentName || 'Untitled Document',
      documentType: docEditor.documentType || 'document',
      content: '',
      selectedText: '',
      permissions: {
        canView: true,
        canAnnotate: false,
        canEdit: false,
      },
    };

    // 尝试获取内容
    if (docEditor.getContent) {
      documentInfo.content = docEditor.getContent();
    }

    // 尝试获取选中文本
    if (docEditor.getSelectedText) {
      documentInfo.selectedText = docEditor.getSelectedText();
    }

    // 尝试获取权限
    if (docEditor.permissions) {
      documentInfo.permissions = {
        canView: docEditor.permissions.view !== false,
        canAnnotate: docEditor.permissions.annotate === true,
        canEdit: docEditor.permissions.edit === true,
      };
    }

    return documentInfo;
  } catch (error) {
    console.error('Failed to get document info from editor:', error);
    return null;
  }
}

/**
 * 获取文档内容（纯文本）
 */
export function getDocumentContent(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const docEditor = (window as any).DocEditor || (window as any).Aloha;
  if (!docEditor) {
    return '';
  }

  try {
    if (docEditor.getContent) {
      return docEditor.getContent();
    }
    if (docEditor.getText) {
      return docEditor.getText();
    }
  } catch (error) {
    console.error('Failed to get document content:', error);
  }

  return '';
}

/**
 * 获取选中文本
 */
export function getSelectedText(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  // 首先尝试从编辑器 API 获取
  const docEditor = (window as any).DocEditor || (window as any).Aloha;
  if (docEditor && docEditor.getSelectedText) {
    try {
      const text = docEditor.getSelectedText();
      if (text) {
        return text;
      }
    } catch (error) {
      console.error('Failed to get selected text from editor:', error);
    }
  }

  // 回退到浏览器原生选择 API
  const selection = window.getSelection();
  if (selection && selection.toString()) {
    return selection.toString();
  }

  return '';
}
