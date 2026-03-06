import type { AgentConnectionStatus } from '@/types/agent';

export interface ConnectionConfig {
  url: string;
  token?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectInterval?: number;
  heartbeatInterval?: number;
  connectTimeout?: number;
}

export interface ConnectionCallbacks {
  onStatusChange?: (status: AgentConnectionStatus) => void;
  onMessage?: (data: unknown) => void;
  onError?: (error: Error) => void;
  onConnect?: (helloPayload: unknown) => void;
  onDisconnect?: (reason: string) => void;
}

const DEFAULT_CONFIG: Partial<ConnectionConfig> = {
  reconnect: true,
  reconnectInterval: 1000,
  maxReconnectInterval: 30000,
  heartbeatInterval: 30000,
  connectTimeout: 10000,
};

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * HTTP API 连接类
 * 使用 HTTP API + SSE 流式响应替代 WebSocket
 * 
 * 连接流程：
 * 1. connect() -> GET /api/office-website/stream (SSE)
 * 2. send() -> POST /api/office-website/message
 * 3. 断线重连 -> 指数退避
 */
export class HttpConnection {
  private config: ConnectionConfig;
  private callbacks: ConnectionCallbacks;
  private status: AgentConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private isManualClose = false;
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;
  private lastHeartbeatResponse = 0;
  private baseUrl: string = '';

  constructor(config: ConnectionConfig, callbacks: ConnectionCallbacks = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.callbacks = callbacks;
    this.parseBaseUrl();
  }

  /**
   * 解析基础 URL（从 WebSocket URL 转换为 HTTP URL）
   */
  private parseBaseUrl(): void {
    let url = this.config.url;
    // ws:// -> http://, wss:// -> https://
    if (url.startsWith('ws://')) {
      url = url.replace('ws://', 'http://');
    } else if (url.startsWith('wss://')) {
      url = url.replace('wss://', 'https://');
    }
    // 移除末尾的 /ws 或 /websocket
    url = url.replace(/\/(ws|websocket)$/i, '');
    this.baseUrl = url;
  }

  getStatus(): AgentConnectionStatus {
    return this.status;
  }

