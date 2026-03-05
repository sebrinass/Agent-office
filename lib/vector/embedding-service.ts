/**
 * Embedding 服务模块
 * 
 * 功能：
 * - 调用 Embedding API（OpenAI 兼容格式）
 * - 文本向量化
 * - 批量向量化
 * - 内存缓存机制
 */

import {
  getEmbeddingConfig,
  embeddingConfigManager,
  type EmbeddingConfig,
} from './embedding-config';

// ============ 类型定义 ============

/** Embedding 响应结果 */
export interface EmbeddingResult {
  /** 向量数据 */
  embedding: number[];
  /** 使用的模型 */
  model: string;
  /** Token 使用量（可选） */
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

/** 批量 Embedding 响应 */
export interface BatchEmbeddingResult {
  embeddings: number[][];
  model: string;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

/** Embedding 服务状态 */
export type EmbeddingServiceStatus = 'ready' | 'disabled' | 'error';

/** 服务状态信息 */
export interface EmbeddingServiceInfo {
  status: EmbeddingServiceStatus;
  provider: string;
  model: string;
  error?: string;
}

// ============ 缓存实现 ============

/**
 * 内存缓存类
 * 使用 LRU 策略管理缓存
 */
class EmbeddingCache {
  private cache: Map<string, number[]> = new Map();
  private maxSize: number;
  private accessOrder: string[] = [];

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * 生成缓存键
   */
  private generateKey(text: string, model: string): string {
    // 简单哈希函数
    let hash = 0;
    const combined = `${model}:${text}`;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为 32 位整数
    }
    return `${model}:${hash}`;
  }

  /**
   * 获取缓存
   */
  get(text: string, model: string): number[] | null {
    const key = this.generateKey(text, model);
    const cached = this.cache.get(key);
    
    if (cached) {
      // 更新访问顺序
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
        this.accessOrder.push(key);
      }
      return cached;
    }
    
    return null;
  }

  /**
   * 设置缓存
   */
  set(text: string, model: string, embedding: number[]): void {
    const key = this.generateKey(text, model);
    
    // 如果已存在，先移除旧的
    if (this.cache.has(key)) {
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    }
    
    // 检查容量
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, embedding);
    this.accessOrder.push(key);
  }

  /**
   * 清除缓存
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }
}

// ============ 向量工具函数 ============

/**
 * 归一化向量
 * 将向量转换为单位向量，便于余弦相似度计算
 */
