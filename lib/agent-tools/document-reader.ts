/**
 * 文档读取工具
 * 提供 Agent 读取文档内容和元数据的能力
 */

import DocumentApi, {
  type DocumentStructure,
  type DocumentMetadata,
  type SelectedTextInfo,
} from '../document/document-api';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 工具执行结果
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

/**
 * 文档内容读取结果
 */
export interface DocumentContentResult {
  plainText: string;
  structure: DocumentStructure;
  selectedText: SelectedTextInfo;
}

/**
 * 文档元数据读取结果
 */
export interface DocumentMetadataResult {
  metadata: DocumentMetadata;
  isEditorReady: boolean;
}

/**
 * 读取工具参数
 */
export interface ReadToolParams {
  action: 'getPlainText' | 'getStructure' | 'getSelectedText' | 'getMetadata' | 'getAll';
}

/**
 * 读取工具结果类型
 */
export type ReaderToolResultData =
  | string
  | DocumentStructure
  | SelectedTextInfo
  | DocumentMetadataResult
  | DocumentContentResult;

// ============================================================================
// 文档读取工具
// ============================================================================

/**
 * 文档读取工具类
 * 封装文档内容获取和元数据读取功能
 */
export class DocumentReaderTool {
  readonly name = 'document-reader';
  readonly description = '读取文档内容、结构和元数据';

  /**
   * 执行读取操作
   */
  async execute(params: ReadToolParams): Promise<ToolResult<ReaderToolResultData>> {
    const startTime = Date.now();

    try {
      // 检查编辑器是否就绪
      if (!DocumentApi.isEditorReady()) {
        return {
          success: false,
          error: 'Document editor is not ready',
          timestamp: startTime,
        };
      }

      switch (params.action) {
        case 'getPlainText':
          return await this.getPlainText();

        case 'getStructure':
          return await this.getStructure();

        case 'getSelectedText':
          return await this.getSelectedText();

        case 'getMetadata':
          return this.getMetadata();

        case 'getAll':
          return await this.getAll();

        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}`,
            timestamp: startTime,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: startTime,
      };
    }
  }

  /**
   * 获取纯文本内容
   */
  private async getPlainText(): Promise<ToolResult<ReaderToolResultData>> {
    const startTime = Date.now();
    try {
      const plainText = await DocumentApi.content.getPlainText();
      return {
        success: true,
        data: plainText,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get plain text',
        timestamp: startTime,
      };
    }
  }

  /**
   * 获取文档结构
   */
  private async getStructure(): Promise<ToolResult<ReaderToolResultData>> {
    const startTime = Date.now();
    try {
      const structure = await DocumentApi.content.getStructure();
      return {
        success: true,
        data: structure,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get document structure',
        timestamp: startTime,
      };
    }
  }

  /**
   * 获取选中文本
   */
  private async getSelectedText(): Promise<ToolResult<ReaderToolResultData>> {
    const startTime = Date.now();
    try {
      const selectedText = await DocumentApi.content.getSelectedText();
      return {
        success: true,
        data: selectedText,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get selected text',
        timestamp: startTime,
      };
    }
  }

  /**
   * 获取文档元数据
   */
  private getMetadata(): ToolResult<ReaderToolResultData> {
    const startTime = Date.now();
    try {
      const metadata = DocumentApi.metadata.getMetadata();
      return {
        success: true,
        data: {
          metadata,
          isEditorReady: DocumentApi.isEditorReady(),
        },
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get metadata',
        timestamp: startTime,
      };
    }
  }

  /**
   * 获取所有信息
   */
  private async getAll(): Promise<ToolResult<ReaderToolResultData>> {
    const startTime = Date.now();
    try {
      const [plainText, structure, selectedText] = await Promise.all([
        DocumentApi.content.getPlainText(),
        DocumentApi.content.getStructure(),
        DocumentApi.content.getSelectedText(),
      ]);

      return {
        success: true,
        data: {
          plainText,
          structure,
          selectedText,
        },
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get all document info',
        timestamp: startTime,
      };
    }
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
            enum: ['getPlainText', 'getStructure', 'getSelectedText', 'getMetadata', 'getAll'],
            description: '读取操作类型',
          },
        },
        required: ['action'],
      },
    };
  }
}

// ============================================================================
// 导出单例实例
// ============================================================================

export const documentReaderTool = new DocumentReaderTool();

export default documentReaderTool;
