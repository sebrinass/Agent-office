/**
 * Office-Website Channel Monitor
 *
 * Monitors the office-website channel for incoming messages and events.
 * Implements message receiving, document context tracking, and permission monitoring.
 *
 * @module channels/office-website/monitor
 */

import type { ClawdbotConfig, RuntimeEnv, HistoryEntry, ChannelGatewayContext } from "openclaw/plugin-sdk";
import type { ResolvedOfficeWebsiteAccount } from "./config";
import type { DocumentContext } from "./api";
import { SessionManager, type SessionMessage } from "./session";
import {
  setSessionManager,
  setChannelRuntime,
  getSessionManager,
  getChannelRuntime,
} from "./api";
import {
  getOfficeWebsiteRuntime,
  resolveAgentRoute,
  finalizeInboundContext,
  withReplyDispatcher,
  dispatchReplyFromConfig,
  recordChannelActivity,
  updateLastRoute,
} from "./runtime";
import { maskSensitive } from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Office-Website message event
 */
export interface OfficeWebsiteMessageEvent {
  sessionId: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  content: string;
  contentType: "text" | "markdown" | "code" | "command";
  documentContext?: DocumentContext;
  timestamp: number;
}

/**
 * Document change event
 */
export interface OfficeWebsiteDocumentEvent {
  sessionId: string;
  documentId: string;
  documentName: string;
  changeType: "content" | "selection" | "save" | "close";
  content?: string;
  selectedText?: string;
  permissions: DocumentContext["permissions"];
  timestamp: number;
}

/**
 * Permission change event
 */
export interface OfficeWebsitePermissionEvent {
  sessionId: string;
  documentId: string;
  userId: string;
  permissionType: "view" | "annotate" | "edit";
  granted: boolean;
  timestamp: number;
}

/**
 * Monitor options
 */
export type MonitorOfficeWebsiteOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

/**
 * Message context for Agent Core
 */
export interface OfficeWebsiteMessageContext {
  sessionId: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  content: string;
  contentType: string;
  documentContext?: DocumentContext;
  timestamp: number;
}

// ============================================================================
// Runtime Reference Management
// ============================================================================

let monitorRuntime: RuntimeEnv | null = null;
let monitorConfig: ClawdbotConfig | null = null;
let monitorAccount: ResolvedOfficeWebsiteAccount | null = null;

/**
 * Set monitor runtime reference
 */
export function setMonitorRuntime(runtime: RuntimeEnv): void {
  monitorRuntime = runtime;
}

/**
 * Get monitor runtime reference
 */
export function getMonitorRuntime(): RuntimeEnv | null {
  return monitorRuntime;
}

/**
 * Set monitor config reference
 */
export function setMonitorConfig(cfg: ClawdbotConfig): void {
  monitorConfig = cfg;
}

/**
 * Get monitor config reference
 */
export function getMonitorConfig(): ClawdbotConfig | null {
  return monitorConfig;
}

/**
 * Set monitor account reference
 */
export function setMonitorAccount(account: ResolvedOfficeWebsiteAccount): void {
  monitorAccount = account;
}

/**
 * Get monitor account reference
 */
