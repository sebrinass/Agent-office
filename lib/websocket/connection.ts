import type { AgentConnectionStatus, ConnectionMode } from '@/types/agent';

export interface ConnectionConfig {
  url: string;
  token?: string;
  scopes?: string[];
  mode?: ConnectionMode;
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
  mode: 'http-api',
  reconnect: true,
  reconnectInterval: 1000,
  maxReconnectInterval: 30000,
  heartbeatInterval: 30000,
  connectTimeout: 10000,
};

const GATEWAY_PROTOCOL_VERSION = 3;
const OFFICE_WEBSITE_CLIENT_VERSION = '1.0.0';

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

  private parseBaseUrl(): void {
    let url = this.config.url;
    if (url.startsWith('ws://')) {
      url = url.replace('ws://', 'http://');
    } else if (url.startsWith('wss://')) {
      url = url.replace('wss://', 'https://');
    }
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

  connect(): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    this.isManualClose = false;
    this.setStatus('connecting');
    this.clearTimers();

    if (!this.sessionId) {
      this.sessionId = `session-${Date.now()}-${generateId()}`;
    }

    void this.startSSEConnection();
  }

  private async startSSEConnection(): Promise<void> {
    try {
      this.abortController = new AbortController();
      const streamUrl = `${this.baseUrl}/api/office-website/stream?sessionId=${encodeURIComponent(this.sessionId!)}`;
      this.setupConnectTimeout();

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

      this.reconnectAttempts = 0;
      this.setStatus('connected');
      this.startHeartbeat();
      this.callbacks.onConnect?.({
        sessionId: this.sessionId,
        type: 'hello-ok',
      });

      await this.handleSSEStream(response.body);
    } catch (error) {
      this.clearConnectTimeout();
      if (this.isManualClose) {
        return;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === 'AbortError') {
        return;
      }

      this.handleError(err);
      this.handleDisconnect(err.message);
    }
  }

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
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            eventData = line.substring(5).trim();
          } else if (line === '' && eventData) {
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

  private handleSSEEvent(eventType: string, data: string): void {
    try {
      if (eventType === 'tick' || eventType === 'heartbeat' || eventType === 'ping') {
        this.lastHeartbeatResponse = Date.now();
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = data;
      }

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

  async send(data: unknown): Promise<boolean> {
    if (this.status !== 'connected' || !this.sessionId) {
      return false;
    }

    try {
      const messageUrl = `${this.baseUrl}/api/office-website/message`;
      const body: Record<string, unknown> = {
        sessionId: this.sessionId,
        content: typeof data === 'string' ? data : JSON.stringify(data),
      };

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

      const result = await response.json();
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

  sendSync(data: unknown): boolean {
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
      if (now - this.lastHeartbeatResponse > timeout) {
        this.abortController?.abort();
        this.handleDisconnect('Heartbeat timeout');
        return;
      }

      void this.sendHeartbeat();
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

  getSessionId(): string | null {
    return this.sessionId;
  }
}

export function createHttpConnection(
  config: ConnectionConfig,
  callbacks?: ConnectionCallbacks
): HttpConnection {
  return new HttpConnection(config, callbacks);
}

/**
 * 真正的 WebSocket 连接类
 * 使用 OpenClaw Gateway 的 connect 握手协议
 */
export class WebSocketConnectionImpl {
  private config: ConnectionConfig;
  private callbacks: ConnectionCallbacks;
  private status: AgentConnectionStatus = 'disconnected';
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private isManualClose = false;
  private handshakeRequestId: string | null = null;
  private lastServerActivityAt = 0;

  constructor(config: ConnectionConfig, callbacks: ConnectionCallbacks = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.callbacks = callbacks;
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

  connect(): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    this.isManualClose = false;
    this.setStatus('connecting');
    this.clearTimers();

    try {
      let wsUrl = this.config.url;
      if (wsUrl.startsWith('http://')) {
        wsUrl = wsUrl.replace('http://', 'ws://');
      } else if (wsUrl.startsWith('https://')) {
        wsUrl = wsUrl.replace('https://', 'wss://');
      }

      this.ws = new WebSocket(wsUrl);
      this.handshakeRequestId = null;
      this.lastServerActivityAt = Date.now();
      this.setupConnectTimeout();

      this.ws.onopen = () => {
        this.lastServerActivityAt = Date.now();
      };

      this.ws.onmessage = (event) => {
        this.lastServerActivityAt = Date.now();
        try {
          const data = JSON.parse(event.data);
          if (this.handleHandshakeFrame(data)) {
            return;
          }
          this.callbacks.onMessage?.(data);
        } catch {
          this.callbacks.onMessage?.(event.data);
        }
      };

      this.ws.onerror = () => {
        this.clearConnectTimeout();
        this.handleError(new Error('WebSocket error'));
      };

      this.ws.onclose = (event) => {
        this.clearConnectTimeout();
        this.handleDisconnect(event.reason || 'Connection closed');
      };
    } catch (error) {
      this.clearConnectTimeout();
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err);
      this.handleDisconnect(err.message);
    }
  }

  private handleHandshakeFrame(data: any): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    if (data.type === 'event' && data.event === 'connect.challenge') {
      this.sendConnectRequest();
      return true;
    }

    if (
      data.type === 'res' &&
      typeof data.id === 'string' &&
      data.id === this.handshakeRequestId
    ) {
      if (!data.ok) {
        const message = data.error?.message || data.error?.code || 'WebSocket handshake failed';
        this.clearConnectTimeout();
        this.handleError(new Error(message));
        this.disconnect();
        return true;
      }

      const payload = data.payload;
      if (payload?.type !== 'hello-ok') {
        this.clearConnectTimeout();
        this.handleError(new Error('Invalid WebSocket handshake response'));
        this.disconnect();
        return true;
      }

      this.clearConnectTimeout();
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      this.startHeartbeat();
      this.callbacks.onConnect?.(payload);
      return true;
    }

    return false;
  }

  private sendConnectRequest(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.handshakeRequestId) {
      return;
    }

    this.handshakeRequestId = generateId();

    const frame = {
      type: 'req',
      id: this.handshakeRequestId,
      method: 'connect',
      params: {
        minProtocol: GATEWAY_PROTOCOL_VERSION,
        maxProtocol: GATEWAY_PROTOCOL_VERSION,
        client: {
          id: 'webchat',
          displayName: 'office-website',
          version: OFFICE_WEBSITE_CLIENT_VERSION,
          platform: typeof navigator !== 'undefined' ? navigator.platform || 'web' : 'web',
          deviceFamily: 'browser',
          mode: 'webchat',
        },
        role: 'operator',
        scopes: this.config.scopes,
        auth: this.config.token ? { token: this.config.token } : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'office-website',
        locale: typeof navigator !== 'undefined' ? navigator.language : 'en',
      },
    };

    this.ws.send(JSON.stringify(frame));
  }

  async send(data: unknown): Promise<boolean> {
    if (this.status !== 'connected' || !this.ws) {
      return false;
    }

    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      this.ws.send(message);
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  sendSync(data: unknown): boolean {
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
    this.handshakeRequestId = null;

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
    this.lastServerActivityAt = Date.now();

    this.heartbeatTimer = setInterval(() => {
      if (this.status !== 'connected' || !this.ws) {
        this.stopHeartbeat();
        return;
      }

      const now = Date.now();
      const timeout = this.config.heartbeatInterval! * 3;
      if (now - this.lastServerActivityAt > timeout) {
        this.handleDisconnect('WebSocket heartbeat timeout');
      }
    }, this.config.heartbeatInterval);
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
    this.handshakeRequestId = null;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
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
  }

  destroy(): void {
    this.disconnect();
    this.callbacks = {};
  }
}

export function createWebSocketConnection(
  config: ConnectionConfig,
  callbacks?: ConnectionCallbacks
): WebSocketConnectionImpl {
  return new WebSocketConnectionImpl(config, callbacks);
}

export type UnifiedConnection = HttpConnection | WebSocketConnectionImpl;
export type WebSocketConnection = WebSocketConnectionImpl;

export function createConnection(
  config: ConnectionConfig,
  callbacks?: ConnectionCallbacks
): UnifiedConnection {
  const mode = config.mode || DEFAULT_CONFIG.mode;

  if (mode === 'websocket') {
    return new WebSocketConnectionImpl(config, callbacks);
  }
  return new HttpConnection(config, callbacks);
}
