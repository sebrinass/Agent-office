/**
 * WebSocket 模块导出
 * 提供 WebSocket 连接、消息处理、状态管理的完整功能
 */

// 连接管理
export {
  WebSocketConnection,
  createWebSocketConnection,
  type ConnectionConfig,
  type ConnectionCallbacks,
} from './connection';

// 消息处理
export {
  MessageHandler,
  createMessageHandler,
  frameToAgentMessage,
  agentMessageToFrame,
  type MessageType,
  type MessageFrame,
  type RequestFrame,
  type ResponseFrame,
  type EventFrame,
  type ChatFrame,
  type MessageHandlerConfig,
} from './message-handler';

// 状态管理
export {
  useWebSocketStore,
  getConnection,
  getMessageHandler,
  initializeConnection,
  destroyConnection,
  selectStatus,
  selectMessages,
  selectPermissions,
  selectGatewayUrl,
  selectError,
  selectIsConnected,
  selectIsConnecting,
} from './store';
