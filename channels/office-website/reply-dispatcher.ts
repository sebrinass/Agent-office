/**
 * Office-Website Channel Reply Dispatcher
 *
 * Implements the reply dispatcher for OpenClaw Agent Core integration.
 * Uses the SDK standard framework with responsePrefix, humanDelay, and normalizeReplyPayload.
 *
 * @module channels/office-website/reply-dispatcher
 */

import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  createReplyPrefixContext,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "../../config/config";
import type { ResolvedOfficeWebsiteAccount } from "./config";
import { resolveOfficeWebsiteAccount } from "./config";
import {
  sendMessage,
  sendTextMessage,
  sendMarkdownMessage,
  sendMediaMessage,
  sendStreamStart,
  sendStreamDelta,
  sendStreamEnd,
  type OutboundMessage,
  type MediaAttachment,
  SSEStreamController,
  createSSEStream,
} from "./send";
import {
  getOfficeWebsiteRuntime,
  chunkMarkdownText,
  resolveEffectiveMessagesConfig,
  resolveHumanDelayConfig,
  recordChannelActivity,
} from "./runtime";

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters for creating the office-website reply dispatcher
 */
export type CreateOfficeWebsiteReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  sessionId: string;
  documentContext?: {
    documentId: string;
    documentName: string;
    documentType: string;
    content?: string;
    selectedText?: string;
  };
  accountId?: string;
};

/**
 * Reply dispatcher result
 */
export type OfficeWebsiteReplyDispatcherResult = {
  dispatcher: {
    sendToolResult: (payload: ReplyPayload) => boolean;
    sendBlockReply: (payload: ReplyPayload) => boolean;
    sendFinalReply: (payload: ReplyPayload) => boolean;
    waitForIdle: () => Promise<void>;
    getQueuedCounts: () => { tool: number; block: number; final: number };
    markComplete: () => void;
    sendPayload: (payload: ReplyPayload) => Promise<boolean>;
  };
  replyOptions: {
    onReplyStart?: () => Promise<void> | void;
    onPartialReply?: (payload: ReplyPayload) => Promise<void> | void;
  };
  markDispatchIdle: () => void;
};

// ============================================================================
// Streaming Session Manager
// ============================================================================

/**
 * Streaming session state
 */
interface StreamingSession {
  streamId: string;
  controller: SSEStreamController;
  buffer: string[];
  isActive: boolean;
  startedAt: number;
}

/**
 * Manages streaming sessions for real-time responses
 */
class StreamingManager {
  private sessions = new Map<string, StreamingSession>();
  private cfg: OpenClawConfig;
  private sessionId: string;

  constructor(cfg: OpenClawConfig, sessionId: string) {
    this.cfg = cfg;
    this.sessionId = sessionId;
  }

