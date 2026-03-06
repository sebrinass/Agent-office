/**
 * Agent 相关类型定义
 * 用于 office-website 与 OpenClaw Agent 的协作
 */

// Agent 连接状态
export type AgentConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

// Agent 权限级别
export type AgentPermission = 'view' | 'annotate' | 'edit';

// 富文本块类型
export type RichTextBlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'code'
  | 'quote'
  | 'image'
  | 'link'
  | 'table';

// 富文本块结构
export interface RichTextBlock {
  type: RichTextBlockType;
  content: string;
  level?: number;
  ordered?: boolean;
  language?: string;
  url?: string;
  alt?: string;
  rows?: string[][];
}

// 媒体附件类型
export interface MediaAttachment {
  type: 'image' | 'audio' | 'video' | 'document';
  filename: string;
  mimeType: string;
  url?: string;
  base64?: string;
  size?: number;
  thumbnail?: string;
}

// Agent 会话消息
export interface AgentMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  // 富文本支持
  blocks?: RichTextBlock[];
  // 媒体附件
  attachments?: MediaAttachment[];
  // 流式响应
  streamId?: string;
  isComplete?: boolean;
  // 格式
  format?: 'plain' | 'markdown' | 'html';
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