export function getMonitorAccount(): ResolvedOfficeWebsiteAccount | null {
  return monitorAccount;
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Parse message content based on type
 */
function parseMessageContent(content: string, contentType: string): string {
  switch (contentType) {
    case "text":
      return content.trim();
    case "markdown":
      return content.trim();
    case "code":
      return `\`\`\`\n${content}\n\`\`\``;
    case "command":
      return content.trim();
    default:
      return content.trim();
  }
}

/**
 * Build agent body with context
 */
function buildOfficeWebsiteAgentBody(params: {
  ctx: OfficeWebsiteMessageContext;
  documentContext?: DocumentContext;
}): string {
  const { ctx, documentContext } = params;
  let messageBody = ctx.content;

  // Add sender attribution
  const speaker = ctx.senderName ?? ctx.senderId;
  messageBody = `${speaker}: ${messageBody}`;

  // Add document context hint
  if (documentContext) {
    const docInfo = `Document: ${documentContext.documentName} (${documentContext.documentId})`;
    const permissionInfo = `Permissions: view=${documentContext.permissions.canView}, annotate=${documentContext.permissions.canAnnotate}, edit=${documentContext.permissions.canEdit}`;
    messageBody += `\n\n[System: User is working on ${docInfo}]`;
    messageBody += `\n[System: ${permissionInfo}]`;

    if (documentContext.selectedText) {
      messageBody += `\n\n[System: User has selected the following text:\n"${documentContext.selectedText}"]`;
    }
  }

  // Add message ID for tracking
  messageBody = `[message_id: ${ctx.messageId}]\n${messageBody}`;

  return messageBody;
}

/**
 * Handle incoming message from office-website
 */
export async function handleOfficeWebsiteMessage(params: {
  cfg: ClawdbotConfig;
  event: OfficeWebsiteMessageEvent;
  runtime?: RuntimeEnv;
  sessionManager: SessionManager;
  accountId: string;
}): Promise<void> {
  const { cfg, event, runtime, sessionManager, accountId } = params;

  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  log(
    `office-website[${accountId}]: received message from ${event.senderId} in session ${event.sessionId}`,
  );

  // 1. Validate session
  let session = sessionManager.getSession(event.sessionId);
  if (!session) {
    session = sessionManager.createSession(event.sessionId);
  }

  // 2. Check permissions for document operations
  if (event.documentContext && !event.documentContext.permissions.canView) {
    log(
      `office-website[${accountId}]: user ${event.senderId} has no view permission for document ${event.documentContext.documentId}`,
    );
    return;
  }

  // 3. Update document context if provided
  if (event.documentContext) {
    sessionManager.updateDocumentContext(event.sessionId, event.documentContext);
  }

  // 4. Add user message to session
  const message = sessionManager.addMessage(event.sessionId, {
    role: "user",
    content: event.content,
    documentContext: event.documentContext,
  });

  if (!message) {
    error(`office-website[${accountId}]: failed to add message to session ${event.sessionId}`);
    return;
  }

  // 5. Get channel runtime for Agent Core integration
  const channelRuntime = getChannelRuntime();

  if (!channelRuntime?.reply) {
    log(
      `office-website[${accountId}]: message received for session ${event.sessionId}, but Agent Core integration not configured`,
    );
    return;
  }

  try {
    // Build message context
    const ctx: OfficeWebsiteMessageContext = {
      sessionId: event.sessionId,
      messageId: event.messageId,
      senderId: event.senderId,
      senderName: event.senderName,
      content: parseMessageContent(event.content, event.contentType),
      contentType: event.contentType,
      documentContext: event.documentContext,
      timestamp: event.timestamp,
    };

    // Resolve agent route using runtime API
    const route = resolveAgentRoute({
      cfg,
      channel: "office-website",
      accountId,
      peer: {
        kind: "direct",
        id: event.sessionId,
      },
    });

    log(
      `office-website[${accountId}]: dispatching to agent (session=${route.sessionKey})`,
    );

    // Build agent body
    const messageBody = buildOfficeWebsiteAgentBody({
      ctx,
      documentContext: event.documentContext,
    });

    // Build context payload for Agent Core using runtime API
    const ctxPayload = finalizeInboundContext({
      Body: messageBody,
      BodyForAgent: messageBody,
      InboundHistory: undefined,
      ReplyToId: undefined,
      RootMessageId: undefined,
      RawBody: event.content,
      CommandBody: event.content,
      From: `office-website:${event.senderId}`,
      To: `session:${event.sessionId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: "direct",
      GroupSubject: undefined,
      SenderName: ctx.senderName ?? ctx.senderId,
      SenderId: ctx.senderId,
      Provider: "office-website",
      Surface: "office-website",
      MessageSid: ctx.messageId,
      ReplyToBody: undefined,
      Timestamp: ctx.timestamp,
      WasMentioned: false,
      CommandAuthorized: undefined,
      OriginatingChannel: "office-website",
      OriginatingTo: `session:${event.sessionId}`,
    });

    // Record channel activity
    recordChannelActivity({
      channel: "office-website",
      accountId: route.accountId,
      sessionKey: route.sessionKey,
      kind: "inbound",
    });

    // Update last route
    if (route.agentId) {
      updateLastRoute({
        channel: "office-website",
        accountId: route.accountId,
        sessionKey: route.sessionKey,
        route: { agentId: route.agentId },
      });
    }

    // Create reply dispatcher
    const dispatcher = createOfficeWebsiteReplyDispatcher({
      sessionManager,
      sessionId: event.sessionId,
      documentContext: event.documentContext,
    });

    // Dispatch to Agent Core using runtime API
    await withReplyDispatcher({
      dispatcher,
      onSettled: () => {
        dispatcher.markIdle();
      },
      run: () =>
        dispatchReplyFromConfig({
          ctx: ctxPayload,
          cfg,
          dispatcher,
        }),
    });

    log(
      `office-website[${accountId}]: message dispatch complete for session ${event.sessionId}`,
    );
  } catch (err) {
    // Mask sensitive information in error log
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(
      `office-website[${accountId}]: failed to dispatch message: ${maskSensitive(errorMessage)}`,
    );
  }
}

// ============================================================================
// Reply Dispatcher
// ============================================================================

/**
 * Create reply dispatcher for office-website
 */
function createOfficeWebsiteReplyDispatcher(params: {
  sessionManager: SessionManager;
  sessionId: string;
  documentContext?: DocumentContext;
}): OfficeWebsiteReplyDispatcher {
  const { sessionManager, sessionId, documentContext } = params;

  return new OfficeWebsiteReplyDispatcher({
    sessionManager,
    sessionId,
    documentContext,
  });
}

/**
 * Reply dispatcher for office-website
 */
class OfficeWebsiteReplyDispatcher {
  private sessionManager: SessionManager;
  private sessionId: string;
  private documentContext?: DocumentContext;
  private idle = false;
  private queuedTool = 0;
  private queuedBlock = 0;
  private queuedFinal = 0;

  constructor(params: {
    sessionManager: SessionManager;
    sessionId: string;
    documentContext?: DocumentContext;
  }) {
    this.sessionManager = params.sessionManager;
    this.sessionId = params.sessionId;
    this.documentContext = params.documentContext;
  }

  /**
   * Send tool result
   */
  sendToolResult(result: string): boolean {
    this.queuedTool++;
    // Tool results are logged but not sent to frontend
    return true;
  }

  /**
   * Send block reply (streaming chunk)
   */
  sendBlockReply(block: string): boolean {
    this.queuedBlock++;
    // Block replies are accumulated for streaming
    // In a full implementation, this would push to SSE stream
    return true;
  }

  /**
   * Send final reply
   */
  sendFinalReply(text: string): boolean {
    this.queuedFinal++;
    // Add assistant message to session
    this.sessionManager.addMessage(this.sessionId, {
      role: "assistant",
      content: text,
      documentContext: this.documentContext,
    });
    return true;
  }

  /**
   * Wait for idle state
   */
  async waitForIdle(): Promise<void> {
    // Wait for all queued messages to be processed
    while (!this.idle) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Get queued counts
   */
  getQueuedCounts(): { tool: number; block: number; final: number } {
    return {
      tool: this.queuedTool,
      block: this.queuedBlock,
      final: this.queuedFinal,
    };
  }

  /**
   * Mark dispatcher as idle
   */
  markComplete(): void {
    this.idle = true;
  }

  /**
   * Mark dispatcher as idle (alias)
   */
  markIdle(): void {
    this.idle = true;
  }
}

// ============================================================================
// Document Context Monitoring
// ============================================================================

/**
 * Handle document context change
 */
export async function handleDocumentContextChange(params: {
  cfg: ClawdbotConfig;
  event: OfficeWebsiteDocumentEvent;
  runtime?: RuntimeEnv;
  sessionManager: SessionManager;
  accountId: string;
}): Promise<void> {
  const { cfg, event, runtime, sessionManager, accountId } = params;

  const log = runtime?.log ?? console.log;

  log(
    `office-website[${accountId}]: document context change for ${event.documentId} in session ${event.sessionId}`,
  );

  // Update session document context
  const documentContext: DocumentContext = {
    documentId: event.documentId,
    documentName: event.documentName,
    documentType: "document",
    content: event.content,
    selectedText: event.selectedText,
    permissions: event.permissions,
  };

  sessionManager.updateDocumentContext(event.sessionId, documentContext);

  // If content changed significantly, we might want to trigger context sync
  if (event.changeType === "content" && event.content) {
    log(
      `office-website[${accountId}]: document content updated, length=${event.content.length}`,
    );
  }

  // If selection changed, update the context
  if (event.changeType === "selection" && event.selectedText) {
    log(
      `office-website[${accountId}]: text selected in document, length=${event.selectedText.length}`,
    );
  }
}

// ============================================================================
// Permission Monitoring
// ============================================================================

/**
 * Handle permission change
 */
export async function handlePermissionChange(params: {
  cfg: ClawdbotConfig;
  event: OfficeWebsitePermissionEvent;
  runtime?: RuntimeEnv;
  sessionManager: SessionManager;
  accountId: string;
}): Promise<void> {
  const { cfg, event, runtime, sessionManager, accountId } = params;

  const log = runtime?.log ?? console.log;

  log(
    `office-website[${accountId}]: permission change for user ${event.userId} on document ${event.documentId}`,
  );

  // Get current session document context
  const session = sessionManager.getSession(event.sessionId);
  if (!session?.documentContext) {
    return;
  }

  // Update permissions in document context
  const updatedPermissions = { ...session.documentContext.permissions };
  switch (event.permissionType) {
    case "view":
      updatedPermissions.canView = event.granted;
      break;
    case "annotate":
      updatedPermissions.canAnnotate = event.granted;
      break;
    case "edit":
      updatedPermissions.canEdit = event.granted;
      break;
  }

  sessionManager.updateDocumentContext(event.sessionId, {
    ...session.documentContext,
    permissions: updatedPermissions,
  });

  log(
    `office-website[${accountId}]: updated permissions: view=${updatedPermissions.canView}, annotate=${updatedPermissions.canAnnotate}, edit=${updatedPermissions.canEdit}`,
  );
}

// ============================================================================
// Monitor Entry Point
// ============================================================================

/**
 * Monitor the office-website channel for incoming messages
 *
 * This function is the main entry point for the channel gateway.
 * It sets up HTTP server listeners and handles incoming requests.
 *
 * @param opts - Monitor options
 */
export async function monitorOfficeWebsiteProvider(
  opts: MonitorOfficeWebsiteOpts = {},
): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for office-website monitor");
  }

  const log = opts.runtime?.log ?? console.log;
  const accountId = opts.accountId ?? "default";

  log(`office-website: starting monitor for account: ${accountId}`);

  // Store runtime references
  if (opts.runtime) {
    setMonitorRuntime(opts.runtime);
  }
  setMonitorConfig(cfg);

  // The actual monitoring is done via HTTP API endpoints
  // This function initializes the monitor state and waits for abort signal

  return new Promise((resolve) => {
    opts.abortSignal?.addEventListener("abort", () => {
      log(`office-website: stopping monitor for account: ${accountId}`);
      resolve();
    });
  });
}

/**
 * Monitor the office-website channel (gateway adapter version)
 *
 * This is the main entry point called by the gateway adapter.
 *
 * @param ctx - Gateway context with configuration and runtime
 */
export async function monitorOfficeWebsiteChannel(
  ctx: ChannelGatewayContext<ResolvedOfficeWebsiteAccount>,
): Promise<void> {
  const { cfg, account, runtime, abortSignal, log, channelRuntime } = ctx;

  log?.info(`Starting office-website channel monitor for account: ${account.accountId}`);

  // Determine persistence path
  const persistencePath = account.accountId === "default"
    ? `${process.env.HOME || process.env.USERPROFILE || "."}/.openclaw/data/office-website/sessions.json`
    : `${process.env.HOME || process.env.USERPROFILE || "."}/.openclaw/data/office-website/sessions-${account.accountId}.json`;

  // Initialize session manager with persistence
  const sessionManager = new SessionManager({
    maxSessions: account.maxSessions,
    sessionTimeout: account.sessionTimeout,
    memoryEnabled: account.memoryEnabled,
    memoryProvider: account.memoryProvider,
    embeddingModel: account.embeddingModel,
    persistenceEnabled: true,
    persistencePath,
    autoSaveInterval: 60000, // Auto-save every 60 seconds
  });

  // Set global session manager for API handlers
  setSessionManager(sessionManager);

  // Set global channel runtime for Agent Core integration
  setChannelRuntime(channelRuntime);

  // Store monitor references
  setMonitorConfig(cfg);
  setMonitorAccount(account);
  if (runtime) {
    setMonitorRuntime(runtime);
  }

  // Set up cleanup on abort
  abortSignal.addEventListener("abort", () => {
    log?.info(`Stopping office-website channel monitor for account: ${account.accountId}`);
    sessionManager.destroyAll();
    setChannelRuntime(undefined);
  });

  // The actual HTTP server is managed by the OpenClaw Gateway
  // This function just initializes the channel state and waits for abort
  return new Promise((resolve) => {
    abortSignal.addEventListener("abort", () => {
      resolve();
    });
  });
}

/**
 * Monitor the office-website inbox for new messages
 *
 * This function is called periodically to check for new messages
 * when using polling mode (if supported).
 *
 * @param params - Parameters for inbox monitoring
 */
export async function monitorOfficeWebsiteInbox(params: {
  account: ResolvedOfficeWebsiteAccount;
  signal?: AbortSignal;
}): Promise<void> {
  // Office-website uses HTTP API, so polling is not needed
  // This function is a placeholder for future polling support
  return Promise.resolve();
}

/**
 * Stop the office-website monitor
 */
export function stopOfficeWebsiteMonitor(accountId?: string): void {
  const manager = getSessionManager();
  if (manager) {
    manager.cleanup();
  }
  setChannelRuntime(undefined);
}

// ============================================================================
// Exports
// ============================================================================

export type { OfficeWebsiteReplyDispatcher };