  /**
   * Start a new streaming session
   */
  async startStream(): Promise<string> {
    const streamId = `stream-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const controller = createSSEStream(this.cfg, this.sessionId, streamId);

    const result = await controller.start();
    if (!result.success) {
      throw new Error(`Failed to start stream: ${result.error}`);
    }

    const session: StreamingSession = {
      streamId,
      controller,
      buffer: [],
      isActive: true,
      startedAt: Date.now(),
    };

    this.sessions.set(streamId, session);
    return streamId;
  }

  /**
   * Send a delta chunk to an active stream
   */
  async sendDelta(streamId: string, delta: string): Promise<boolean> {
    const session = this.sessions.get(streamId);
    if (!session || !session.isActive) {
      return false;
    }

    session.buffer.push(delta);
    const result = await session.controller.sendDelta(delta);
    return result.success;
  }

  /**
   * End a streaming session
   */
  async endStream(streamId: string, fullContent?: string): Promise<boolean> {
    const session = this.sessions.get(streamId);
    if (!session) {
      return false;
    }

    const content = fullContent || session.buffer.join("");
    const result = await session.controller.end(content);

    session.isActive = false;
    this.sessions.delete(streamId);

    return result.success;
  }

  /**
   * Check if a stream is active
   */
  isStreamActive(streamId: string): boolean {
    const session = this.sessions.get(streamId);
    return session?.isActive ?? false;
  }

  /**
   * Get active stream ID (if any)
   */
  getActiveStreamId(): string | null {
    for (const [streamId, session] of this.sessions) {
      if (session.isActive) {
        return streamId;
      }
    }
    return null;
  }

  /**
   * Clean up all active streams
   */
  async cleanup(): Promise<void> {
    for (const [streamId, session] of this.sessions) {
      if (session.isActive) {
        await this.endStream(streamId);
      }
    }
    this.sessions.clear();
  }
}

// ============================================================================
// Reply Dispatcher Factory
// ============================================================================

/**
 * Determine message type based on content
 */
function determineMessageType(text: string): "text" | "markdown" {
  // Check for markdown indicators
  const markdownPatterns = [
    /^#{1,6}\s/m, // Headings
    /\[.+\]\(.+\)/, // Links
    /`{3}/, // Code blocks
    /`[^`]+`/, // Inline code
    /\*.+\*/, // Bold/italic
    /^[-*+]\s/m, // Lists
    /^\d+\.\s/m, // Ordered lists
    /^>\s/m, // Quotes
    /\|.+\|/, // Tables
  ];

  for (const pattern of markdownPatterns) {
    if (pattern.test(text)) {
      return "markdown";
    }
  }

  return "text";
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  const mimeTypes: Record<string, string> = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    // Videos
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    json: "application/json",
    csv: "text/csv",
  };

  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Create the office-website reply dispatcher
 *
 * This function creates a reply dispatcher that integrates with the OpenClaw
 * Agent Core using the SDK standard framework with responsePrefix, humanDelay,
 * and normalizeReplyPayload support.
 */
export function createOfficeWebsiteReplyDispatcher(
  params: CreateOfficeWebsiteReplyDispatcherParams,
): OfficeWebsiteReplyDispatcherResult {
  const { cfg, agentId, runtime, sessionId, documentContext, accountId } = params;

  // Resolve account configuration
  const account = resolveOfficeWebsiteAccount(cfg as OpenClawConfig, accountId);

  // Get runtime for SDK functions
  const core = getOfficeWebsiteRuntime();

  // Create prefix context for response formatting
  const prefixContext = createReplyPrefixContext({ cfg, agentId });

  // Resolve effective messages config using runtime API
  const messagesConfig = resolveEffectiveMessagesConfig({ cfg, agentId });

  // Resolve human delay config using runtime API
  const humanDelay = resolveHumanDelayConfig({ cfg, agentId });

  // Initialize streaming manager
  const streamingManager = new StreamingManager(cfg as OpenClawConfig, sessionId);

  // Track active stream
  let activeStreamId: string | null = null;
  let streamBuffer = "";

  // Track dispatch state
  let isIdle = false;
  let isComplete = false;

  // Queued counts for tracking
  const queuedCounts = { tool: 0, block: 0, final: 0 };

  // Send chain for serialization
  let sendChain: Promise<void> = Promise.resolve();
  let pending = 1; // Reservation to prevent premature idle

  /**
   * Deliver a message to the office-website frontend
   */
  async function deliverMessage(
    payload: ReplyPayload,
    info: { kind: "tool" | "block" | "final" },
  ): Promise<void> {
    const text = payload.text ?? "";
    const mediaList =
      payload.mediaUrls && payload.mediaUrls.length > 0
        ? payload.mediaUrls
        : payload.mediaUrl
          ? [payload.mediaUrl]
          : [];

    const hasText = Boolean(text.trim());
    const hasMedia = mediaList.length > 0;

    if (!hasText && !hasMedia) {
      return;
    }

    // Handle streaming for block replies
    if (info.kind === "block" && activeStreamId) {
      if (text) {
        streamBuffer += text;
        await streamingManager.sendDelta(activeStreamId, text);
      }
      return;
    }

    // Handle final reply - end stream if active
    if (info.kind === "final" && activeStreamId) {
      if (text) {
        streamBuffer = text;
      }
      await streamingManager.endStream(activeStreamId, streamBuffer);
      activeStreamId = null;
      streamBuffer = "";
      return;
    }

    // Send text message with chunking for long messages
    if (hasText) {
      const messageType = determineMessageType(text);

      // Use chunkMarkdownText for long messages
      const maxChunkSize = messagesConfig.maxTokens ?? 4000;
      const chunks = chunkMarkdownText({
        text,
        limit: maxChunkSize,
        mode: "markdown",
      });

      // Send each chunk
      for (const chunk of chunks) {
        if (messageType === "markdown") {
          await sendMarkdownMessage(cfg as OpenClawConfig, sessionId, chunk, documentContext);
        } else {
          await sendTextMessage(cfg as OpenClawConfig, sessionId, chunk, documentContext);
        }

        // Record outbound activity
        recordChannelActivity({
          channel: "office-website",
          accountId: account.accountId,
          sessionKey: sessionId,
          kind: "outbound",
        });
      }
    }

    // Send media attachments
    if (hasMedia) {
      const attachments: MediaAttachment[] = mediaList.map((url) => {
        const urlLower = url.toLowerCase();
        let mediaType: MediaAttachment["type"] = "document";

        if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(urlLower)) {
          mediaType = "image";
        } else if (/\.(mp4|webm|mov|avi)$/i.test(urlLower)) {
          mediaType = "video";
        } else if (/\.(mp3|wav|ogg|m4a)$/i.test(urlLower)) {
          mediaType = "audio";
        }

        const filename = url.split("/").pop() || "file";

        return {
          type: mediaType,
          filename,
          mimeType: getMimeType(filename),
          url,
        };
      });

      await sendMediaMessage(cfg as OpenClawConfig, sessionId, attachments, undefined, documentContext);

      // Record outbound activity for media
      recordChannelActivity({
        channel: "office-website",
        accountId: account.accountId,
        sessionKey: sessionId,
        kind: "outbound",
      });
    }
  }

  /**
   * Normalize reply payload using SDK
   */
  function normalizePayload(payload: ReplyPayload): ReplyPayload | null {
    const prefixContextValue = prefixContext.responsePrefixContextProvider?.() ?? 
                               prefixContext.responsePrefixContext;

    return core.channel.reply.normalizeReplyPayload?.(payload, {
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContext: prefixContextValue,
    }) ?? payload;
  }

  /**
   * Enqueue a message for delivery
   */
  function enqueue(kind: "tool" | "block" | "final", payload: ReplyPayload): boolean {
    const normalized = normalizePayload(payload);
    if (!normalized) {
      return false;
    }

    queuedCounts[kind] += 1;
    pending += 1;

    sendChain = sendChain
      .then(async () => {
        await deliverMessage(normalized, { kind });
      })
      .catch((err) => {
        runtime.error?.(
          `[office-website] Failed to deliver ${kind} message: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      })
      .finally(() => {
        pending -= 1;
        if (pending === 1 && isComplete) {
          pending -= 1;
        }
        if (pending === 0) {
          isIdle = true;
          // End any active stream
          if (activeStreamId) {
            streamingManager.endStream(activeStreamId, streamBuffer).catch((error) => {
              runtime.error?.(`[office-website] Failed to end stream: ${error}`);
            });
            activeStreamId = null;
            streamBuffer = "";
          }
        }
      });

    return true;
  }

  /**
   * Send a complex payload directly (for advanced use cases)
   */
  async function sendPayload(payload: ReplyPayload): Promise<boolean> {
    try {
      const normalized = normalizePayload(payload);
      if (!normalized) {
        return false;
      }

      await deliverMessage(normalized, { kind: "final" });
      return true;
    } catch (error) {
      runtime.error?.(
        `[office-website] Failed to send payload: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return false;
    }
  }

  // Create dispatcher
  const dispatcher = {
    sendToolResult: (payload: ReplyPayload) => {
      return enqueue("tool", payload);
    },

    sendBlockReply: (payload: ReplyPayload) => {
      // Start streaming if not already active
      if (!activeStreamId && payload.text) {
        streamingManager.startStream().then((streamId) => {
          activeStreamId = streamId;
          streamBuffer = "";
          enqueue("block", payload);
        }).catch((error) => {
          runtime.error?.(`[office-website] Failed to start stream: ${error}`);
        });
        return true;
      }
      return enqueue("block", payload);
    },

    sendFinalReply: (payload: ReplyPayload) => {
      return enqueue("final", payload);
    },

    waitForIdle: async () => {
      await sendChain;
    },

    getQueuedCounts: () => ({ ...queuedCounts }),

    markComplete: () => {
      if (isComplete) return;
      isComplete = true;
      void Promise.resolve().then(() => {
        if (pending === 1 && isComplete) {
          pending -= 1;
          if (pending === 0) {
            isIdle = true;
          }
        }
      });
    },

    sendPayload,
  };

  // Reply options for Agent Core
  const replyOptions = {
    onReplyStart: async () => {
      isIdle = false;
      runtime.log?.(`[office-website] Starting reply for session ${sessionId}`);
    },

    onPartialReply: async (payload: ReplyPayload) => {
      // Handle partial/streaming replies
      if (payload.text) {
        if (!activeStreamId) {
          try {
            activeStreamId = await streamingManager.startStream();
            streamBuffer = "";
          } catch (error) {
            runtime.error?.(`[office-website] Failed to start streaming: ${error}`);
            return;
          }
        }

        streamBuffer += payload.text;
        await streamingManager.sendDelta(activeStreamId, payload.text);
      }
    },
  };

  // Mark dispatch idle function
  const markDispatchIdle = () => {
    isIdle = true;

    // End any active stream
    if (activeStreamId) {
      streamingManager.endStream(activeStreamId, streamBuffer).catch((error) => {
        runtime.error?.(`[office-website] Failed to end stream: ${error}`);
      });
      activeStreamId = null;
      streamBuffer = "";
    }
  };

  return {
    dispatcher,
    replyOptions,
    markDispatchIdle,
  };
}

export default createOfficeWebsiteReplyDispatcher;
