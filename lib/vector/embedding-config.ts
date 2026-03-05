/**
 * Embedding 配置模块
 * 
 * 支持多种 Embedding 提供者：
 * - OpenAI (text-embedding-3-small/large)
 * - Ollama (nomic-embed-text)
 * - 自定义 OpenAI 兼容服务
 */

// ============ 类型定义 ============

/** Embedding 提供者类型 */
export type EmbeddingProviderType = 'openai' | 'ollama' | 'custom';

/** Embedding 配置接口 */
export interface EmbeddingConfig {
  /** 提供者类型 */
  provider: EmbeddingProviderType;
  /** API 基础 URL */
  baseUrl: string;
  /** API 密钥（可选，Ollama 本地服务可能不需要） */
  apiKey?: string;
  /** 模型名称 */
  model: string;
  /** 是否启用 */
  enabled: boolean;
  /** 自定义请求头 */
  headers?: Record<string, string>;
}

/** 提供者默认配置 */
export interface ProviderDefaults {
  baseUrl: string;
  model: string;
  requiresApiKey: boolean;
}

// ============ 默认配置 ============

/** 各提供者的默认值 */
export const PROVIDER_DEFAULTS: Record<EmbeddingProviderType, ProviderDefaults> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
    requiresApiKey: true,
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'nomic-embed-text',
    requiresApiKey: false,
  },
  custom: {
    baseUrl: '',
    model: '',
    requiresApiKey: true,
  },
};

/** 默认 Embedding 配置 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: 'openai',
  baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
  model: PROVIDER_DEFAULTS.openai.model,
  enabled: false,
};

// ============ 存储键 ============

const STORAGE_KEY = 'office-website-embedding-config';

// ============ 配置管理类 ============

/**
 * Embedding 配置管理器
 * 负责配置的读取、保存和验证
 */
export class EmbeddingConfigManager {
  private config: EmbeddingConfig;
  private listeners: Set<(config: EmbeddingConfig) => void> = new Set();

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * 获取当前配置
   */
  getConfig(): EmbeddingConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<EmbeddingConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
    this.saveConfig(this.config);
    this.notifyListeners();
  }

  /**
   * 设置提供者类型并应用默认值
   */
  setProvider(provider: EmbeddingProviderType): void {
    const defaults = PROVIDER_DEFAULTS[provider];
    this.updateConfig({
      provider,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
    });
  }

  /**
   * 验证配置是否有效
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = this.config;

    if (!config.enabled) {
      return { valid: true, errors: [] };
    }

    if (!config.baseUrl || config.baseUrl.trim() === '') {
      errors.push('API 基础 URL 不能为空');
    }

    if (!config.model || config.model.trim() === '') {
      errors.push('模型名称不能为空');
    }

    const defaults = PROVIDER_DEFAULTS[config.provider];
    if (defaults.requiresApiKey && (!config.apiKey || config.apiKey.trim() === '')) {
      errors.push(`${config.provider} 提供者需要 API 密钥`);
    }

    // 验证 URL 格式
    try {
      new URL(config.baseUrl);
    } catch {
      errors.push('API 基础 URL 格式无效');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 获取完整的 API 端点 URL
   */
  getApiEndpoint(): string {
    const baseUrl = this.config.baseUrl.replace(/\/$/, '');
    
    if (this.config.provider === 'ollama') {
      return `${baseUrl}/api/embeddings`;
    }
    
    // OpenAI 兼容格式
    if (baseUrl.includes('/v1')) {
      return `${baseUrl}/embeddings`;
    }
    return `${baseUrl}/v1/embeddings`;
  }

  /**
   * 获取请求头
   */
  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  /**
   * 订阅配置变更
   */
  subscribe(listener: (config: EmbeddingConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 重置为默认配置
   */
  reset(): void {
    this.config = { ...DEFAULT_EMBEDDING_CONFIG };
    this.saveConfig(this.config);
    this.notifyListeners();
  }

  // ============ 私有方法 ============

  private loadConfig(): EmbeddingConfig {
    if (typeof window === 'undefined') {
      return { ...DEFAULT_EMBEDDING_CONFIG };
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<EmbeddingConfig>;
        return {
          ...DEFAULT_EMBEDDING_CONFIG,
          ...parsed,
        };
      }
    } catch (error) {
      console.warn('加载 Embedding 配置失败:', error);
    }

    return { ...DEFAULT_EMBEDDING_CONFIG };
  }

  private saveConfig(config: EmbeddingConfig): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      // 不保存 API 密钥到 localStorage（安全考虑）
      const configToSave: EmbeddingConfig = {
        ...config,
        apiKey: undefined, // API 密钥仅在内存中保留
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(configToSave));
    } catch (error) {
      console.warn('保存 Embedding 配置失败:', error);
    }
  }

  private notifyListeners(): void {
    const config = this.getConfig();
    this.listeners.forEach(listener => {
      try {
        listener(config);
      } catch (error) {
        console.error('配置监听器执行失败:', error);
      }
    });
  }
}

// ============ 单例导出 ============

/** 全局配置管理器实例 */
export const embeddingConfigManager = new EmbeddingConfigManager();

/** 便捷方法：获取当前配置 */
export function getEmbeddingConfig(): EmbeddingConfig {
  return embeddingConfigManager.getConfig();
}

/** 便捷方法：更新配置 */
export function updateEmbeddingConfig(updates: Partial<EmbeddingConfig>): void {
  embeddingConfigManager.updateConfig(updates);
}

/** 便捷方法：检查是否启用 */
export function isEmbeddingEnabled(): boolean {
  return embeddingConfigManager.getConfig().enabled;
}
