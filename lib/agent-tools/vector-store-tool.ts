/**
 * 向量存储工具
 * 提供 Agent 存储编辑记录、文档信息和自动向量化的能力
 */

import {
  writeEditRecord,
  writeDocument,
  writeVector,
  updateDocument,
  getDocumentById,
  generateId,
  type WriteEditRecordInput,
  type WriteDocumentInput,
  type WriteVectorInput,
} from '../vector/vector-store';
import { getEmbedding, getEmbeddingServiceInfo } from '../vector/embedding-service';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 工具执行结果
 */
export interface VectorStoreToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  embeddingStatus?: 'success' | 'skipped' | 'failed';
  timestamp: number;
}

/**
 * 存储工具参数
 */
export interface VectorStoreToolParams {
  action: 'storeEditRecord' | 'storeDocument' | 'storeWithEmbedding' | 'updateDocument';
  params: StoreEditRecordParams | StoreDocumentParams | StoreWithEmbeddingParams | UpdateDocumentParams;
}

/**
 * 存储编辑记录参数
 */
export interface StoreEditRecordParams {
  documentId: string;
  operationType: 'insert' | 'delete' | 'replace' | 'format';
  positionStart: number;
  positionEnd: number;
  oldContent?: string | null;
  newContent?: string | null;
  agentId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * 存储文档信息参数
 */
export interface StoreDocumentParams {
  id: string;
  filename: string;
  fileType: string;
  fileSize?: number;
  contentHash?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * 存储并自动向量化参数
 */
export interface StoreWithEmbeddingParams {
  sourceType: 'edit_record' | 'document' | 'custom';
  sourceId: string;
  content: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * 更新文档参数
 */
export interface UpdateDocumentParams {
  id: string;
  updates: {
    filename?: string;
    fileType?: string;
    fileSize?: number;
    contentHash?: string | null;
    metadata?: Record<string, unknown> | null;
  };
}

/**
 * 编辑记录存储结果
 */
export interface EditRecordStoreResult {
  id: string;
  documentId: string;
  timestamp: number;
}

/**
 * 文档存储结果
 */
export interface DocumentStoreResult {
  id: string;
  filename: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 向量存储结果
 */
export interface VectorStoreResult {
  id: string;
  sourceType: string;
  sourceId: string;
  embeddingModel: string;
  embeddingDims: number;
}

// ============================================================================
// 向量存储工具
// ============================================================================

/**
 * 向量存储工具类
 * 封装编辑记录存储、文档信息存储和自动向量化功能
 */
export class VectorStoreTool {
  readonly name = 'vector-store';
  readonly description = '存储编辑记录、文档信息到向量数据库，支持自动向量化';

