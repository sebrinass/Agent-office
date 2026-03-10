/**
 * Office-Website Plugin Runtime
 *
 * Provides access to PluginRuntime APIs for the office-website channel.
 * This module wraps the core.channel APIs for text processing, reply dispatching,
 * routing, and media handling.
 *
 * @module channels/office-website/runtime
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";

// ============================================================================
// Runtime Reference Management
// ============================================================================

let runtime: PluginRuntime | null = null;

/**
 * Set the plugin runtime reference
 * Called during plugin registration
 */
export function setOfficeWebsiteRuntime(next: PluginRuntime): void {
  runtime = next;
}

/**
 * Get the plugin runtime reference
 * @throws Error if runtime not initialized
 */
export function getOfficeWebsiteRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Office-Website runtime not initialized");
  }
  return runtime;
}

// ============================================================================
// Text API Wrappers
// ============================================================================

/**
 * Chunk markdown text into smaller pieces
 * Useful for splitting long responses into multiple messages
 */
export function chunkMarkdownText(params: {
  text: string;
  limit?: number;
  mode?: "auto" | "sentence" | "paragraph" | "markdown";
}): string[] {
  const core = getOfficeWebsiteRuntime();
  return core.channel.text.chunkMarkdownText(params.text, params.limit, params.mode);
}

/**
 * Chunk plain text by newline
 */
export function chunkByNewline(params: { text: string; limit?: number }): string[] {
  const core = getOfficeWebsiteRuntime();
  return core.channel.text.chunkByNewline(params.text, params.limit);
}

/**
 * Chunk text with custom mode
 */
export function chunkTextWithMode(params: {
  text: string;
  mode: "auto" | "sentence" | "paragraph";
  limit?: number;
}): string[] {
  const core = getOfficeWebsiteRuntime();
  return core.channel.text.chunkTextWithMode(params.text, params.mode, params.limit);
}

/**
 * Check if text contains control commands
 */
export function hasControlCommand(text: string): boolean {
  const core = getOfficeWebsiteRuntime();
  return core.channel.text.hasControlCommand(text);
}

/**
 * Convert markdown tables to formatted text
 */
export function convertMarkdownTables(params: {
  text: string;
  mode?: "auto" | "never" | "always";
}): string {
  const core = getOfficeWebsiteRuntime();
  const mode = params.mode ?? "auto";
  return core.channel.text.convertMarkdownTables(params.text, mode);
}

// ============================================================================
// Reply API Wrappers
// ============================================================================

/**
 * Dispatch reply from configuration
 * Main entry point for Agent Core integration
 */
export async function dispatchReplyFromConfig(params: {
  ctx: Parameters<PluginRuntime["channel"]["reply"]["dispatchReplyFromConfig"]>[0];
  cfg: Parameters<PluginRuntime["channel"]["reply"]["dispatchReplyFromConfig"]>[1];
  dispatcher: Parameters<PluginRuntime["channel"]["reply"]["dispatchReplyFromConfig"]>[2];
}): Promise<void> {
  const core = getOfficeWebsiteRuntime();
  return core.channel.reply.dispatchReplyFromConfig(params.ctx, params.cfg, params.dispatcher);
}

/**
 * Finalize inbound context for Agent Core
 * Builds the context payload from incoming message data
 */
export function finalizeInboundContext(params: {
  Body: string;
  BodyForAgent: string;
  InboundHistory?: unknown;
  ReplyToId?: string;
  RootMessageId?: string;
  RawBody: string;
  CommandBody?: string;
  From: string;
  To: string;
  SessionKey: string;
  AccountId: string;
  ChatType: "direct" | "channel";
  GroupSubject?: string;
  SenderName: string;
  SenderId: string;
  Provider: string;
  Surface: string;
  MessageSid: string;
  ReplyToBody?: string;
  Timestamp: number;
  WasMentioned: boolean;
  CommandAuthorized?: boolean;
  OriginatingChannel: string;
  OriginatingTo: string;
}): Parameters<PluginRuntime["channel"]["reply"]["dispatchReplyFromConfig"]>[0] {
  const core = getOfficeWebsiteRuntime();
  return core.channel.reply.finalizeInboundContext(params);
}

/**
 * Create reply dispatcher with typing indicator
 */
export function createReplyDispatcherWithTyping(params: {
  dispatcher: {
    sendToolResult: (payload: { text: string }) => boolean;
    sendBlockReply: (payload: { text: string }) => boolean;
    sendFinalReply: (payload: { text: string }) => boolean;
    waitForIdle: () => Promise<void>;
    getQueuedCounts: () => { tool: number; block: number; final: number };
    markComplete: () => void;
  };
  onSettled?: () => void;
}): {
  dispatcher: typeof params.dispatcher;
  replyOptions: {
    onReplyStart?: () => Promise<void> | void;
    onPartialReply?: (payload: { text: string }) => Promise<void> | void;
  };
} {
  const core = getOfficeWebsiteRuntime();
  return core.channel.reply.createReplyDispatcherWithTyping(params.dispatcher, params.onSettled);
}

/**
 * Execute with reply dispatcher
 * Handles the dispatcher lifecycle
 */