  private setStatus(newStatus: AgentConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.callbacks.onStatusChange?.(newStatus);
    }
  }

  /**
   * 建立 SSE 连接
   */
  connect(): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    this.isManualClose = false;
    this.setStatus('connecting');
    this.clearTimers();

    // 生成会话 ID
    if (!this.sessionId) {
      this.sessionId = `session-${Date.now()}-${generateId()}`;
    }

    this.startSSEConnection();
  }

  /**
   * 启动 SSE 连接
   */
  private async startSSEConnection(): Promise<void> {
    try {
      this.abortController = new AbortController();
      
      // 构建请求 URL
      const streamUrl = `${this.baseUrl}/api/office-website/stream?sessionId=${encodeURIComponent(this.sessionId!)}`;
      
      // 设置连接超时
      this.setupConnectTimeout();

      // 发起 SSE 请求
      const response = await fetch(streamUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...(this.config.token ? { 'Authorization': `Bearer ${this.config.token}` } : {}),
        },
        signal: this.abortController.signal,
      });

      this.clearConnectTimeout();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // 连接成功
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      this.startHeartbeat();
      
      // 触发连接回调
      this.callbacks.onConnect?.({
        sessionId: this.sessionId,
        type: 'hello-ok',
      });

      // 处理 SSE 流
      await this.handleSSEStream(response.body);

    } catch (error) {
      this.clearConnectTimeout();
      
      if (this.isManualClose) {
        return;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      
      // 用户取消不报错
      if (err.name === 'AbortError') {
        return;
      }

      this.handleError(err);
      this.handleDisconnect(err.message);
    }
  }

  /**
   * 处理 SSE 流
   */
  private async handleSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // 解析 SSE 事件
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留未完成的行

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            eventData = line.substring(5).trim();
          } else if (line === '' && eventData) {
            // 空行表示事件结束
            this.handleSSEEvent(eventType, eventData);
            eventType = '';
            eventData = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 处理 SSE 事件
   */
  private handleSSEEvent(eventType: string, data: string): void {
    try {
      // 心跳事件
      if (eventType === 'tick' || eventType === 'heartbeat' || eventType === 'ping') {
        this.lastHeartbeatResponse = Date.now();
        return;
      }

      // 解析 JSON 数据
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = data;
      }

      // 触发消息回调
      this.callbacks.onMessage?.({
        type: 'event',
        event: eventType,
        payload: parsed,
        id: generateId(),
      });

    } catch (error) {
      console.error('Failed to handle SSE event:', error);
    }
  }

  /**
   * 发送消息（HTTP POST）
   */
  async send(data: unknown): Promise<boolean> {
    if (this.status !== 'connected' || !this.sessionId) {
      return false;
    }

    try {
      const messageUrl = `${this.baseUrl}/api/office-website/message`;
      
      // 构建请求体
      const body: Record<string, unknown> = {
        sessionId: this.sessionId,
        content: typeof data === 'string' ? data : JSON.stringify(data),
      };

      // 如果是请求帧，提取参数
      if (typeof data === 'object' && data !== null) {
        const frame = data as Record<string, unknown>;
        if (frame['type'] === 'req' && frame['method']) {
          body.method = frame['method'];
          body.params = frame['params'];
          body.id = frame['id'];
        }
      }

      const response = await fetch(messageUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.token ? { 'Authorization': `Bearer ${this.config.token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 处理响应
      const result = await response.json();
      
      // 触发响应回调
      if (result) {
        this.callbacks.onMessage?.({
          type: 'res',
          id: body.id as string,
          ok: true,
          payload: result,
        });
      }

      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  /**
   * 同步消息发送（兼容旧接口）
   */
  sendSync(data: unknown): boolean {
    // 异步发送，但立即返回 true
    void this.send(data);
    return true;
  }

  private setupConnectTimeout(): void {
    this.connectTimer = setTimeout(() => {
      if (this.status === 'connecting') {
        this.handleError(new Error('Connection timeout'));
        this.disconnect();
      }
    }, this.config.connectTimeout);
  }

  private clearConnectTimeout(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private handleError(error: Error): void {
    this.setStatus('error');
    this.callbacks.onError?.(error);
  }

  private handleDisconnect(reason: string): void {
    this.stopHeartbeat();
    this.clearConnectTimeout();

    if (this.isManualClose) {
      this.setStatus('disconnected');
      this.callbacks.onDisconnect?.(reason);
    } else {
      this.setStatus('error');
      this.callbacks.onDisconnect?.(reason);

      if (this.config.reconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay = Math.min(
      this.config.reconnectInterval! * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectInterval!
    );

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastHeartbeatResponse = Date.now();

    this.heartbeatTimer = setInterval(() => {
      if (this.status !== 'connected') {
        this.stopHeartbeat();
        return;
      }

      const now = Date.now();
      const timeout = this.config.heartbeatInterval! * 2;
      
      // 检查心跳超时
      if (now - this.lastHeartbeatResponse > timeout) {
        this.abortController?.abort();
        this.handleDisconnect('Heartbeat timeout');
        return;
      }

      // 发送心跳（通过发送一个轻量级请求）
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);
  }

  private async sendHeartbeat(): Promise<void> {
    if (this.status !== 'connected' || !this.sessionId) {
      return;
    }

    try {
      const pingUrl = `${this.baseUrl}/api/office-website/ping?sessionId=${encodeURIComponent(this.sessionId)}`;
      
      await fetch(pingUrl, {
        method: 'GET',
        headers: {
          ...(this.config.token ? { 'Authorization': `Bearer ${this.config.token}` } : {}),
        },
      });
      
      this.lastHeartbeatResponse = Date.now();
    } catch {
      // 心跳失败，连接可能已断开
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearConnectTimeout();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  disconnect(): void {
    this.isManualClose = true;
    this.clearTimers();
    this.reconnectAttempts = 0;

    // 取消 SSE 连接
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.setStatus('disconnected');
  }

  reconnect(): void {
    this.disconnect();
    this.isManualClose = false;
    this.connect();
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  updateConfig(newConfig: Partial<ConnectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.url) {
      this.parseBaseUrl();
    }
  }

  destroy(): void {
    this.disconnect();
    this.callbacks = {};
  }

  /**
   * 获取当前会话 ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }
}

// 兼容性别名
export const WebSocketConnection = HttpConnection;

/**
 * 创建连接实例
 */
export function createWebSocketConnection(
  config: ConnectionConfig,
  callbacks?: ConnectionCallbacks
): HttpConnection {
  return new HttpConnection(config, callbacks);
}

/**
 * 创建 HTTP 连接实例
 */
export function createHttpConnection(
  config: ConnectionConfig,
  callbacks?: ConnectionCallbacks
): HttpConnection {
  return new HttpConnection(config, callbacks);
}
