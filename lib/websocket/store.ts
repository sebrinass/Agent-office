/**
 * WebSocket 状态管理
 * 使用 Zustand 管理连接状态、Gateway 配置、消息列表
 * 支持 localStorage 持久化
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AgentConnectionStatus, AgentMessage, AgentPermission } from '@/types/agent';
import { WebSocketConnection, createWebSocketConnection, type ConnectionConfig } from './connection';
import { MessageHandler, createMessageHandler, frameToAgentMessage, type ChatFrame } from './message-handler';

// 持久化配置（存储在 localStorage）
interface PersistedState {
  gatewayUrl: string;
  gatewayToken: string;
  autoConnect: boolean;
  defaultPermissions: AgentPermission[];
}

// 运行时状态（不持久化）
interface RuntimeState {
  status: AgentConnectionStatus;
  messages: AgentMessage[];
  permissions: AgentPermission[];
  error: string | null;
  reconnectAttempts: number;
  lastConnectedAt: number | null;
}

// 操作方法
interface Actions {
  // 连接管理
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;

  // 配置管理
  setGatewayUrl: (url: string) => void;
  setGatewayToken: (token: string) => void;
  setAutoConnect: (auto: boolean) => void;

  // 权限管理
  setPermissions: (permissions: AgentPermission[]) => void;
  togglePermission: (permission: AgentPermission) => void;

  // 消息管理
  sendMessage: (content: string) => boolean;
  addMessage: (message: AgentMessage) => void;
  clearMessages: () => void;

  // 内部方法
  _setStatus: (status: AgentConnectionStatus) => void;
  _setError: (error: string | null) => void;
  _setReconnectAttempts: (attempts: number) => void;
  _setLastConnectedAt: (timestamp: number | null) => void;
}

// 完整状态类型
type WebSocketStore = PersistedState & RuntimeState & Actions;

// 默认 Gateway URL
const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789';

// 默认权限（查看权限永久开启）
const DEFAULT_PERMISSIONS: AgentPermission[] = ['view'];

// 默认持久化状态
const defaultPersistedState: PersistedState = {
  gatewayUrl: DEFAULT_GATEWAY_URL,
  gatewayToken: '',
  autoConnect: false,
  defaultPermissions: DEFAULT_PERMISSIONS,
};

// 默认运行时状态
const defaultRuntimeState: RuntimeState = {
  status: 'disconnected',
  messages: [],
  permissions: DEFAULT_PERMISSIONS,
  error: null,
  reconnectAttempts: 0,
  lastConnectedAt: null,
};

// 连接实例（不存储在 store 中）
let connection: WebSocketConnection | null = null;
let messageHandler: MessageHandler | null = null;

/**
 * 创建 WebSocket Store
 */
