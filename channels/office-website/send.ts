/**
 * Office-Website Channel Message Sender
 *
 * Handles sending messages from OpenClaw to the office-website frontend.
 * Supports rich text, code blocks, media files, and document operations.
 *
 * @module channels/office-website/send
 */

import type { OpenClawConfig } from "../../config/config.js";
import type { DocumentContext } from "./api.js";

/**
 * Message types that can be sent to office-website
 */
export type MessageType =
  | "text"
  | "markdown"
  | "code"
  | "document_edit"
  | "document_annotate"
  | "error"
  | "status"
  | "rich_text"
  | "media"
  | "file"
  | "stream_start"
  | "stream_delta"
  | "stream_end";

/**
 * Rich text content block types
 */
export type RichTextBlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "code"
  | "quote"
  | "image"
  | "link"
  | "table";

/**
 * Rich text block structure
 */
export interface RichTextBlock {
  type: RichTextBlockType;
  content: string;
  level?: number; // For headings (1-6)
  ordered?: boolean; // For lists
  language?: string; // For code blocks
  url?: string; // For images and links
  alt?: string; // For images
  rows?: string[][]; // For tables
}

/**
 * Media file types
 */
export type MediaFileType = "image" | "audio" | "video" | "document";

/**
 * Media file attachment
 */
export interface MediaAttachment {
  type: MediaFileType;
  filename: string;
  mimeType: string;
  url?: string; // Remote URL
  base64?: string; // Base64 encoded data
  size?: number; // File size in bytes
  thumbnail?: string; // Thumbnail for images/videos
}

/**
 * Message content structure
 */
export interface OutboundMessage {
  type: MessageType;
  content: string;
  metadata?: {
    documentId?: string;
    language?: string;
    lineStart?: number;
    lineEnd?: number;
    annotationId?: string;
    status?: string;
    error?: string;
    // Rich text support
    blocks?: RichTextBlock[];
    // Media support
    attachments?: MediaAttachment[];
    // Stream support
    streamId?: string;
    isComplete?: boolean;
    // Formatting
    format?: "plain" | "markdown" | "html";
  };
}

/**
 * Send result
 */
export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send options
 */
export interface SendOptions {
  sessionId: string;
  message: OutboundMessage;
  documentContext?: DocumentContext;
  replyToId?: string;
}

/**
 * Send a message to the office-website frontend
 *
 * This function sends messages from OpenClaw to the office-website client
 * via HTTP POST to the configured webhook URL.
 *
 * @param cfg - OpenClaw configuration
 * @param options - Send options
 */
