/**
 * WebSocket 状态管理
 * 使用 Zustand 管理连接状态、Gateway 配置、消息列表
 * 支持 localStorage 持久化
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AgentConnectionStatus, AgentMessage, AgentPermission, ConnectionMode } from '@/types/agent';
import { createConnection, type UnifiedConnection, type ConnectionConfig } from './connection';
import { MessageHandler, createMessageHandler, frameToAgentMessage } from './message-handler';

const GATEWAY_OPERATOR_SCOPES = ['operator.read', 'operator.write'] as const;

interface PersistedState {
  gatewayUrl: string;
  gatewayToken: string;
  connectionMode: ConnectionMode;
  autoConnect: boolean;
  defaultPermissions: AgentPermission[];
}

interface RuntimeState {
  status: AgentConnectionStatus;
  messages: AgentMessage[];
  permissions: AgentPermission[];
  error: string | null;
  reconnectAttempts: number;
  lastConnectedAt: number | null;
  sessionKey: string | null;
  isSending: boolean;
}

interface Actions {
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  setGatewayUrl: (url: string) => void;
  setGatewayToken: (token: string) => void;
  setConnectionMode: (mode: ConnectionMode) => void;
  setAutoConnect: (auto: boolean) => void;
  setPermissions: (permissions: AgentPermission[]) => void;
  togglePermission: (permission: AgentPermission) => void;
  sendMessage: (content: string) => Promise<boolean>;
  addMessage: (message: AgentMessage) => void;
  clearMessages: () => void;
  _setStatus: (status: AgentConnectionStatus) => void;
  _setError: (error: string | null) => void;
  _setReconnectAttempts: (attempts: number) => void;
  _setLastConnectedAt: (timestamp: number | null) => void;
}

type WebSocketStore = PersistedState & RuntimeState & Actions;

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789';
const DEFAULT_PERMISSIONS: AgentPermission[] = ['view'];

const defaultPersistedState: PersistedState = {
  gatewayUrl: DEFAULT_GATEWAY_URL,
  gatewayToken: '',
  connectionMode: 'websocket',
  autoConnect: false,
  defaultPermissions: DEFAULT_PERMISSIONS,
};

const defaultRuntimeState: RuntimeState = {
  status: 'disconnected',
  messages: [],
  permissions: DEFAULT_PERMISSIONS,
  error: null,
  reconnectAttempts: 0,
  lastConnectedAt: null,
  sessionKey: null,
  isSending: false,
};

let connection: UnifiedConnection | null = null;
let messageHandler: MessageHandler | null = null;

export const useWebSocketStore = create<WebSocketStore>()(
  persist(
    (set, get) => ({
      ...defaultPersistedState,
      ...defaultRuntimeState,

      connect: () => {
        const state = get();

        if (state.status === 'connected' || state.status === 'connecting') {
          return;
        }

        if (connection) {
          connection.destroy();
          connection = null;
        }
        if (messageHandler) {
          messageHandler.destroy();
          messageHandler = null;
        }

        messageHandler = createMessageHandler(
          async (data) => (await connection?.send(data)) ?? false,
          { requestTimeout: 30000, maxQueueSize: 100 }
        );

        messageHandler.on('chat', (payload) => {
          const frame = payload as any;
          if (frame.state === 'final' || frame.state === 'delta') {
            const message = frameToAgentMessage(frame);
            if (message.role === 'agent') {
              get().addMessage(message);
            }
          }
        });

        messageHandler.on('agent', (payload) => {
          console.log('Agent event:', payload);
        });

        const config: ConnectionConfig = {
          url: state.gatewayUrl,
          token: state.gatewayToken || undefined,
          scopes: [...GATEWAY_OPERATOR_SCOPES],
          mode: state.connectionMode,
          reconnect: true,
          reconnectInterval: 1000,
          maxReconnectInterval: 30000,
          heartbeatInterval: 30000,
          connectTimeout: 10000,
        };

        connection = createConnection(config, {
          onStatusChange: (status) => {
            get()._setStatus(status);
            if (status === 'connected') {
              get()._setLastConnectedAt(Date.now());
              get()._setReconnectAttempts(0);
            }
          },
          onConnect: (helloPayload) => {
            get()._setError(null);

            const payload = helloPayload as any;
            const mainSessionKey = payload?.snapshot?.sessionDefaults?.mainSessionKey;
            if (mainSessionKey) {
              set({ sessionKey: mainSessionKey });
              return;
            }

            if (state.connectionMode === 'websocket' && messageHandler) {
              void messageHandler
                .resolveSessionKey()
                .then((resolvedSessionKey) => {
                  if (resolvedSessionKey) {
                    set({ sessionKey: resolvedSessionKey });
                  }
                })
                .catch((err) => {
                  console.warn('Failed to resolve main session key:', err);
                });
            }
          },
          onMessage: (data) => {
            messageHandler?.handleIncoming(data);
          },
          onError: (error) => {
            get()._setError(error.message);
          },
          onDisconnect: (reason) => {
            console.log('Disconnected:', reason);
            set({ sessionKey: null });
          },
        });

        connection.connect();
      },

      disconnect: () => {
        if (connection) {
          connection.disconnect();
        }
        set({ status: 'disconnected', sessionKey: null });
      },

      reconnect: () => {
        if (connection) {
          connection.reconnect();
        } else {
          get().connect();
        }
      },

      setGatewayUrl: (url) => {
        set({ gatewayUrl: url });
      },

      setGatewayToken: (token) => {
        set({ gatewayToken: token });
      },

      setConnectionMode: (mode) => {
        set({ connectionMode: mode });
      },

      setAutoConnect: (auto) => {
        set({ autoConnect: auto });
      },

      setPermissions: (permissions) => {
        const newPermissions: AgentPermission[] = permissions.includes('view')
          ? permissions
          : (['view', ...permissions] as AgentPermission[]);
        set({ permissions: newPermissions });
      },

      togglePermission: (permission) => {
        const { permissions } = get();

        if (permission === 'view') {
          return;
        }

        const newPermissions: AgentPermission[] = permissions.includes(permission)
          ? permissions.filter((p) => p !== permission)
          : ([...permissions, permission] as AgentPermission[]);

        set({ permissions: newPermissions });
      },

      sendMessage: async (content) => {
        const state = get();
        if (!messageHandler || !state.sessionKey) {
          return false;
        }

        const userMessage: AgentMessage = {
          id: `${Date.now()}-user-${Math.random().toString(36).substring(2, 9)}`,
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        state.addMessage(userMessage);
        set({ isSending: true });

        try {
          await messageHandler.sendChat(content, state.sessionKey);
          return true;
        } catch (err) {
          console.error('Failed to send message:', err);
          set({ error: err instanceof Error ? err.message : 'Failed to send message' });
          return false;
        } finally {
          set({ isSending: false });
        }
      },

      addMessage: (message) => {
        set((currentState) => ({
          messages: [...currentState.messages, message],
        }));
      },

      clearMessages: () => {
        set({ messages: [] });
      },

      _setStatus: (status) => set({ status }),
      _setError: (error) => set({ error }),
      _setReconnectAttempts: (attempts) => set({ reconnectAttempts: attempts }),
      _setLastConnectedAt: (timestamp) => set({ lastConnectedAt: timestamp }),
    }),
    {
      name: 'websocket-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        gatewayUrl: state.gatewayUrl,
        gatewayToken: state.gatewayToken,
        connectionMode: state.connectionMode,
        autoConnect: state.autoConnect,
        defaultPermissions: state.defaultPermissions,
      }),
    }
  )
);

export function getConnection(): UnifiedConnection | null {
  return connection;
}

export function getMessageHandler(): MessageHandler | null {
  return messageHandler;
}

export function initializeConnection(): void {
  const state = useWebSocketStore.getState();
  if (state.autoConnect && state.gatewayUrl) {
    state.connect();
  }
}

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

export const selectStatus = (state: WebSocketStore) => state.status;
export const selectMessages = (state: WebSocketStore) => state.messages;
export const selectPermissions = (state: WebSocketStore) => state.permissions;
export const selectGatewayUrl = (state: WebSocketStore) => state.gatewayUrl;
export const selectError = (state: WebSocketStore) => state.error;
export const selectIsConnected = (state: WebSocketStore) => state.status === 'connected';
export const selectIsConnecting = (state: WebSocketStore) => state.status === 'connecting';
export const selectIsSending = (state: WebSocketStore) => state.isSending;
export const selectSessionKey = (state: WebSocketStore) => state.sessionKey;
export const selectConnectionMode = (state: WebSocketStore) => state.connectionMode;
