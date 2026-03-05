/**
 * Agent 相关类型定义
 * 用于 office-website 与 OpenClaw Agent 的协作
 */

// Agent 连接状态
export type AgentConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

// Agent 权限级别
export type AgentPermission = 'view' | 'annotate' | 'edit';

// Agent 会话消息
export interface AgentMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// Agent 会话
export interface AgentSession {
  id: string;
  gatewayUrl: string;
  status: AgentConnectionStatus;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

// Agent 工具调用
export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

// 文档操作类型
export type DocumentOperationType = 'insert' | 'replace' | 'delete' | 'annotate';

// 文档操作记录
export interface DocumentOperation {
  id: string;
  type: DocumentOperationType;
  position: number;
  content?: string;
  length?: number;
  timestamp: number;
  agentId?: string;
}

// 向量存储记录
export interface VectorRecord {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  createdAt: number;
}