export async function sendMessage(
  cfg: OpenClawConfig,
  options: SendOptions,
): Promise<SendResult> {
  const { sessionId, message, documentContext, replyToId } = options;

  // Get webhook URL from configuration
  const webhookUrl = cfg.channels?.["office-website"]?.webhookUrl;
  if (!webhookUrl) {
    return {
      success: false,
      error: "No webhook URL configured for office-website channel",
    };
  }

  // Prepare payload
  const payload = {
    sessionId,
    message: {
      ...message,
      timestamp: Date.now(),
      replyToId,
    },
    documentContext,
  };

  try {
    // Send to webhook
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Webhook returned ${response.status}: ${response.statusText}`,
      };
    }

    const result = await response.json();
    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send a text message
 */
export async function sendTextMessage(
  cfg: OpenClawConfig,
  sessionId: string,
  content: string,
  documentContext?: DocumentContext,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: { type: "text", content },
    documentContext,
  });
}

/**
 * Send a markdown message
 */
export async function sendMarkdownMessage(
  cfg: OpenClawConfig,
  sessionId: string,
  content: string,
  documentContext?: DocumentContext,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: { type: "markdown", content },
    documentContext,
  });
}

/**
 * Send a code block
 */
export async function sendCodeBlock(
  cfg: OpenClawConfig,
  sessionId: string,
  code: string,
  language: string,
  documentContext?: DocumentContext,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "code",
      content: code,
      metadata: { language },
    },
    documentContext,
  });
}

/**
 * Send a document edit operation
 */
export async function sendDocumentEdit(
  cfg: OpenClawConfig,
  sessionId: string,
  documentId: string,
  content: string,
  lineStart?: number,
  lineEnd?: number,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "document_edit",
      content,
      metadata: { documentId, lineStart, lineEnd },
    },
  });
}

/**
 * Send a document annotation
 */
export async function sendDocumentAnnotation(
  cfg: OpenClawConfig,
  sessionId: string,
  documentId: string,
  content: string,
  annotationId?: string,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "document_annotate",
      content,
      metadata: { documentId, annotationId },
    },
  });
}

/**
 * Send an error message
 */
export async function sendErrorMessage(
  cfg: OpenClawConfig,
  sessionId: string,
  error: string,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "error",
      content: error,
      metadata: { error },
    },
  });
}

/**
 * Send a status update
 */
export async function sendStatusUpdate(
  cfg: OpenClawConfig,
  sessionId: string,
  status: string,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "status",
      content: status,
      metadata: { status },
    },
  });
}

/**
 * Send a rich text message with structured blocks
 *
 * Supports multiple content types: paragraphs, headings, lists, code blocks,
 * quotes, images, links, and tables.
 */
export async function sendRichTextMessage(
  cfg: OpenClawConfig,
  sessionId: string,
  blocks: RichTextBlock[],
  documentContext?: DocumentContext,
): Promise<SendResult> {
  // Convert blocks to markdown for backward compatibility
  const markdownContent = blocksToMarkdown(blocks);

  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "rich_text",
      content: markdownContent,
      metadata: {
        blocks,
        format: "markdown",
      },
    },
    documentContext,
  });
}

/**
 * Send a media file attachment
 *
 * Supports images, audio, video, and document files.
 * Can include both remote URLs and base64-encoded data.
 */
export async function sendMediaMessage(
  cfg: OpenClawConfig,
  sessionId: string,
  attachments: MediaAttachment[],
  caption?: string,
  documentContext?: DocumentContext,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "media",
      content: caption || "",
      metadata: {
        attachments,
      },
    },
    documentContext,
  });
}

/**
 * Send a file attachment
 *
 * For sending document files (PDF, DOCX, etc.)
 */
export async function sendFileMessage(
  cfg: OpenClawConfig,
  sessionId: string,
  filename: string,
  mimeType: string,
  options: {
    url?: string;
    base64?: string;
    size?: number;
  },
  documentContext?: DocumentContext,
): Promise<SendResult> {
  const attachment: MediaAttachment = {
    type: "document",
    filename,
    mimeType,
    ...options,
  };

  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "file",
      content: filename,
      metadata: {
        attachments: [attachment],
      },
    },
    documentContext,
  });
}

/**
 * Send stream start event
 *
 * Marks the beginning of a streaming response.
 */
export async function sendStreamStart(
  cfg: OpenClawConfig,
  sessionId: string,
  streamId: string,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "stream_start",
      content: "",
      metadata: {
        streamId,
        isComplete: false,
      },
    },
  });
}

/**
 * Send stream delta event
 *
 * Sends a chunk of streaming content.
 */
export async function sendStreamDelta(
  cfg: OpenClawConfig,
  sessionId: string,
  streamId: string,
  delta: string,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "stream_delta",
      content: delta,
      metadata: {
        streamId,
        isComplete: false,
      },
    },
  });
}

/**
 * Send stream end event
 *
 * Marks the end of a streaming response.
 */
export async function sendStreamEnd(
  cfg: OpenClawConfig,
  sessionId: string,
  streamId: string,
  fullContent?: string,
): Promise<SendResult> {
  return sendMessage(cfg, {
    sessionId,
    message: {
      type: "stream_end",
      content: fullContent || "",
      metadata: {
        streamId,
        isComplete: true,
      },
    },
  });
}

/**
 * Convert rich text blocks to markdown
 *
 * Utility function for backward compatibility with markdown-only clients.
 */
export function blocksToMarkdown(blocks: RichTextBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "paragraph":
          return block.content;
        case "heading": {
          const headingPrefix = "#".repeat(block.level || 1);
          return `${headingPrefix} ${block.content}`;
        }
        case "list": {
          const listPrefix = block.ordered ? "1." : "-";
          return block.content
            .split("\n")
            .map((line) => `${listPrefix} ${line}`)
            .join("\n");
        }
        case "code":
          return `\`\`\`${block.language || ""}\n${block.content}\n\`\`\``;
        case "quote":
          return block.content
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        case "image":
          return `![${block.alt || "image"}](${block.url || ""})`;
        case "link":
          return `[${block.content}](${block.url || ""})`;
        case "table":
          if (!block.rows || block.rows.length === 0) return "";
          const header = `| ${block.rows[0].join(" | ")} |`;
          const separator = `| ${block.rows[0].map(() => "---").join(" | ")} |`;
          const body = block.rows
            .slice(1)
            .map((row) => `| ${row.join(" | ")} |`)
            .join("\n");
          return `${header}\n${separator}\n${body}`;
        default:
          return block.content;
      }
    })
    .join("\n\n");
}

/**
 * Parse markdown to rich text blocks
 *
 * Utility function for converting markdown to structured blocks.
 */
export function markdownToBlocks(markdown: string): RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  const lines = markdown.split("\n");
  let currentBlock: RichTextBlock | null = null;
  let codeBlockContent: string[] = [];
  let inCodeBlock = false;
  let codeLanguage = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        blocks.push({
          type: "code",
          content: codeBlockContent.join("\n"),
          language: codeLanguage,
        });
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        // Start code block
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Handle headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        content: headingMatch[2],
        level: headingMatch[1].length,
      });
      continue;
    }

    // Handle list items
    const listMatch = line.match(/^(\d+\.\s|[-*+]\s)(.+)$/);
    if (listMatch) {
      if (!currentBlock || currentBlock.type !== "list") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = {
          type: "list",
          content: listMatch[2],
          ordered: /^\d+\./.test(listMatch[1]),
        };
      } else {
        currentBlock.content += "\n" + listMatch[2];
      }
      continue;
    }

    // Handle quotes
    if (line.startsWith("> ")) {
      if (!currentBlock || currentBlock.type !== "quote") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = {
          type: "quote",
          content: line.slice(2),
        };
      } else {
        currentBlock.content += "\n" + line.slice(2);
      }
      continue;
    }

    // Handle images
    const imageMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (imageMatch) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      blocks.push({
        type: "image",
        content: "",
        alt: imageMatch[1],
        url: imageMatch[2],
      });
      continue;
    }

    // Handle links
    const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && !line.includes("![")) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      blocks.push({
        type: "link",
        content: linkMatch[1],
        url: linkMatch[2],
      });
      continue;
    }

    // Handle paragraphs
    if (line.trim()) {
      if (!currentBlock || currentBlock.type !== "paragraph") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = {
          type: "paragraph",
          content: line,
        };
      } else {
        currentBlock.content += "\n" + line;
      }
    } else if (currentBlock) {
      blocks.push(currentBlock);
      currentBlock = null;
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks;
}
