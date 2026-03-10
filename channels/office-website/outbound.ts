/**
 * Office-Website Channel Outbound Adapter
 *
 * Implements ChannelOutboundAdapter for sending messages from OpenClaw
 * to the office-website frontend via Gateway HTTP API.
 *
 * Features:
 * - Text and markdown message sending
 * - Media file attachments (images, videos, audio, documents)
 * - Message templates with variable substitution
 * - Stream-based responses (SSE)
 * - Text chunking for long messages
 *
 * @module channels/office-website/outbound
 */

import type { ChannelOutboundContext, ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import type { OutboundDeliveryResult } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "../../config/config";
import type { ResolvedOfficeWebsiteAccount } from "./config";
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
} from "./send";
import {
  getTemplate,
  renderTemplate,
  templateBuilder,
  type TemplateVariables,
  Templates,
} from "./templates";

/**
 * Resolve office-website account configuration
 */
function resolveOfficeWebsiteAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedOfficeWebsiteAccount {
  const accounts = cfg.channels?.["office-website"]?.accounts as
    | Record<string, ResolvedOfficeWebsiteAccount>
    | undefined;

  const id = accountId || "default";
  const accountConfig = accounts?.[id];

  if (!accountConfig) {
    return {
      accountId: id,
      enabled: false,
      configured: false,
      sessionTimeout: 3600000,
      maxSessions: 100,
      memoryEnabled: true,
      memoryProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    };
  }

  return accountConfig;
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Chunk text by paragraphs for long messages
 */
function chunkTextByParagraph(text: string, limit: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 <= limit) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      // If single paragraph exceeds limit, split by sentences
      if (paragraph.length > limit) {
        const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
        currentChunk = "";
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length <= limit) {
            currentChunk += sentence;
          } else {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = sentence;
          }
        }
      } else {
        currentChunk = paragraph;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : [text];
}

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
 * Send text message to office-website frontend
 */
async function sendOutboundText(params: {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, text, accountId } = params;

  // Resolve account
  const account = resolveOfficeWebsiteAccount(cfg, accountId);
  if (!account.configured) {
    return {
      channel: "office-website",
      messageId: "",
      meta: { error: "Account not configured" },
    };
  }

  // Determine message type
  const messageType = determineMessageType(text);

  // Send message
  const result =
    messageType === "markdown"
      ? await sendMarkdownMessage(cfg, to, text)
      : await sendTextMessage(cfg, to, text);

  if (!result.success) {
    return {
      channel: "office-website",
      messageId: result.messageId || generateMessageId(),
      meta: { error: result.error },
    };
  }

  return {
    channel: "office-website",
    messageId: result.messageId || generateMessageId(),
    chatId: to,
  };
}

/**
 * Send media message to office-website frontend
 */
async function sendOutboundMedia(params: {
  cfg: OpenClawConfig;
  to: string;
  text?: string;
  mediaUrl?: string;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, text, mediaUrl, accountId } = params;

  // Resolve account
  const account = resolveOfficeWebsiteAccount(cfg, accountId);
  if (!account.configured) {
    return {
      channel: "office-website",
      messageId: "",
      meta: { error: "Account not configured" },
    };
  }

  // Build media attachment
  const attachments: MediaAttachment[] = [];

  if (mediaUrl) {
    // Determine media type from URL
    const urlLower = mediaUrl.toLowerCase();
    let mediaType: MediaAttachment["type"] = "document";

    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(urlLower)) {
      mediaType = "image";
    } else if (/\.(mp4|webm|mov|avi)$/i.test(urlLower)) {
      mediaType = "video";
    } else if (/\.(mp3|wav|ogg|m4a)$/i.test(urlLower)) {
      mediaType = "audio";
    }

    // Extract filename from URL
    const filename = mediaUrl.split("/").pop() || "file";

    attachments.push({
      type: mediaType,
      filename,
      mimeType: getMimeType(filename),
      url: mediaUrl,
    });
  }

  // Send media message
  const result = await sendMediaMessage(cfg, to, attachments, text);

  if (!result.success) {
    return {
      channel: "office-website",
      messageId: result.messageId || generateMessageId(),
      meta: { error: result.error },
    };
  }

  return {
    channel: "office-website",
    messageId: result.messageId || generateMessageId(),
    chatId: to,
  };
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
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
  };

  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Office-Website Outbound Adapter
 *
 * Implements the ChannelOutboundAdapter interface for sending messages
 * from OpenClaw to the office-website frontend.
 */
