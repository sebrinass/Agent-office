/**
 * 工具注册中心
 * 管理所有 Agent 工具的注册、调用和结果格式化
 */

import { documentReaderTool, type ToolResult } from './document-reader';
import { documentEditorTool, type EditorToolResult } from './document-editor';
import { vectorStoreTool, type VectorStoreToolResult } from './vector-store-tool';
import { vectorSearchTool, type VectorSearchToolResult } from './vector-search-tool';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 工具基础接口
 */
export interface Tool<TParams = unknown, TResult = unknown> {
  readonly name: string;
  readonly description: string;
  execute(params: TParams): Promise<TResult>;
  getToolDefinition(): ToolDefinition;
}

/**
 * 工具定义（用于 Agent 调用）
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * 工具调用请求
 */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
  id: string;
  name: string;
  success: boolean;
  result?: unknown;
  error?: string;
  timestamp: number;
  duration: number;
}

/**
 * 注册的工具信息
 */
interface RegisteredTool {
  tool: Tool;
  definition: ToolDefinition;
}

// ============================================================================
// 工具注册中心
// ============================================================================

/**
 * 工具注册中心类
 * 管理工具的注册、查询和调用
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private callHistory: ToolCallResult[] = [];
  private maxHistorySize: number = 100;

  /**
   * 注册工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool "${tool.name}" is already registered, overwriting...`);
    }

    this.tools.set(tool.name, {
      tool,
      definition: tool.getToolDefinition(),
    });
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: Tool[]): void {
    tools.forEach((tool) => this.register(tool));
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 获取工具
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  /**
   * 获取工具定义
   */
  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /**
   * 获取所有工具定义
   */
  getAllToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * 检查工具是否存在
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具名称
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 执行工具调用
   */
  async execute(request: ToolCallRequest): Promise<ToolCallResult> {
    const startTime = Date.now();
    const { id, name, arguments: args } = request;

    // 检查工具是否存在
    const registeredTool = this.tools.get(name);
    if (!registeredTool) {
      const result: ToolCallResult = {
        id,
        name,
        success: false,
        error: `Tool "${name}" not found`,
        timestamp: startTime,
        duration: 0,
      };
      this.addToHistory(result);
      return result;
    }

    try {
      // 执行工具
      const toolResult = await registeredTool.tool.execute(args);

      const result: ToolCallResult = {
        id,
        name,
        success: true,
        result: toolResult,
        timestamp: startTime,
        duration: Date.now() - startTime,
      };

      this.addToHistory(result);
      return result;
    } catch (error) {
      const result: ToolCallResult = {
        id,
        name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: startTime,
        duration: Date.now() - startTime,
      };

      this.addToHistory(result);
      return result;
    }
  }

  /**
   * 批量执行工具调用
   */
  async executeBatch(requests: ToolCallRequest[]): Promise<ToolCallResult[]> {
    return Promise.all(requests.map((req) => this.execute(req)));
  }

  /**
   * 添加到调用历史
   */
  private addToHistory(result: ToolCallResult): void {
    this.callHistory.unshift(result);

    // 限制历史记录数量
    if (this.callHistory.length > this.maxHistorySize) {
      this.callHistory = this.callHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * 获取调用历史
   */
  getCallHistory(limit?: number): ToolCallResult[] {
    if (limit) {
      return this.callHistory.slice(0, limit);
    }
    return [...this.callHistory];
  }

  /**
   * 清空调用历史
   */
  clearHistory(): void {
    this.callHistory = [];
  }

  /**
   * 格式化工具结果为 Agent 可读格式
   */
  formatResult(result: ToolCallResult): string {
    if (!result.success) {
      return `Error: ${result.error}`;
    }

    if (result.result === undefined || result.result === null) {
      return 'Success: Operation completed with no return value';
    }

    // 处理 ToolResult 类型
    const toolResult = result.result as ToolResult | EditorToolResult | VectorStoreToolResult | VectorSearchToolResult;
    if ('success' in toolResult) {
      if (!toolResult.success) {
        return `Error: ${toolResult.error}`;
      }

      if (toolResult.data !== undefined) {
        return this.formatData(toolResult.data);
      }

      return 'Success: Operation completed';
    }

    // 其他类型直接返回
    return this.formatData(result.result);
  }

  /**
   * 格式化数据为可读字符串
   */
  private formatData(data: unknown): string {
    if (typeof data === 'string') {
      return data;
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
      return String(data);
    }

    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return '[Unable to format data]';
    }
  }

  /**
   * 获取工具统计信息
   */
  getStats(): {
    totalTools: number;
    totalCalls: number;
    successRate: number;
    averageDuration: number;
  } {
    const totalCalls = this.callHistory.length;
    const successCalls = this.callHistory.filter((c) => c.success).length;
    const totalDuration = this.callHistory.reduce((sum, c) => sum + c.duration, 0);

    return {
      totalTools: this.tools.size,
      totalCalls,
      successRate: totalCalls > 0 ? successCalls / totalCalls : 0,
      averageDuration: totalCalls > 0 ? totalDuration / totalCalls : 0,
    };
  }
}

// ============================================================================
// 全局工具注册中心实例
// ============================================================================

/**
 * 全局工具注册中心
 */
export const toolRegistry = new ToolRegistry();

// ============================================================================
// 初始化注册默认工具
// ============================================================================

/**
 * 初始化并注册所有默认工具
 */
export function initializeTools(): void {
  // 注册文档读取工具
  toolRegistry.register(documentReaderTool);

  // 注册文档编辑工具
  toolRegistry.register(documentEditorTool);

  // 注册向量存储工具
  toolRegistry.register(vectorStoreTool);

  // 注册向量检索工具
  toolRegistry.register(vectorSearchTool);
}

// 自动初始化
if (typeof window !== 'undefined') {
  initializeTools();
}

// ============================================================================
// 导出便捷函数
// ============================================================================

/**
 * 调用工具
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  const id = `call-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  return toolRegistry.execute({ id, name, arguments: args });
}

/**
 * 获取所有可用工具
 */
export function getAvailableTools(): ToolDefinition[] {
  return toolRegistry.getAllToolDefinitions();
}

export default toolRegistry;
