/**
 * 向量检索工具
 * 提供 Agent 语义搜索、关键词搜索和混合搜索的能力
 */

import {
  fullTextSearch,
  vectorSearch,
  hybridSearch,
  searchEditRecords,
  getTopContent,
  type SearchResult,
  type HybridSearchResult,
  type SearchOptions,
  type VectorSearchOptions,
  type HybridSearchOptions,
} from '../vector/vector-search';
import { getEmbedding, getEmbeddingServiceInfo } from '../vector/embedding-service';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 工具执行结果
 */
export interface VectorSearchToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  embeddingStatus?: 'success' | 'skipped' | 'failed';
  totalResults?: number;
  timestamp: number;
}

/**
 * 检索工具参数
 */
export interface VectorSearchToolParams {
  action: 'keywordSearch' | 'semanticSearch' | 'hybridSearch' | 'searchEditRecords' | 'getTopContent';
  params: KeywordSearchParams | SemanticSearchParams | HybridSearchParams | SearchEditRecordsParams | GetTopContentParams;
}

/**
 * 关键词搜索参数
 */
export interface KeywordSearchParams {
  query: string;
  limit?: number;
  offset?: number;
  sourceTypes?: string[];
  minScore?: number;
}

/**
 * 语义搜索参数
 */
export interface SemanticSearchParams {
  query: string;
  limit?: number;
  offset?: number;
  sourceTypes?: string[];
  threshold?: number;
  embeddingModel?: string;
}

/**
 * 混合搜索参数
 */
export interface HybridSearchParams {
  query: string;
  limit?: number;
  offset?: number;
  sourceTypes?: string[];
  textWeight?: number;
  vectorWeight?: number;
  rrfK?: number;
}

/**
 * 编辑记录搜索参数
 */
export interface SearchEditRecordsParams {
  query: string;
  limit?: number;
  offset?: number;
}

/**
 * 获取热门内容参数
 */
export interface GetTopContentParams {
  sourceType?: string;
  limit?: number;
}

/**
 * 搜索结果项
 */
export interface SearchResultItem {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
  score: number;
  rank?: number;
  createdAt: number;
}

/**
 * 混合搜索结果项
 */
export interface HybridSearchResultItem extends SearchResultItem {
  textScore: number;
  textRank: number;
  vectorScore: number;
  vectorRank: number;
  rrfScore: number;
}

/**
 * 搜索结果集
 */
export interface SearchResults {
  results: SearchResultItem[];
  total: number;
  query: string;
  searchType: string;
}

// ============================================================================
// 向量检索工具
// ============================================================================

/**
 * 向量检索工具类
 * 封装关键词搜索、语义搜索和混合搜索功能
 */
export class VectorSearchTool {
  readonly name = 'vector-search';
  readonly description = '语义搜索、关键词搜索和混合搜索向量数据库';