export const officeWebsiteOutbound: ChannelOutboundAdapter = {
  // Gateway mode - messages are sent via HTTP API
  deliveryMode: "gateway",

  // Text chunking for long messages
  chunker: chunkTextByParagraph,
  chunkerMode: "markdown",
  textChunkLimit: 4000,

  /**
   * Send text message
   */
  sendText: async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
    const { cfg, to, text, accountId } = ctx;

    return sendOutboundText({
      cfg,
      to,
      text,
      accountId,
    });
  },

  /**
   * Send media message
   */
  sendMedia: async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
    const { cfg, to, text, mediaUrl, accountId } = ctx;

    // Send text first if provided
    if (text?.trim()) {
      await sendOutboundText({
        cfg,
        to,
        text,
        accountId,
      });
    }

    // Send media if URL provided
    if (mediaUrl) {
      return sendOutboundMedia({
        cfg,
        to,
        text: "",
        mediaUrl,
        accountId,
      });
    }

    // Return result for text-only case
    return {
      channel: "office-website",
      messageId: generateMessageId(),
      chatId: to,
    };
  },
};

// ============================================================================
// Template-based Message Helpers
// ============================================================================

/**
 * Send a message using a template
 *
 * @param params - Send parameters including template ID and variables
 * @returns Delivery result
 *
 * @example
 * ```typescript
 * await sendTemplateMessage({
 *   cfg,
 *   to: sessionId,
 *   templateId: "welcomeWithName",
 *   variables: { name: "张三" },
 * });
 * ```
 */
export async function sendTemplateMessage(params: {
  cfg: OpenClawConfig;
  to: string;
  templateId: string;
  variables?: TemplateVariables;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, templateId, variables, accountId } = params;

  const text = getTemplate(templateId, variables);

  if (!text) {
    return {
      channel: "office-website",
      messageId: "",
      meta: { error: `Template not found: ${templateId}` },
    };
  }

  return sendOutboundText({
    cfg,
    to,
    text,
    accountId,
  });
}

/**
 * Send a welcome message
 *
 * @param params - Send parameters
 * @returns Delivery result
 */
export async function sendWelcome(params: {
  cfg: OpenClawConfig;
  to: string;
  name?: string;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, name, accountId } = params;

  if (name) {
    return sendTemplateMessage({
      cfg,
      to,
      templateId: Templates.WELCOME_WITH_NAME,
      variables: { name },
      accountId,
    });
  }

  return sendTemplateMessage({
    cfg,
    to,
    templateId: Templates.WELCOME,
    accountId,
  });
}

/**
 * Send an error message
 *
 * @param params - Send parameters
 * @returns Delivery result
 */
export async function sendError(params: {
  cfg: OpenClawConfig;
  to: string;
  error: string;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, error, accountId } = params;

  return sendTemplateMessage({
    cfg,
    to,
    templateId: Templates.ERROR_GENERIC,
    variables: { error },
    accountId,
  });
}

/**
 * Send a permission denied message
 *
 * @param params - Send parameters
 * @returns Delivery result
 */
export async function sendPermissionDenied(params: {
  cfg: OpenClawConfig;
  to: string;
  action: string;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, action, accountId } = params;

  return sendTemplateMessage({
    cfg,
    to,
    templateId: Templates.PERMISSION_DENIED,
    variables: { action },
    accountId,
  });
}

/**
 * Send a document saved message
 *
 * @param params - Send parameters
 * @returns Delivery result
 */
export async function sendDocumentSaved(params: {
  cfg: OpenClawConfig;
  to: string;
  name: string;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, name, accountId } = params;

  return sendTemplateMessage({
    cfg,
    to,
    templateId: Templates.DOCUMENT_SAVED,
    variables: { name },
    accountId,
  });
}

/**
 * Send a status update message
 *
 * @param params - Send parameters
 * @returns Delivery result
 */
export async function sendStatus(params: {
  cfg: OpenClawConfig;
  to: string;
  task: string;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, task, accountId } = params;

  return sendTemplateMessage({
    cfg,
    to,
    templateId: Templates.STATUS_PROCESSING,
    variables: { task },
    accountId,
  });
}

/**
 * Send a session timeout warning
 *
 * @param params - Send parameters
 * @returns Delivery result
 */
export async function sendSessionTimeoutWarning(params: {
  cfg: OpenClawConfig;
  to: string;
  minutes: number;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, minutes, accountId } = params;

  return sendTemplateMessage({
    cfg,
    to,
    templateId: Templates.SESSION_TIMEOUT,
    variables: { minutes },
    accountId,
  });
}

/**
 * Send a help message
 *
 * @param params - Send parameters
 * @returns Delivery result
 */
export async function sendHelp(params: {
  cfg: OpenClawConfig;
  to: string;
  accountId?: string | null;
}): Promise<OutboundDeliveryResult> {
  const { cfg, to, accountId } = params;

  return sendTemplateMessage({
    cfg,
    to,
    templateId: Templates.HELP_INTRO,
    accountId,
  });
}

// Re-export template utilities for convenience
export {
  getTemplate,
  renderTemplate,
  templateBuilder,
  Templates,
  type TemplateVariables,
};

export default officeWebsiteOutbound;
