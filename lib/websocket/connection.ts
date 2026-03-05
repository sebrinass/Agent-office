/**
 * WebSocket 连接管理器
 * 负责与 OpenClaw Gateway 建立 WebSocket 连接
 * 支持断线重连、心跳保活、连接状态管理
 */

import type { AgentConnectionStatus } from '@/types/agent';

// 连接配置
export interface ConnectionConfig {
  url: string;
  token?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectInterval?: number;
  heartbeatInterval?: number;
  connectTimeout?: number;
}

// 连接事件回调
export interface ConnectionCallbacks {
  onStatusChange?: (status: AgentConnectionStatus) => void;
  onMessage?: (data: unknown) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
}

// 默认配置
const DEFAULT_CONFIG: Partial<ConnectionConfig> = {
  reconnect: true,
  reconnectInterval: 1000,
  maxReconnectInterval: 30000,
  heartbeatInterval: 30000,
  connectTimeout: 10000,
};

// WebSocket 连接状态
type WSReadyState = typeof WebSocket.CONNECTING | typeof WebSocket.OPEN | typeof WebSocket.CLOSING | typeof WebSocket.CLOSED;

/**
 * WebSocket 连接管理器类
 * 实现断线重连（指数退避）、心跳保活、连接状态管理
 */
export class WebSocketConnection {
  private ws: WebSocket | null = null;
  private config: ConnectionConfig;
  private callbacks: ConnectionCallbacks;
  private status: AgentConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private isManualClose = false;
  private lastHeartbeatResponse = 0;

  constructor(config: ConnectionConfig, callbacks: ConnectionCallbacks = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.callbacks = callbacks;
  }

  /**
   * 获取当前连接状态
   */
  getStatus(): AgentConnectionStatus {
    return this.status;
  }

  /**
   * 更新连接状态并触发回调
   */
  private setStatus(newStatus: AgentConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.callbacks.onStatusChange?.(newStatus);
    }
  }

  /**
   * 连接到 Gateway
   * Token 不再通过 URL 传递，而是在连接建立后通过消息发送
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.isManualClose = false;
    this.setStatus('connecting');
    this.clearTimers();

    try {
      // 不再在 URL 中传递 Token，直接使用原始 URL
      this.ws = new WebSocket(this.config.url);
      this.setupEventHandlers();
      this.setupConnectTimeout();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 设置 WebSocket 事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.clearConnectTimeout();
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      this.startHeartbeat();

      // 连接建立后发送 Token 认证消息（如果配置了 Token）
      if (this.config.token) {
        this.sendAuthMessage(this.config.token);
      }

      this.callbacks.onConnect?.();
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (event) => {
      this.handleError(new Error('WebSocket error'));
    };

    this.ws.onclose = (event) => {
      this.handleClose(event.code, event.reason);
    };
  }

  /**
   * 发送认证消息
   * Token 通过连接后的第一条消息传递，而非 URL 参数
   */
  private sendAuthMessage(token: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      const authMessage = {
        type: 'auth',
        token: token,
        timestamp: Date.now(),
      };
      this.ws.send(JSON.stringify(authMessage));
    } catch {
      // 发送失败，忽略错误
    }
  }

  /**
   * 设置连接超时
   */
  private setupConnectTimeout(): void {
    this.connectTimer = setTimeout(() => {
      if (this.status === 'connecting') {
        this.handleError(new Error('Connection timeout'));
        this.disconnect();
      }
    }, this.config.connectTimeout);
  }

  /**
   * 清除连接超时
   */
  private clearConnectTimeout(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(data: string): void {
    try {
      // 尝试解析 JSON
      const parsed = JSON.parse(data);

      // 处理心跳响应
      if (parsed.type === 'pong' || parsed.event === 'pong') {
        this.lastHeartbeatResponse = Date.now();
        return;
      }

      // 处理 tick 事件（Gateway 心跳）
      if (parsed.event === 'tick') {
        this.lastHeartbeatResponse = Date.now();
        return;
      }

      // 传递给消息回调
      this.callbacks.onMessage?.(parsed);
    } catch {
      // 非 JSON 消息，直接传递
      this.callbacks.onMessage?.(data);
    }
  }

  /**
   * 处理错误
   */
  private handleError(error: Error): void {
    this.setStatus('error');
    this.callbacks.onError?.(error);
  }

  /**
   * 处理连接关闭
   */
  private handleClose(code: number, reason: string): void {
    this.ws = null;
    this.stopHeartbeat();
    this.clearConnectTimeout();

    const reasonText = reason || `Connection closed (code: ${code})`;

    if (this.isManualClose) {
      this.setStatus('disconnected');
      this.callbacks.onDisconnect?.(reasonText);
    } else {
      this.setStatus('error');
      this.callbacks.onDisconnect?.(reasonText);

      // 自动重连
      if (this.config.reconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * 计划重连（指数退避）
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    // 指数退避：baseInterval * 2^attempts，最大不超过 maxReconnectInterval
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

  /**
   * 开始心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastHeartbeatResponse = Date.now();

    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }

      // 检查上次心跳响应是否超时
      const now = Date.now();
      const timeout = this.config.heartbeatInterval! * 2;
      if (now - this.lastHeartbeatResponse > timeout) {
        // 心跳超时，关闭连接并重连
        this.ws.close(4000, 'Heartbeat timeout');
        return;
      }

      // 发送心跳
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);
  }

  /**
   * 发送心跳包
   */
  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    } catch {
      // 发送失败，忽略错误
    }
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 清除所有定时器
   */
  private clearTimers(): void {
    this.clearConnectTimeout();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.isManualClose = true;
    this.clearTimers();
    this.reconnectAttempts = 0;

    if (this.ws) {
      const readyState = this.ws.readyState;
      if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Manual disconnect');
      }
      this.ws = null;
    }

    this.setStatus('disconnected');
  }

  /**
   * 重新连接
   */
  reconnect(): void {
    this.disconnect();
    this.isManualClose = false;
    this.connect();
  }

  /**
   * 发送消息
   */
  send(data: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      this.ws.send(message);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<ConnectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 销毁连接管理器
   */
  destroy(): void {
    this.disconnect();
    this.callbacks = {};
  }
}

/**
 * 创建 WebSocket 连接实例
 */
export function createWebSocketConnection(
  config: ConnectionConfig,
  callbacks?: ConnectionCallbacks
): WebSocketConnection {
  return new WebSocketConnection(config, callbacks);
}