  /**
   * 执行检索操作
   */
  async execute(params: VectorSearchToolParams): Promise<VectorSearchToolResult<SearchResults>> {
    const startTime = Date.now();

    try {
      switch (params.action) {
        case 'keywordSearch':
          return await this.keywordSearch(params.params as KeywordSearchParams, startTime);

        case 'semanticSearch':
          return await this.semanticSearch(params.params as SemanticSearchParams, startTime);

        case 'hybridSearch':
          return await this.hybridSearchAction(params.params as HybridSearchParams, startTime);

        case 'searchEditRecords':
          return await this.searchEditRecords(params.params as SearchEditRecordsParams, startTime);

        case 'getTopContent':
          return await this.getTopContent(params.params as GetTopContentParams, startTime);

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
   * 关键词搜索
   */
  private async keywordSearch(
    params: KeywordSearchParams,
    startTime: number
  ): Promise<VectorSearchToolResult<SearchResults>> {
    try {
      // 参数验证
      if (!params.query || params.query.trim() === '') {
        return {
          success: false,
          error: 'query is required and cannot be empty',
          timestamp: startTime,
        };
      }

      const options: SearchOptions = {
        limit: params.limit || 20,
        offset: params.offset || 0,
        sourceTypes: params.sourceTypes,
        minScore: params.minScore,
      };

      const results = await fullTextSearch(params.query, options);

      const searchResults: SearchResults = {
        results: results.map(this.mapSearchResult),
        total: results.length,
        query: params.query,
        searchType: 'keyword',
      };

      return {
        success: true,
        data: searchResults,
        totalResults: results.length,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to perform keyword search',
        timestamp: startTime,
      };
    }
  }

  /**
   * 语义搜索
   */
  private async semanticSearch(
    params: SemanticSearchParams,
    startTime: number
  ): Promise<VectorSearchToolResult<SearchResults>> {
    try {
      // 参数验证
      if (!params.query || params.query.trim() === '') {
        return {
          success: false,
          error: 'query is required and cannot be empty',
          timestamp: startTime,
        };
      }

      // 检查 Embedding 服务状态
      const serviceInfo = getEmbeddingServiceInfo();
      let embeddingStatus: 'success' | 'skipped' | 'failed' = 'success';

      if (serviceInfo.status !== 'ready') {
        return {
          success: false,
          error: `Embedding service is not ready: ${serviceInfo.status}${serviceInfo.error ? ` - ${serviceInfo.error}` : ''}`,
          embeddingStatus: 'skipped',
          timestamp: startTime,
        };
      }

      // 获取查询向量
      let queryEmbedding: number[];
      try {
        queryEmbedding = await getEmbedding(params.query);
        embeddingStatus = 'success';
      } catch (embeddingError) {
        return {
          success: false,
          error: `Failed to get embedding: ${embeddingError instanceof Error ? embeddingError.message : 'Unknown error'}`,
          embeddingStatus: 'failed',
          timestamp: startTime,
        };
      }

      const options: VectorSearchOptions = {
        limit: params.limit || 20,
        offset: params.offset || 0,
        sourceTypes: params.sourceTypes,
        threshold: params.threshold || 0.5,
        embeddingModel: params.embeddingModel,
      };

      const results = await vectorSearch(queryEmbedding, options);

      const searchResults: SearchResults = {
        results: results.map(this.mapSearchResult),
        total: results.length,
        query: params.query,
        searchType: 'semantic',
      };

      return {
        success: true,
        data: searchResults,
        embeddingStatus,
        totalResults: results.length,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to perform semantic search',
        timestamp: startTime,
      };
    }
  }

  /**
   * 混合搜索（关键词 + 语义）
   */
  private async hybridSearchAction(
    params: HybridSearchParams,
    startTime: number
  ): Promise<VectorSearchToolResult<SearchResults>> {
    try {
      // 参数验证
      if (!params.query || params.query.trim() === '') {
        return {
          success: false,
          error: 'query is required and cannot be empty',
          timestamp: startTime,
        };
      }

      // 检查 Embedding 服务状态
      const serviceInfo = getEmbeddingServiceInfo();
      let embeddingStatus: 'success' | 'skipped' | 'failed' = 'success';

      if (serviceInfo.status !== 'ready') {
        // Embedding 服务不可用时，降级为关键词搜索
        console.warn('Embedding service not ready, falling back to keyword search');
        embeddingStatus = 'skipped';
        return await this.keywordSearch(
          {
            query: params.query,
            limit: params.limit,
            offset: params.offset,
            sourceTypes: params.sourceTypes,
          },
          startTime
        );
      }

      // 获取查询向量
      let queryEmbedding: number[];
      try {
        queryEmbedding = await getEmbedding(params.query);
        embeddingStatus = 'success';
      } catch (embeddingError) {
        // 向量化失败时，降级为关键词搜索
        console.warn('Failed to get embedding, falling back to keyword search:', embeddingError);
        embeddingStatus = 'failed';
        return await this.keywordSearch(
          {
            query: params.query,
            limit: params.limit,
            offset: params.offset,
            sourceTypes: params.sourceTypes,
          },
          startTime
        );
      }

      const options: HybridSearchOptions = {
        limit: params.limit || 20,
        offset: params.offset || 0,
        sourceTypes: params.sourceTypes,
        textWeight: params.textWeight,
        vectorWeight: params.vectorWeight,
        rrfK: params.rrfK,
      };

      const results = await hybridSearch(params.query, queryEmbedding, options);

      const searchResults: SearchResults = {
        results: results.map(this.mapHybridSearchResult),
        total: results.length,
        query: params.query,
        searchType: 'hybrid',
      };

      return {
        success: true,
        data: searchResults,
        embeddingStatus,
        totalResults: results.length,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to perform hybrid search',
        timestamp: startTime,
      };
    }
  }

  /**
   * 搜索编辑记录
   */
  private async searchEditRecords(
    params: SearchEditRecordsParams,
    startTime: number
  ): Promise<VectorSearchToolResult<SearchResults>> {
    try {
      // 参数验证
      if (!params.query || params.query.trim() === '') {
        return {
          success: false,
          error: 'query is required and cannot be empty',
          timestamp: startTime,
        };
      }

      const options: SearchOptions = {
        limit: params.limit || 20,
        offset: params.offset || 0,
      };

      const results = await searchEditRecords(params.query, options);

      const searchResults: SearchResults = {
        results: results.map(this.mapSearchResult),
        total: results.length,
        query: params.query,
        searchType: 'editRecords',
      };

      return {
        success: true,
        data: searchResults,
        totalResults: results.length,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search edit records',
        timestamp: startTime,
      };
    }
  }

  /**
   * 获取热门内容
   */
  private async getTopContent(
    params: GetTopContentParams,
    startTime: number
  ): Promise<VectorSearchToolResult<SearchResults>> {
    try {
      const results = await getTopContent(params.sourceType, params.limit || 10);

      const searchResults: SearchResults = {
        results: results.map(this.mapSearchResult),
        total: results.length,
        query: '',
        searchType: 'topContent',
      };

      return {
        success: true,
        data: searchResults,
        totalResults: results.length,
        timestamp: startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get top content',
        timestamp: startTime,
      };
    }
  }

  /**
   * 映射搜索结果
   */
  private mapSearchResult(result: SearchResult): SearchResultItem {
    return {
      id: result.id,
      sourceType: result.source_type,
      sourceId: result.source_id,
      content: result.content,
      score: result.score,
      rank: result.rank,
      createdAt: result.created_at,
    };
  }

  /**
   * 映射混合搜索结果
   */
  private mapHybridSearchResult(result: HybridSearchResult): HybridSearchResultItem {
    return {
      id: result.id,
      sourceType: result.source_type,
      sourceId: result.source_id,
      content: result.content,
      score: result.score,
      rank: result.rank,
      createdAt: result.created_at,
      textScore: result.textScore,
      textRank: result.textRank,
      vectorScore: result.vectorScore,
      vectorRank: result.vectorRank,
      rrfScore: result.rrfScore,
    };
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
            enum: ['keywordSearch', 'semanticSearch', 'hybridSearch', 'searchEditRecords', 'getTopContent'],
            description: '检索操作类型',
          },
          params: {
            type: 'object',
            description: '操作参数',
            properties: {
              // 通用参数
              query: { type: 'string', description: '搜索查询文本' },
              limit: { type: 'number', description: '返回结果数量限制（默认20）' },
              offset: { type: 'number', description: '结果偏移量（分页）' },
              sourceTypes: {
                type: 'array',
                items: { type: 'string' },
                description: '过滤来源类型',
              },
              // 关键词搜索参数
              minScore: { type: 'number', description: '最低相关性分数（keywordSearch）' },
              // 语义搜索参数
              threshold: { type: 'number', description: '相似度阈值（semanticSearch，默认0.5）' },
              embeddingModel: { type: 'string', description: '指定 Embedding 模型（semanticSearch）' },
              // 混合搜索参数
              textWeight: { type: 'number', description: '文本检索权重（hybridSearch，0-1）' },
              vectorWeight: { type: 'number', description: '向量检索权重（hybridSearch，0-1）' },
              rrfK: { type: 'number', description: 'RRF 常数（hybridSearch，默认60）' },
              // 获取热门内容参数
              sourceType: { type: 'string', description: '来源类型过滤（getTopContent）' },
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

export const vectorSearchTool = new VectorSearchTool();

export default vectorSearchTool;