export async function withReplyDispatcher(params: {
  dispatcher: {
    sendToolResult: (payload: { text: string }) => boolean;
    sendBlockReply: (payload: { text: string }) => boolean;
    sendFinalReply: (payload: { text: string }) => boolean;
    waitForIdle: () => Promise<void>;
    getQueuedCounts: () => { tool: number; block: number; final: number };
    markComplete: () => void;
  };
  onSettled?: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  const core = getOfficeWebsiteRuntime();
  return core.channel.reply.withReplyDispatcher(params.dispatcher, params.onSettled, params.run);
}

/**
 * Resolve effective messages configuration
 */
export function resolveEffectiveMessagesConfig(params: {
  cfg: unknown;
  agentId?: string;
}): { maxTokens?: number; maxMessages?: number } {
  const core = getOfficeWebsiteRuntime();
  return core.channel.reply.resolveEffectiveMessagesConfig(params.cfg, params.agentId);
}

/**
 * Resolve human delay configuration
 */
export function resolveHumanDelayConfig(params: {
  cfg: unknown;
  agentId?: string;
}): { enabled: boolean; minMs: number; maxMs: number } {
  const core = getOfficeWebsiteRuntime();
  return core.channel.reply.resolveHumanDelayConfig(params.cfg, params.agentId);
}

// ============================================================================
// Routing API Wrappers
// ============================================================================

/**
 * Resolve agent route for a message
 * Determines which agent should handle the message
 */
export function resolveAgentRoute(params: {
  cfg: unknown;
  channel: string;
  accountId: string;
  peer: {
    kind: "direct" | "channel";
    id: string;
    name?: string;
  };
}): {
  sessionKey: string;
  accountId: string;
  agentId?: string;
} {
  const core = getOfficeWebsiteRuntime();
  return core.channel.routing.resolveAgentRoute(params.cfg, params.channel, params.accountId, params.peer);
}

// ============================================================================
// Media API Wrappers
// ============================================================================

/**
 * Fetch remote media file
 * Downloads media from URL and returns buffer
 */
export async function fetchRemoteMedia(params: {
  url: string;
  timeout?: number;
}): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const core = getOfficeWebsiteRuntime();
  return core.channel.media.fetchRemoteMedia(params.url, params.timeout);
}

/**
 * Save media buffer to storage
 * Stores media file and returns the storage path
 */
export async function saveMediaBuffer(params: {
  buffer: Buffer;
  filename: string;
  contentType?: string;
}): Promise<{ path: string; url: string }> {
  const core = getOfficeWebsiteRuntime();
  return core.channel.media.saveMediaBuffer(params.buffer, params.filename, params.contentType);
}

// ============================================================================
// Session API Wrappers
// ============================================================================

/**
 * Resolve session store path
 */
export function resolveStorePath(params: {
  channel: string;
  accountId: string;
  sessionKey: string;
}): string {
  const core = getOfficeWebsiteRuntime();
  return core.channel.session.resolveStorePath(params.channel, params.accountId, params.sessionKey);
}

/**
 * Update last route for session
 */
export function updateLastRoute(params: {
  channel: string;
  accountId: string;
  sessionKey: string;
  route: { agentId?: string };
}): void {
  const core = getOfficeWebsiteRuntime();
  return core.channel.session.updateLastRoute(params.channel, params.accountId, params.sessionKey, params.route);
}

// ============================================================================
// Activity API Wrappers
// ============================================================================

/**
 * Record channel activity
 */
export function recordChannelActivity(params: {
  channel: string;
  accountId: string;
  sessionKey: string;
  kind: "inbound" | "outbound";
}): void {
  const core = getOfficeWebsiteRuntime();
  return core.channel.activity.record(params.channel, params.accountId, params.sessionKey, params.kind);
}

/**
 * Get channel activity
 */
export function getChannelActivity(params: {
  channel: string;
  accountId: string;
  sessionKey: string;
}): { lastInboundAt?: number; lastOutboundAt?: number } | null {
  const core = getOfficeWebsiteRuntime();
  return core.channel.activity.get(params.channel, params.accountId, params.sessionKey);
}

// ============================================================================
// Mentions API Wrappers
// ============================================================================

/**
 * Build mention regexes for the channel
 */
export function buildMentionRegexes(params: {
  botMentionName?: string;
  botMentionUserId?: string;
}): RegExp[] {
  const core = getOfficeWebsiteRuntime();
  return core.channel.mentions.buildMentionRegexes(params.botMentionName, params.botMentionUserId);
}

/**
 * Check if text matches mention patterns
 */
export function matchesMentionPatterns(params: {
  text: string;
  regexes: RegExp[];
}): boolean {
  const core = getOfficeWebsiteRuntime();
  return core.channel.mentions.matchesMentionPatterns(params.text, params.regexes);
}

// ============================================================================
// Debounce API Wrappers
// ============================================================================

/**
 * Create inbound debouncer
 */
export function createInboundDebouncer(params: {
  channel: string;
  accountId: string;
  sessionKey: string;
  debounceMs?: number;
}): {
  shouldProcess: (messageId: string) => boolean;
  cleanup: () => void;
} {
  const core = getOfficeWebsiteRuntime();
  return core.channel.debounce.createInboundDebouncer(
    params.channel,
    params.accountId,
    params.sessionKey,
    params.debounceMs,
  );
}

/**
 * Resolve inbound debounce milliseconds
 */
export function resolveInboundDebounceMs(params: {
  cfg: unknown;
  channel: string;
  accountId: string;
}): number {
  const core = getOfficeWebsiteRuntime();
  return core.channel.debounce.resolveInboundDebounceMs(params.cfg, params.channel, params.accountId);
}