export const useWebSocketStore = create<WebSocketStore>()(
  persist(
    (set, get) => ({
      // 持久化状态
      ...defaultPersistedState,

      // 运行时状态
      ...defaultRuntimeState,

      // 连接管理
      connect: () => {
        const state = get();

        // 如果已连接或正在连接，不重复连接
        if (state.status === 'connected' || state.status === 'connecting') {
          return;
        }

        // 清理旧连接
        if (connection) {
          connection.destroy();
          connection = null;
        }
        if (messageHandler) {
          messageHandler.destroy();
          messageHandler = null;
        }

        // 创建消息处理器
        messageHandler = createMessageHandler(
          (data) => connection?.send(data) ?? false,
          { requestTimeout: 30000, maxQueueSize: 100 }
        );

        // 订阅聊天消息
        messageHandler.on('chat', (payload) => {
          const frame = payload as ChatFrame;
          const message = frameToAgentMessage(frame);
          get().addMessage(message);
        });

        // 订阅 agent 事件
        messageHandler.on('agent', (payload) => {
          // 处理 Agent 响应
          console.log('Agent event:', payload);
        });

        // 创建连接
        const config: ConnectionConfig = {
          url: state.gatewayUrl,
          token: state.gatewayToken || undefined,
          reconnect: true,
          reconnectInterval: 1000,
          maxReconnectInterval: 30000,
          heartbeatInterval: 30000,
          connectTimeout: 10000,
        };

        connection = createWebSocketConnection(config, {
          onStatusChange: (status) => {
            get()._setStatus(status);
            if (status === 'connected') {
              get()._setLastConnectedAt(Date.now());
              get()._setReconnectAttempts(0);
            }
          },
          onMessage: (data) => {
            messageHandler?.handleIncoming(data);
          },
          onError: (error) => {
            get()._setError(error.message);
          },
          onConnect: () => {
            get()._setError(null);
          },
          onDisconnect: (reason) => {
            console.log('Disconnected:', reason);
          },
        });

        connection.connect();
      },

      disconnect: () => {
        if (connection) {
          connection.disconnect();
        }
        set({ status: 'disconnected' });
      },

      reconnect: () => {
        if (connection) {
          connection.reconnect();
        } else {
          get().connect();
        }
      },

      // 配置管理
      setGatewayUrl: (url) => {
        set({ gatewayUrl: url });
      },

      setGatewayToken: (token) => {
        set({ gatewayToken: token });
      },

      setAutoConnect: (auto) => {
        set({ autoConnect: auto });
      },

      // 权限管理
      setPermissions: (permissions) => {
        // 确保 view 权限始终存在
        const newPermissions: AgentPermission[] = permissions.includes('view')
          ? permissions
          : (['view', ...permissions] as AgentPermission[]);
        set({ permissions: newPermissions });
      },

      togglePermission: (permission) => {
        const { permissions } = get();

        // view 权限不能关闭
        if (permission === 'view') {
          return;
        }

        const newPermissions: AgentPermission[] = permissions.includes(permission)
          ? permissions.filter((p) => p !== permission)
          : ([...permissions, permission] as AgentPermission[]);

        set({ permissions: newPermissions });
      },

      // 消息管理
      sendMessage: (content) => {
        if (!messageHandler) {
          return false;
        }

        // 添加用户消息到列表
        const userMessage: AgentMessage = {
          id: `${Date.now()}-user-${Math.random().toString(36).substring(2, 9)}`,
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        get().addMessage(userMessage);

        // 发送消息
        return messageHandler.sendChat(content, 'user');
      },

      addMessage: (message) => {
        set((state) => ({
          messages: [...state.messages, message],
        }));
      },

      clearMessages: () => {
        set({ messages: [] });
      },

      // 内部方法
      _setStatus: (status) => set({ status }),
      _setError: (error) => set({ error }),
      _setReconnectAttempts: (attempts) => set({ reconnectAttempts: attempts }),
      _setLastConnectedAt: (timestamp) => set({ lastConnectedAt: timestamp }),
    }),
    {
      name: 'websocket-store',
      storage: createJSONStorage(() => localStorage),
      // 只持久化配置，不持久化运行时状态
      partialize: (state) => ({
        gatewayUrl: state.gatewayUrl,
        gatewayToken: state.gatewayToken,
        autoConnect: state.autoConnect,
        defaultPermissions: state.defaultPermissions,
      }),
    }
  )
);

/**
 * 获取当前连接实例（用于高级操作）
 */
export function getConnection(): WebSocketConnection | null {
  return connection;
}

/**
 * 获取当前消息处理器实例
 */
export function getMessageHandler(): MessageHandler | null {
  return messageHandler;
}

/**
 * 初始化连接（如果配置了自动连接）
 */
export function initializeConnection(): void {
  const state = useWebSocketStore.getState();
  if (state.autoConnect && state.gatewayUrl) {
    state.connect();
  }
}

/**
 * 销毁连接
 */
export function destroyConnection(): void {
  if (connection) {
    connection.destroy();
    connection = null;
  }
  if (messageHandler) {
    messageHandler.destroy();
    messageHandler = null;
  }
}

/**
 * 状态选择器
 */
export const selectStatus = (state: WebSocketStore) => state.status;
export const selectMessages = (state: WebSocketStore) => state.messages;
export const selectPermissions = (state: WebSocketStore) => state.permissions;
export const selectGatewayUrl = (state: WebSocketStore) => state.gatewayUrl;
export const selectError = (state: WebSocketStore) => state.error;
export const selectIsConnected = (state: WebSocketStore) => state.status === 'connected';
export const selectIsConnecting = (state: WebSocketStore) => state.status === 'connecting';
