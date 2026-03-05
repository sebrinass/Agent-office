/**
 * WebSocket 消息处理器
 * 负责消息的发送、接收、队列管理和事件订阅
 */

import type { AgentMessage } from '@/types/agent';

// 消息类型定义
export type MessageType =
  | 'req'      // 请求消息
  | 'res'      // 响应消息
  | 'event'    // 事件消息
  | 'chat'     // 聊天消息
  | 'agent'    // Agent 消息
  | 'system';  // 系统消息

// 基础消息帧结构
export interface MessageFrame {
  type: MessageType;
  id: string;
  [key: string]: unknown;
}

// 请求消息
export interface RequestFrame extends MessageFrame {
  type: 'req';
  method: string;
  params?: unknown;
}

// 响应消息
export interface ResponseFrame extends MessageFrame {
  type: 'res';
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

// 事件消息
export interface EventFrame extends MessageFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

// 聊天消息
export interface ChatFrame extends MessageFrame {
  type: 'chat';
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

// 待处理请求
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// 事件监听器类型
type EventListener = (payload: unknown) => void;

// 消息处理器配置
export interface MessageHandlerConfig {
  requestTimeout?: number;
  maxQueueSize?: number;
}

// 默认配置
const DEFAULT_CONFIG: MessageHandlerConfig = {
  requestTimeout: 30000,
  maxQueueSize: 100,
};

/**
 * 消息处理器类
 * 实现消息发送/接收、队列管理、事件订阅
 */
export class MessageHandler {
  private config: MessageHandlerConfig;
  private sendFn: (data: unknown) => boolean;
  private pendingRequests = new Map<string, PendingRequest>();
  private messageQueue: unknown[] = [];
  private eventListeners = new Map<string, Set<EventListener>>();
  private messageIdCounter = 0;

  constructor(sendFn: (data: unknown) => boolean, config: MessageHandlerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sendFn = sendFn;
  }

  /**
   * 生成唯一消息 ID
   */
  private generateId(): string {
    this.messageIdCounter++;
    return `${Date.now()}-${this.messageIdCounter}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 发送请求消息（等待响应）
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.generateId();
      const frame: RequestFrame = { type: 'req', id, method, params };

      // 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.config.requestTimeout);

      // 存储待处理请求
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      // 发送消息
      if (!this.sendFn(frame)) {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(new Error('Failed to send request'));
      }
    });
  }

  /**
   * 发送响应消息
   */
  respond(id: string, ok: boolean, payload?: unknown, error?: { code: string; message: string }): boolean {
    const frame: ResponseFrame = { type: 'res', id, ok, payload, error };
    return this.sendFn(frame);
  }

  /**
   * 发送事件消息
   */
  emit(event: string, payload?: unknown): boolean {
    const frame: EventFrame = { type: 'event', id: this.generateId(), event, payload };
    return this.sendFn(frame);
  }

  /**
   * 发送聊天消息
   */
  sendChat(content: string, role: 'user' | 'agent' | 'system' = 'user'): boolean {
    const frame: ChatFrame = {
      type: 'chat',
      id: this.generateId(),
      role,
      content,
      timestamp: Date.now(),
    };
    return this.sendFn(frame);
  }

  /**
   * 发送原始消息（加入队列）
   */
  send(data: unknown): boolean {
    // 检查队列大小
    if (this.messageQueue.length >= this.config.maxQueueSize!) {
      this.messageQueue.shift(); // 移除最旧的消息
    }

    this.messageQueue.push(data);
    return this.sendFn(data);
  }

  /**
   * 处理接收到的消息
   */
  handleIncoming(data: unknown): void {
    // 解析消息帧
    const frame = this.parseFrame(data);
    if (!frame) {
      // 非 JSON 或无法解析，触发原始消息事件
      this.dispatchEvent('raw', data);
      return;
    }

    switch (frame.type) {
      case 'res':
        this.handleResponse(frame as ResponseFrame);
        break;
      case 'event':
        this.handleEvent(frame as EventFrame);
        break;
      case 'chat':
        this.handleChat(frame as ChatFrame);
        break;
      case 'req':
        this.handleRequest(frame as RequestFrame);
        break;
      default:
        this.dispatchEvent('unknown', frame);
    }
  }

  /**
   * 解析消息帧
   */
  private parseFrame(data: unknown): MessageFrame | null {
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return null;
      }
    }

    if (typeof data !== 'object' || data === null) {
      return null;
    }

    const frame = data as Record<string, unknown>;
    if (typeof frame['type'] !== 'string' || typeof frame['id'] !== 'string') {
      return null;
    }

    return frame as MessageFrame;
  }

  /**
   * 处理响应消息
   */
  private handleResponse(frame: ResponseFrame): void {
    const pending = this.pendingRequests.get(frame.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(frame.id);

    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      const error = frame.error || { code: 'UNKNOWN', message: 'Unknown error' };
      pending.reject(new Error(`${error.code}: ${error.message}`));
    }
  }

  /**
   * 处理事件消息
   */
  private handleEvent(frame: EventFrame): void {
    this.dispatchEvent(frame.event, frame.payload);
    this.dispatchEvent('*', frame); // 通配符监听
  }

  /**
   * 处理聊天消息
   */
  private handleChat(frame: ChatFrame): void {
    this.dispatchEvent('chat', frame);
  }

  /**
   * 处理请求消息（需要外部处理）
   */
  private handleRequest(frame: RequestFrame): void {
    this.dispatchEvent('request', frame);
  }

  /**
   * 订阅事件
   */
  on(event: string, listener: EventListener): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);

    // 返回取消订阅函数
    return () => this.off(event, listener);
  }

  /**
   * 取消订阅事件
   */
  off(event: string, listener: EventListener): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  /**
   * 一次性订阅事件
   */
  once(event: string, listener: EventListener): () => void {
    const wrapper: EventListener = (payload) => {
      this.off(event, wrapper);
      listener(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * 分发事件
   */
  private dispatchEvent(event: string, payload: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch (error) {
          console.error(`Event listener error (${event}):`, error);
        }
      });
    }
  }

  /**
   * 获取消息队列
   */
  getQueue(): unknown[] {
    return [...this.messageQueue];
  }

  /**
   * 清空消息队列
   */
  clearQueue(): void {
    this.messageQueue = [];
  }

  /**
   * 获取待处理请求数量
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * 清除所有待处理请求
   */
  clearPending(error?: Error): void {
    const err = error || new Error('Connection closed');
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(err);
    });
    this.pendingRequests.clear();
  }

  /**
   * 更新发送函数
   */
  updateSendFn(sendFn: (data: unknown) => boolean): void {
    this.sendFn = sendFn;
  }

  /**
   * 销毁消息处理器
   */
  destroy(): void {
    this.clearPending(new Error('Handler destroyed'));
    this.clearQueue();
    this.eventListeners.clear();
  }
}

/**
 * 将消息帧转换为 AgentMessage 格式
 */
export function frameToAgentMessage(frame: ChatFrame): AgentMessage {
  return {
    id: frame.id,
    role: frame.role,
    content: frame.content,
    timestamp: frame.timestamp,
  };
}

/**
 * 将 AgentMessage 转换为消息帧
 */
export function agentMessageToFrame(message: AgentMessage): ChatFrame {
  return {
    type: 'chat',
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    metadata: message.metadata,
  };
}

/**
 * 创建消息处理器实例
 */
export function createMessageHandler(
  sendFn: (data: unknown) => boolean,
  config?: MessageHandlerConfig
): MessageHandler {
  return new MessageHandler(sendFn, config);
}
