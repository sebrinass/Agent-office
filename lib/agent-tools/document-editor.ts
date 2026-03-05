/**
 * 文档编辑工具
 * 提供 Agent 编辑文档的能力，包含权限检查和操作记录
 */

import DocumentApi from '../document/document-api';
import {
  checkOperationPermission,
  PermissionError,
  type PermissionCheckResult,
} from '../permission/permission-guard';
import type { DocumentOperationType } from '@/types/agent';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 工具执行结果
 */
export interface EditorToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  permissionDenied?: boolean;
  requiredPermission?: string;
  timestamp: number;
}

/**
 * 编辑操作参数
 */
export interface EditToolParams {
  action: 'insertText' | 'replaceText' | 'deleteText' | 'addComment';
  params: InsertTextParams | ReplaceTextParams | DeleteTextParams | AddCommentParams;
}

/**
 * 插入文本参数
 */
export interface InsertTextParams {
  text: string;
}

/**
 * 替换文本参数
 */
export interface ReplaceTextParams {
  searchText: string;
  replaceText: string;
}

/**
 * 删除文本参数
 */
export interface DeleteTextParams {
  startPos?: number;
  length?: number;
}

/**
 * 添加批注参数
 */
export interface AddCommentParams {
  commentText: string;
  author?: string;
}

/**
 * 操作类型映射
 */
const ACTION_TYPE_MAP: Record<EditToolParams['action'], DocumentOperationType> = {
  insertText: 'insert',
  replaceText: 'replace',
  deleteText: 'delete',
  addComment: 'annotate',
};

// ============================================================================
// 文档编辑工具
// ============================================================================

/**
 * 文档编辑工具类
 * 封装文档编辑功能，包含权限检查和操作记录
 */
export class DocumentEditorTool {
  readonly name = 'document-editor';
  readonly description = '编辑文档内容，包含权限检查';

  /**
   * 执行编辑操作
   */
  async execute(params: EditToolParams): Promise<EditorToolResult<boolean>> {
    const startTime = Date.now();

    try {
      // 1. 检查编辑器是否就绪
      if (!DocumentApi.isEditorReady()) {
        return {
          success: false,
          error: 'Document editor is not ready',
          timestamp: startTime,
        };
      }

      // 2. 获取操作类型并检查权限
      const operationType = ACTION_TYPE_MAP[params.action];
      const permissionResult = checkOperationPermission(operationType);

      if (!permissionResult.allowed) {
        return {
          success: false,
          error: permissionResult.error?.message || 'Permission denied',
          permissionDenied: true,
          requiredPermission: permissionResult.permission,
          timestamp: startTime,
        };
      }

      // 3. 执行对应操作
      switch (params.action) {
        case 'insertText':
          return await this.insertText(params.params as InsertTextParams, startTime);

        case 'replaceText':
          return await this.replaceText(params.params as ReplaceTextParams, startTime);

        case 'deleteText':
          return await this.deleteText(params.params as DeleteTextParams, startTime);

        case 'addComment':
          return await this.addComment(params.params as AddCommentParams, startTime);

        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}`,
            timestamp: startTime,
          };
      }
    } catch (error) {
      // 处理权限错误
      if (error instanceof PermissionError) {
        return {
          success: false,
          error: error.message,
          permissionDenied: true,
          requiredPermission: error.requiredPermission,
          timestamp: startTime,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: startTime,
      };
    }
  }

  /**
   * 插入文本
   */
  private async insertText(
    params: InsertTextParams,
    startTime: number
  ): Promise<EditorToolResult<boolean>> {
    try {
      if (!params.text) {
        return {
          success: false,
          error: 'Text is required for insert operation',
          timestamp: startTime,
        };
      }

      const result = await DocumentApi.edit.insertText(params.text);
      return {
        success: result,
        data: result,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to insert text',
        timestamp: startTime,
      };
    }
  }

  /**
   * 替换文本
   */
  private async replaceText(
    params: ReplaceTextParams,
    startTime: number
  ): Promise<EditorToolResult<boolean>> {
    try {
      if (!params.searchText) {
        return {
          success: false,
          error: 'Search text is required for replace operation',
          timestamp: startTime,
        };
      }

      const result = await DocumentApi.edit.replaceText(params.searchText, params.replaceText);
      return {
        success: result,
        data: result,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to replace text',
        timestamp: startTime,
      };
    }
  }

  /**
   * 删除文本
   */
  private async deleteText(
    params: DeleteTextParams,
    startTime: number
  ): Promise<EditorToolResult<boolean>> {
    try {
      const result = await DocumentApi.edit.deleteText(params.startPos, params.length);
      return {
        success: result,
        data: result,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete text',
        timestamp: startTime,
      };
    }
  }

  /**
   * 添加批注
   */
  private async addComment(
    params: AddCommentParams,
    startTime: number
  ): Promise<EditorToolResult<boolean>> {
    try {
      if (!params.commentText) {
        return {
          success: false,
          error: 'Comment text is required',
          timestamp: startTime,
        };
      }

      const result = await DocumentApi.edit.addComment(params.commentText, params.author);
      return {
        success: result,
        data: result,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add comment',
        timestamp: startTime,
      };
    }
  }

  /**
   * 检查操作权限（不执行操作）
   */
  checkPermission(action: EditToolParams['action']): PermissionCheckResult {
    const operationType = ACTION_TYPE_MAP[action];
    return checkOperationPermission(operationType);
  }

  /**
   * 获取工具定义（用于 Agent 调用）
   */
  getToolDefinition(): {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  } {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['insertText', 'replaceText', 'deleteText', 'addComment'],
            description: '编辑操作类型',
          },
          params: {
            type: 'object',
            description: '操作参数',
            properties: {
              text: { type: 'string', description: '要插入的文本（insertText）' },
              searchText: { type: 'string', description: '要搜索的文本（replaceText）' },
              replaceText: { type: 'string', description: '替换后的文本（replaceText）' },
              startPos: { type: 'number', description: '删除起始位置（deleteText）' },
              length: { type: 'number', description: '删除长度（deleteText）' },
              commentText: { type: 'string', description: '批注内容（addComment）' },
              author: { type: 'string', description: '批注作者（addComment）' },
            },
          },
        },
        required: ['action', 'params'],
      },
    };
  }
}

// ============================================================================
// 导出单例实例
// ============================================================================

export const documentEditorTool = new DocumentEditorTool();

export default documentEditorTool;