  /**
   * 执行存储操作
   */
  async execute(params: VectorStoreToolParams): Promise<VectorStoreToolResult<unknown>> {
    const startTime = Date.now();

    try {
      switch (params.action) {
        case 'storeEditRecord':
          return await this.storeEditRecord(params.params as StoreEditRecordParams, startTime);

        case 'storeDocument':
          return await this.storeDocument(params.params as StoreDocumentParams, startTime);

        case 'storeWithEmbedding':
          return await this.storeWithEmbedding(params.params as StoreWithEmbeddingParams, startTime);

        case 'updateDocument':
          return await this.updateDocument(params.params as UpdateDocumentParams, startTime);

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
   * 存储编辑记录
   */
  private async storeEditRecord(
    params: StoreEditRecordParams,
    startTime: number
  ): Promise<VectorStoreToolResult<EditRecordStoreResult>> {
    try {
      // 参数验证
      if (!params.documentId) {
        return {
          success: false,
          error: 'documentId is required',
          timestamp: startTime,
        };
      }

      if (!params.operationType) {
        return {
          success: false,
          error: 'operationType is required',
          timestamp: startTime,
        };
      }

      const input: WriteEditRecordInput = {
        id: generateId(),
        document_id: params.documentId,
        operation_type: params.operationType,
        position_start: params.positionStart,
        position_end: params.positionEnd,
        old_content: params.oldContent,
        new_content: params.newContent,
        agent_id: params.agentId,
        metadata: params.metadata,
      };

      const record = await writeEditRecord(input);

      return {
        success: true,
        data: {
          id: record.id,
          documentId: record.document_id,
          timestamp: record.timestamp,
        },
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store edit record',
        timestamp: startTime,
      };
    }
  }

  /**
   * 存储文档信息
   */
  private async storeDocument(
    params: StoreDocumentParams,
    startTime: number
  ): Promise<VectorStoreToolResult<DocumentStoreResult>> {
    try {
      // 参数验证
      if (!params.id) {
        return {
          success: false,
          error: 'id is required',
          timestamp: startTime,
        };
      }

      if (!params.filename) {
        return {
          success: false,
          error: 'filename is required',
          timestamp: startTime,
        };
      }

      const input: WriteDocumentInput = {
        id: params.id,
        filename: params.filename,
        file_type: params.fileType,
        file_size: params.fileSize,
        content_hash: params.contentHash,
        metadata: params.metadata,
      };

      const document = await writeDocument(input);

      return {
        success: true,
        data: {
          id: document.id,
          filename: document.filename,
          createdAt: document.created_at,
          updatedAt: document.updated_at,
        },
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store document',
        timestamp: startTime,
      };
    }
  }

  /**
   * 存储内容并自动向量化
   */
  private async storeWithEmbedding(
    params: StoreWithEmbeddingParams,
    startTime: number
  ): Promise<VectorStoreToolResult<VectorStoreResult>> {
    try {
      // 参数验证
      if (!params.sourceType) {
        return {
          success: false,
          error: 'sourceType is required',
          timestamp: startTime,
        };
      }

      if (!params.sourceId) {
        return {
          success: false,
          error: 'sourceId is required',
          timestamp: startTime,
        };
      }

      if (!params.content || params.content.trim() === '') {
        return {
          success: false,
          error: 'content is required and cannot be empty',
          timestamp: startTime,
        };
      }

      // 检查 Embedding 服务状态
      const serviceInfo = getEmbeddingServiceInfo();
      let embeddingStatus: 'success' | 'skipped' | 'failed' = 'success';
      let embedding: number[] = [];
      let embeddingModel = '';
      let embeddingDims = 0;

      if (serviceInfo.status === 'ready') {
        try {
          const embeddingResult = await getEmbedding(params.content);
          embedding = embeddingResult;
          embeddingModel = serviceInfo.model;
          embeddingDims = embedding.length;
          embeddingStatus = 'success';
        } catch (embeddingError) {
          console.warn('Embedding failed, storing without vector:', embeddingError);
          embeddingStatus = 'failed';
        }
      } else {
        embeddingStatus = 'skipped';
      }

      // 写入向量数据
      const input: WriteVectorInput = {
        id: generateId(),
        source_type: params.sourceType,
        source_id: params.sourceId,
        content: params.content,
        embedding,
        embedding_model: embeddingModel,
        embedding_dims: embeddingDims,
      };

      const record = await writeVector(input);

      return {
        success: true,
        data: {
          id: record.id,
          sourceType: record.source_type,
          sourceId: record.source_id,
          embeddingModel: record.embedding_model,
          embeddingDims: record.embedding_dims,
        },
        embeddingStatus,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store with embedding',
        timestamp: startTime,
      };
    }
  }

  /**
   * 更新文档信息
   */
  private async updateDocument(
    params: UpdateDocumentParams,
    startTime: number
  ): Promise<VectorStoreToolResult<DocumentStoreResult>> {
    try {
      // 参数验证
      if (!params.id) {
        return {
          success: false,
          error: 'id is required',
          timestamp: startTime,
        };
      }

      // 检查文档是否存在
      const existing = await getDocumentById(params.id);
      if (!existing) {
        return {
          success: false,
          error: `Document not found: ${params.id}`,
          timestamp: startTime,
        };
      }

      const document = await updateDocument(params.id, params.updates);

      if (!document) {
        return {
          success: false,
          error: 'Failed to update document',
          timestamp: startTime,
        };
      }

      return {
        success: true,
        data: {
          id: document.id,
          filename: document.filename,
          createdAt: document.created_at,
          updatedAt: document.updated_at,
        },
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update document',
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
            enum: ['storeEditRecord', 'storeDocument', 'storeWithEmbedding', 'updateDocument'],
            description: '存储操作类型',
          },
          params: {
            type: 'object',
            description: '操作参数',
            properties: {
              // storeEditRecord 参数
              documentId: { type: 'string', description: '文档ID（storeEditRecord）' },
              operationType: {
                type: 'string',
                enum: ['insert', 'delete', 'replace', 'format'],
                description: '操作类型（storeEditRecord）',
              },
              positionStart: { type: 'number', description: '起始位置（storeEditRecord）' },
              positionEnd: { type: 'number', description: '结束位置（storeEditRecord）' },
              oldContent: { type: 'string', description: '旧内容（storeEditRecord）' },
              newContent: { type: 'string', description: '新内容（storeEditRecord）' },
              agentId: { type: 'string', description: 'Agent ID（storeEditRecord）' },
              // storeDocument 参数
              id: { type: 'string', description: '文档ID（storeDocument/updateDocument）' },
              filename: { type: 'string', description: '文件名（storeDocument）' },
              fileType: { type: 'string', description: '文件类型（storeDocument）' },
              fileSize: { type: 'number', description: '文件大小（storeDocument）' },
              contentHash: { type: 'string', description: '内容哈希（storeDocument）' },
              // storeWithEmbedding 参数
              sourceType: {
                type: 'string',
                enum: ['edit_record', 'document', 'custom'],
                description: '来源类型（storeWithEmbedding）',
              },
              sourceId: { type: 'string', description: '来源ID（storeWithEmbedding）' },
              content: { type: 'string', description: '内容文本（storeWithEmbedding）' },
              // updateDocument 参数
              updates: { type: 'object', description: '更新字段（updateDocument）' },
              // 通用参数
              metadata: { type: 'object', description: '元数据' },
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

export const vectorStoreTool = new VectorStoreTool();

export default vectorStoreTool;
