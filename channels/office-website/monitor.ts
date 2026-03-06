/**
 * Office-Website Channel Monitor
 *
 * Monitors the office-website channel for incoming messages and events.
 * This function is called by the OpenClaw Gateway to start listening for messages.
 *
 * @module channels/office-website/monitor
 */

import type { ChannelGatewayContext } from "../plugins/types.adapters.js";
import type { ResolvedOfficeWebsiteAccount } from "./config.js";
import { SessionManager } from "./session.js";
import { setSessionManager, setChannelRuntime } from "./api.js";

/**
 * Monitor the office-website channel for incoming messages
 *
 * This function is the main entry point for the channel gateway.
 * It sets up HTTP server listeners and handles incoming requests.
 *
 * @param ctx - Gateway context with configuration and runtime
 */
export async function monitorOfficeWebsiteChannel(
  ctx: ChannelGatewayContext<ResolvedOfficeWebsiteAccount>,
): Promise<void> {
  const { cfg, account, runtime, abortSignal, log, channelRuntime } = ctx;

  log?.info(`Starting office-website channel monitor for account: ${account.accountId}`);

  // Initialize session manager
  const sessionManager = new SessionManager({
    maxSessions: account.maxSessions,
    sessionTimeout: account.sessionTimeout,
    memoryEnabled: account.memoryEnabled,
    memoryProvider: account.memoryProvider,
    embeddingModel: account.embeddingModel,
  });

  // Set global session manager for API handlers
  setSessionManager(sessionManager);

  // Set global channel runtime for Agent Core integration (C-003 Fix)
  setChannelRuntime(channelRuntime);

  // Store session manager in context for API handlers to access
  // The HTTP API endpoints will use the global session manager

  // Set up cleanup on abort
  abortSignal.addEventListener("abort", () => {
    log?.info(`Stopping office-website channel monitor for account: ${account.accountId}`);
    sessionManager.cleanup();
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
 * Handle incoming message from office-website
 *
 * This function processes incoming messages and forwards them to the Agent Core.
 *
 * @param params - Message parameters
 */
export async function handleIncomingMessage(params: {
  sessionId: string;
  content: string;
  senderId: string;
  senderName?: string;
  documentContext?: {
    documentId: string;
    documentName: string;
    selectedText?: string;
    permissions: {
      canView: boolean;
      canAnnotate: boolean;
      canEdit: boolean;
    };
  };
  sessionManager: SessionManager;
  channelRuntime?: ChannelGatewayContext<ResolvedOfficeWebsiteAccount>["channelRuntime"];
  cfg: import("../../config/config.js").OpenClawConfig;
}): Promise<void> {
  const {
    sessionId,
    content,
    senderId,
    senderName,
    documentContext,
    sessionManager,
    channelRuntime,
    cfg,
  } = params;

  // 1. Validate session
  let session = sessionManager.getSession(sessionId);
  if (!session) {
    session = sessionManager.createSession(sessionId);
  }

  // 2. Check permissions
  if (documentContext && !documentContext.permissions.canView) {
    console.warn(`User ${senderId} has no view permission for document ${documentContext.documentId}`);
    return;
  }

  // 3. Update document context if provided
  if (documentContext) {
    sessionManager.updateDocumentContext(sessionId, {
      documentId: documentContext.documentId,
      documentName: documentContext.documentName,
      documentType: "document",
      selectedText: documentContext.selectedText,
      permissions: documentContext.permissions,
    });
  }

  // 4. Add user message to session
  const message = sessionManager.addMessage(sessionId, {
    role: "user",
    content,
    documentContext: documentContext ? {
      documentId: documentContext.documentId,
      documentName: documentContext.documentName,
      documentType: "document",
      selectedText: documentContext.selectedText,
      permissions: documentContext.permissions,
    } : undefined,
  });

  if (!message) {
    console.error(`Failed to add message to session ${sessionId}`);
    return;
  }

  // 5. Forward to Agent Core if channelRuntime is available
  if (channelRuntime?.reply) {
    try {
      // Use the channel runtime to dispatch reply
      await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: {
          Body: content,
          From: senderId,
          SenderId: senderId,
          SenderName: senderName,
          AccountId: sessionId,
          SessionKey: sessionId,
          Provider: "office-website",
        },
        cfg,
        dispatcherOptions: {
          deliver: async (payload) => {
            // Store assistant message in session
            if (payload.text) {
              sessionManager.addMessage(sessionId, {
                role: "assistant",
                content: payload.text,
              });
            }
          },
        },
      });
    } catch (error) {
      console.error(`Failed to dispatch reply for session ${sessionId}:`, error);
    }
  } else {
    // Log that Agent Core is not available
    console.log(`Message received for session ${sessionId}, but Agent Core integration not yet configured`);
    console.log(`Message: ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}`);
  }
}