function normalizeEmbedding(vec: number[]): number[] {
  const sanitized = vec.map(value => (Number.isFinite(value) ? value : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  
  if (magnitude < 1e-10) {
    return sanitized;
  }
  
  return sanitized.map(value => value / magnitude);
}

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  
  return dotProduct / (magnitudeA * magnitudeB);
}

// ============ Embedding 服务类 ============

/**
 * Embedding 服务
 * 提供文本向量化功能
 */
export class EmbeddingService {
  private cache: EmbeddingCache;
  private config: EmbeddingConfig;

  constructor(cacheSize: number = 1000) {
    this.cache = new EmbeddingCache(cacheSize);
    this.config = getEmbeddingConfig();
    
    // 监听配置变更
    embeddingConfigManager.subscribe((newConfig) => {
      this.config = newConfig;
    });
  }

  /**
   * 获取服务状态信息
   */
  getServiceInfo(): EmbeddingServiceInfo {
    const config = this.config;
    
    if (!config.enabled) {
      return {
        status: 'disabled',
        provider: config.provider,
        model: config.model,
      };
    }
    
    const validation = embeddingConfigManager.validateConfig();
    if (!validation.valid) {
      return {
        status: 'error',
        provider: config.provider,
        model: config.model,
        error: validation.errors.join('; '),
      };
    }
    
    return {
      status: 'ready',
      provider: config.provider,
      model: config.model,
    };
  }

  /**
   * 单文本向量化
   */
  async embed(text: string): Promise<EmbeddingResult> {
    if (!text || text.trim() === '') {
      throw new Error('文本不能为空');
    }
    
    const config = this.config;
    
    if (!config.enabled) {
      throw new Error('Embedding 服务未启用');
    }
    
    const validation = embeddingConfigManager.validateConfig();
    if (!validation.valid) {
      throw new Error(`配置无效: ${validation.errors.join('; ')}`);
    }
    
    // 检查缓存
    const cached = this.cache.get(text, config.model);
    if (cached) {
      return {
        embedding: cached,
        model: config.model,
      };
    }
    
    // 调用 API
    const embedding = await this.callEmbeddingApi(text);
    
    // 缓存结果
    this.cache.set(text, config.model, embedding);
    
    return {
      embedding,
      model: config.model,
    };
  }

  /**
   * 批量文本向量化
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    if (!texts || texts.length === 0) {
      throw new Error('文本列表不能为空');
    }
    
    const config = this.config;
    
    if (!config.enabled) {
      throw new Error('Embedding 服务未启用');
    }
    
    const validation = embeddingConfigManager.validateConfig();
    if (!validation.valid) {
      throw new Error(`配置无效: ${validation.errors.join('; ')}`);
    }
    
    // 分离已缓存和未缓存的文本
    const results: number[][] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];
    
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (!text || text.trim() === '') {
        results[i] = [];
        continue;
      }
      
      const cached = this.cache.get(text, config.model);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(text);
      }
    }
    
    // 批量调用 API 获取未缓存的向量
    if (uncachedTexts.length > 0) {
      const newEmbeddings = await this.callBatchEmbeddingApi(uncachedTexts);
      
      for (let i = 0; i < uncachedIndices.length; i++) {
        const originalIndex = uncachedIndices[i];
        const embedding = newEmbeddings[i];
        results[originalIndex] = embedding;
        
        // 缓存结果
        this.cache.set(uncachedTexts[i], config.model, embedding);
      }
    }
    
    return {
      embeddings: results,
      model: config.model,
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size();
  }

  // ============ 私有方法 ============

  /**
   * 调用 Embedding API（单文本）
   */
  private async callEmbeddingApi(text: string): Promise<number[]> {
    const config = this.config;
    const endpoint = embeddingConfigManager.getApiEndpoint();
    const headers = embeddingConfigManager.getHeaders();
    
    // Ollama 使用不同的请求格式
    const body = config.provider === 'ollama'
      ? { model: config.model, prompt: text }
      : { model: config.model, input: text };
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding API 错误 (${response.status}): ${errorText}`);
      }
      
      const data = await response.json() as {
        data?: Array<{ embedding?: number[] }>;
        embedding?: number[];
      };
      
      // OpenAI 格式: data.data[0].embedding
      // Ollama 格式: data.embedding
      const embedding = data.data?.[0]?.embedding || data.embedding;
      
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('API 返回的向量数据无效');
      }
      
      return normalizeEmbedding(embedding);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Embedding API 调用失败: ${String(error)}`);
    }
  }

  /**
   * 调用 Embedding API（批量）
   */
  private async callBatchEmbeddingApi(texts: string[]): Promise<number[][]> {
    const config = this.config;
    
    // Ollama 不支持批量请求，需要逐个调用
    if (config.provider === 'ollama') {
      const embeddings = await Promise.all(
        texts.map(text => this.callEmbeddingApi(text))
      );
      return embeddings;
    }
    
    // OpenAI 支持批量请求
    const endpoint = embeddingConfigManager.getApiEndpoint();
    const headers = embeddingConfigManager.getHeaders();
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          input: texts,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding API 错误 (${response.status}): ${errorText}`);
      }
      
      const data = await response.json() as {
        data?: Array<{ embedding?: number[]; index?: number }>;
      };
      
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('API 返回的向量数据无效');
      }
      
      // 按索引排序
      const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      
      return sorted.map(item => {
        if (!item.embedding || !Array.isArray(item.embedding)) {
          return [];
        }
        return normalizeEmbedding(item.embedding);
      });
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Embedding API 批量调用失败: ${String(error)}`);
    }
  }
}

// ============ 单例导出 ============

/** 全局 Embedding 服务实例 */
export const embeddingService = new EmbeddingService();

/** 便捷方法：获取单个文本的向量 */
export async function getEmbedding(text: string): Promise<number[]> {
  const result = await embeddingService.embed(text);
  return result.embedding;
}

/** 便捷方法：获取批量文本的向量 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const result = await embeddingService.embedBatch(texts);
  return result.embeddings;
}

/** 便捷方法：获取服务状态 */
export function getEmbeddingServiceInfo(): EmbeddingServiceInfo {
  return embeddingService.getServiceInfo();
}
