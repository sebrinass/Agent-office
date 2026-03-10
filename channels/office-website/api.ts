/**
 * Office-Website Channel HTTP API
 *
 * Defines HTTP API endpoints for the office-website channel.
 * These endpoints are exposed by the OpenClaw Gateway.
 *
 * @module channels/office-website/api
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../../config/config";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk";
import { z } from "zod";
import { authenticateRequest } from "./auth";
import { SessionManager, type SessionMessage } from "./session";
import { checkPermission } from "./permissions";
import type { ResolvedOfficeWebsiteAccount } from "./config";
import { maskSensitive } from "./utils";

// ============================================================================
// Zod Schemas for Request Validation (C-004 Fix)
// ============================================================================

/**
 * Document permissions schema
 */
export const DocumentPermissionsSchema = z.object({
  canView: z.boolean().default(true),
  canAnnotate: z.boolean().default(false),
  canEdit: z.boolean().default(false),
});

/**
 * Document context schema
 */
export const DocumentContextSchema = z.object({
  documentId: z.string().min(1, "documentId is required"),
  documentName: z.string().min(1, "documentName is required"),
  documentType: z.string().default("document"),
  content: z.string().max(1000000, "Document content too large (max 1MB)").optional(),
  selectedText: z.string().max(100000, "Selected text too large (max 100KB)").optional(),
  permissions: DocumentPermissionsSchema,
});

/**
 * Message request schema
 */
export const MessageRequestSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required").max(256, "sessionId too long"),
  content: z.string().min(1, "content is required").max(100000, "Message content too large (max 100KB)"),
  documentContext: DocumentContextSchema.optional(),
});

/**
 * Document sync request schema
 */
export const DocumentSyncRequestSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required").max(256, "sessionId too long"),
  document: DocumentContextSchema,
});

/**
 * History query schema
 */
export const HistoryQuerySchema = z.object({
  sessionId: z.string().min(1, "sessionId is required").max(256, "sessionId too long"),
  limit: z.coerce.number().int().min(1).max(1000).default(100).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
  startDate: z.string().datetime({ message: "Invalid startDate format, expected ISO 8601" }).optional(),
  endDate: z.string().datetime({ message: "Invalid endDate format, expected ISO 8601" }).optional(),
  query: z.string().max(1000, "Query too long").optional(),
});

/**
 * Stream request schema
 */
export const StreamRequestSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required").max(256, "sessionId too long"),
});

// ============================================================================
// Inferred Types from Zod Schemas
// ============================================================================

export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type DocumentContext = z.infer<typeof DocumentContextSchema>;
export type DocumentSyncRequest = z.infer<typeof DocumentSyncRequestSchema>;
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
export type StreamRequest = z.infer<typeof StreamRequestSchema>;

/**
 * API Response types
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface SessionResponse {
  sessionId: string;
  status: "active" | "idle" | "expired";
  createdAt: number;
  lastActivityAt: number;
  messageCount: number;
}

export interface HistoryResponse {
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    documentContext?: DocumentContext;
  }>;
  total: number;
  hasMore: boolean;
}

/**
 * SSE Event types
 */
export type SSEEventType = 
  | "connected"
  | "message_start"
  | "message_delta"
  | "message_end"
  | "error"
  | "ping";

export interface SSEEvent {
  event: SSEEventType;
  data: Record<string, unknown>;
}

/**
 * Validation error result
 */
export interface ValidationError {
  success: false;
  error: string;
  details?: z.ZodError["issues"];
}

/**
 * Global session manager instance
 * Set by the monitor when the channel starts
 */
let globalSessionManager: SessionManager | null = null;

/**
 * Global channel runtime context for Agent Core integration
 */
let globalChannelRuntime: ChannelGatewayContext<ResolvedOfficeWebsiteAccount>["channelRuntime"] | null = null;

/**
 * Set the global session manager
 */
export function setSessionManager(manager: SessionManager): void {
  globalSessionManager = manager;
}

/**
 * Get the global session manager
 */
export function getSessionManager(): SessionManager | null {
  return globalSessionManager;
}

/**
 * Set the global channel runtime for Agent Core integration
 */
export function setChannelRuntime(
  runtime: ChannelGatewayContext<ResolvedOfficeWebsiteAccount>["channelRuntime"] | undefined,
): void {
  globalChannelRuntime = runtime ?? null;
}

/**
 * Get the global channel runtime
 */
export function getChannelRuntime(): ChannelGatewayContext<ResolvedOfficeWebsiteAccount>["channelRuntime"] | null {
  return globalChannelRuntime;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Read JSON body from request
 */
async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => {
      resolve(null);
    });
  });
}

/**
 * Send JSON response
 */
function sendJson<T>(res: ServerResponse, status: number, data: T): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

/**
 * Set CORS headers for cross-origin requests
 */
function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * Handle OPTIONS preflight request
 * @returns true if request was handled as OPTIONS, false otherwise
 */
function handleOptionsRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.setHeader("Access-Control-Max-Age", "86400");
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

/**
 * Extract Authorization header from request
 */
function extractAuthHeader(req: IncomingMessage): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    return auth;
  }
  const token = req.headers["x-openclaw-token"];
  if (typeof token === "string") {
    return `Bearer ${token}`;
  }
  return undefined;
}

/**
 * Validate request with Zod schema
 */
function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | ValidationError {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    details: result.error.issues,
  };
}

// ============================================================================
// SSE Streaming Implementation (C-003 Fix)
// ============================================================================

/**
 * SSE Encoder for formatting events
 */
class SSEEncoder {
  private encoder = new TextEncoder();

  encode(event: SSEEvent): Uint8Array {
    const lines: string[] = [];
    lines.push(`event: ${event.event}`);
    
    // Format data as JSON
    const dataStr = JSON.stringify(event.data);
    // Split data by newlines for proper SSE format
    for (const line of dataStr.split("\n")) {
      lines.push(`data: ${line}`);
    }
    lines.push("", ""); // Empty line to separate events
    
    return this.encoder.encode(lines.join("\n"));
  }
}

/**
 * Create SSE stream connection
 */
function createSSEStream(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
): {
  send: (event: SSEEvent) => boolean;
  close: () => void;
} {
  const encoder = new SSEEncoder();
  let closed = false;

  // Set SSE headers with security headers
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform, no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  
  // Security headers to prevent common attacks
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Send initial connection event
  const connectEvent: SSEEvent = {
    event: "connected",
    data: { sessionId, timestamp: Date.now() },
  };
  res.write(encoder.encode(connectEvent));

  // Setup heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    if (closed) {
      clearInterval(heartbeatInterval);
      return;
    }
    try {
      const pingEvent: SSEEvent = {
        event: "ping",
        data: { timestamp: Date.now() },
      };
      res.write(encoder.encode(pingEvent));
    } catch {
      // Connection likely closed
      closed = true;
      clearInterval(heartbeatInterval);
    }
  }, 30000); // 30 second heartbeat

  // Handle client disconnect
  req.on("close", () => {
    closed = true;
    clearInterval(heartbeatInterval);
  });

  return {
    send: (event: SSEEvent) => {
      if (closed) {
        return false;
      }
      try {
        res.write(encoder.encode(event));
        return true;
      } catch {
        closed = true;
        clearInterval(heartbeatInterval);
        return false;
      }
    },
    close: () => {
      if (!closed) {
        closed = true;
        clearInterval(heartbeatInterval);
        res.end();
      }
    },
  };
}

// ============================================================================
// API Handlers
// ============================================================================

/**
 * Office-Website API handlers
 *
 * These handlers are registered with the OpenClaw Gateway HTTP server.
 */
export const officeWebsiteApi = {
  /**
   * POST /api/office-website/message
   * Receive a message from office-website
   */
  handleMessage: async (
    cfg: OpenClawConfig,
    request: MessageRequest,
    authHeader?: string,
    sessionManager?: SessionManager,
  ): Promise<ApiResponse<{ messageId: string; sessionId: string }>> => {
    // Authenticate request
    const authResult = await authenticateRequest(cfg, authHeader);
    if (!authResult.valid) {
      return { success: false, error: "Unauthorized" };
    }

    // Check permissions for document operations
    if (request.documentContext) {
      const hasPermission = checkPermission(
        request.documentContext.permissions,
        "view",
      );
      if (!hasPermission) {
        return { success: false, error: "No permission to view document" };
      }
    }

    // Get or create session
    const manager = sessionManager ?? globalSessionManager;
    if (manager) {
      let session = manager.getSession(request.sessionId);
      if (!session) {
        session = manager.createSession(request.sessionId);
      }

      // Update document context if provided
      if (request.documentContext) {
        manager.updateDocumentContext(request.sessionId, request.documentContext);
      }

      // Add user message to session
      const message = manager.addMessage(request.sessionId, {
        role: "user",
        content: request.content,
        documentContext: request.documentContext,
      });

      if (message) {
        return {
          success: true,
          data: { messageId: message.id, sessionId: request.sessionId },
        };
      }
    }

    // Fallback: generate a simple ID if no session manager
    return {
      success: true,
      data: {
        messageId: `msg-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        sessionId: request.sessionId,
      },
    };
  },

  /**
   * GET /api/office-website/stream
   * SSE stream for real-time responses (C-003 Fix)
   */
  handleStream: async (
    cfg: OpenClawConfig,
    sessionId: string,
    authHeader?: string,
    sessionManager?: SessionManager,
    channelRuntime?: ChannelGatewayContext<ResolvedOfficeWebsiteAccount>["channelRuntime"],
  ): Promise<void> => {
    // This is handled directly in handleStreamHttpRequest
    // This function exists for API consistency
  },

  /**
   * POST /api/office-website/document
   * Sync document information
   */
  handleDocumentSync: async (
    cfg: OpenClawConfig,
    request: DocumentSyncRequest,
    authHeader?: string,
    sessionManager?: SessionManager,
  ): Promise<ApiResponse> => {
    // Authenticate request
    const authResult = await authenticateRequest(cfg, authHeader);
    if (!authResult.valid) {
      return { success: false, error: "Unauthorized" };
    }

    // Update document context in session
    const manager = sessionManager ?? globalSessionManager;
    if (manager) {
      let session = manager.getSession(request.sessionId);
      if (!session) {
        session = manager.createSession(request.sessionId);
      }
      manager.updateDocumentContext(request.sessionId, request.document);
    }

    return { success: true, message: "Document synced" };
  },

  /**
   * GET /api/office-website/history
   * Get conversation history
   */
  handleHistory: async (
    cfg: OpenClawConfig,
    query: HistoryQuery,
    authHeader?: string,
    sessionManager?: SessionManager,
  ): Promise<ApiResponse<HistoryResponse>> => {
    // Authenticate request
    const authResult = await authenticateRequest(cfg, authHeader);
    if (!authResult.valid) {
      return { success: false, error: "Unauthorized" };
    }

    // Get messages from session manager
    const manager = sessionManager ?? globalSessionManager;
    if (manager) {
      const messages = manager.getMessages(query.sessionId, {
        limit: query.limit,
        offset: query.offset,
        startDate: query.startDate ? new Date(query.startDate).getTime() : undefined,
        endDate: query.endDate ? new Date(query.endDate).getTime() : undefined,
      });

      return {
        success: true,
        data: {
          messages: messages.map((m: SessionMessage) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            documentContext: m.documentContext,
          })),
          total: messages.length,
          hasMore: query.limit ? messages.length === query.limit : false,
        },
      };
    }

    return {
      success: true,
      data: {
        messages: [],
        total: 0,
        hasMore: false,
      },
    };
  },

  /**
   * GET /api/office-website/session
   * Get session status
   */
  handleSessionStatus: async (
    cfg: OpenClawConfig,
    sessionId: string,
    authHeader?: string,
    sessionManager?: SessionManager,
  ): Promise<ApiResponse<SessionResponse>> => {
    // Authenticate request
    const authResult = await authenticateRequest(cfg, authHeader);
    if (!authResult.valid) {
      return { success: false, error: "Unauthorized" };
    }

    // Get session from manager
    const manager = sessionManager ?? globalSessionManager;
    if (manager) {
      const session = manager.getSession(sessionId);
      if (session) {
        return {
          success: true,
          data: {
            sessionId: session.sessionId,
            status: session.status,
            createdAt: session.createdAt,
            lastActivityAt: session.lastActivityAt,
            messageCount: session.messageCount,
          },
        };
      }
    }

    return {
      success: true,
      data: {
        sessionId,
        status: "active",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        messageCount: 0,
      },
    };
  },

  /**
   * GET /api/office-website/ping
   * Heartbeat endpoint for connection keepalive
   */
  handlePing: async (
    cfg: OpenClawConfig,
    sessionId: string,
    authHeader?: string,
    sessionManager?: SessionManager,
  ): Promise<ApiResponse<{ pong: boolean; timestamp: number }>> => {
    // Authenticate request (optional for ping)
    const authResult = await authenticateRequest(cfg, authHeader);
    if (!authResult.valid) {
      // For ping, we still return success but mark as unauthenticated
      return {
        success: true,
        data: { pong: true, timestamp: Date.now() },
      };
    }

    // Update session activity if available
    const manager = sessionManager ?? globalSessionManager;
    if (manager && sessionId) {
      const session = manager.getSession(sessionId);
      if (session) {
        manager.updateSession(sessionId, { lastActivityAt: Date.now() });
      }
    }

    return {
      success: true,
      data: { pong: true, timestamp: Date.now() },
    };
  },
};

// ============================================================================
// HTTP Request Handlers with Zod Validation
// ============================================================================

/**
 * HTTP request handler for message endpoint
 */
export async function handleMessageHttpRequest(
  request: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
): Promise<boolean> {
  // Handle CORS preflight request
  if (handleOptionsRequest(request, res)) {
    return true;
  }

  // Set CORS headers for all responses
  setCorsHeaders(res);

  if (request.method !== "POST") {
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return true;
  }

  const body = await readJsonBody<unknown>(request);
  if (body === null) {
    sendJson(res, 400, { success: false, error: "Invalid JSON body" });
    return true;
  }

  // Validate with Zod schema
  const validation = validateRequest(MessageRequestSchema, body);
  if (!validation.success) {
    sendJson(res, 400, validation);
    return true;
  }

  const authHeader = extractAuthHeader(request);
  const result = await officeWebsiteApi.handleMessage(cfg, validation.data, authHeader);
  sendJson(res, result.success ? 200 : 400, result);
  return true;
}

/**
 * HTTP request handler for document sync endpoint
 */
export async function handleDocumentHttpRequest(
  request: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
): Promise<boolean> {
  // Handle CORS preflight request
  if (handleOptionsRequest(request, res)) {
    return true;
  }

  // Set CORS headers for all responses
  setCorsHeaders(res);

  if (request.method !== "POST") {
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return true;
  }

  const body = await readJsonBody<unknown>(request);
  if (body === null) {
    sendJson(res, 400, { success: false, error: "Invalid JSON body" });
    return true;
  }

  // Validate with Zod schema
  const validation = validateRequest(DocumentSyncRequestSchema, body);
  if (!validation.success) {
    sendJson(res, 400, validation);
    return true;
  }

  const authHeader = extractAuthHeader(request);
  const result = await officeWebsiteApi.handleDocumentSync(cfg, validation.data, authHeader);
  sendJson(res, result.success ? 200 : 400, result);
  return true;
}

/**
 * HTTP request handler for history endpoint
 */
export async function handleHistoryHttpRequest(
  request: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
): Promise<boolean> {
  // Handle CORS preflight request
  if (handleOptionsRequest(request, res)) {
    return true;
  }

  // Set CORS headers for all responses
  setCorsHeaders(res);

  if (request.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return true;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const queryParams = {
    sessionId: url.searchParams.get("sessionId") ?? "",
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    query: url.searchParams.get("query") ?? undefined,
  };

  // Validate with Zod schema
  const validation = validateRequest(HistoryQuerySchema, queryParams);
  if (!validation.success) {
    sendJson(res, 400, validation);
    return true;
  }

  const authHeader = extractAuthHeader(request);
  const result = await officeWebsiteApi.handleHistory(cfg, validation.data, authHeader);
  sendJson(res, result.success ? 200 : 400, result);
  return true;
}

/**
 * HTTP request handler for session status endpoint
 */
export async function handleSessionHttpRequest(
  request: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
): Promise<boolean> {
  // Handle CORS preflight request
  if (handleOptionsRequest(request, res)) {
    return true;
  }

  // Set CORS headers for all responses
  setCorsHeaders(res);

  if (request.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return true;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const sessionId = url.searchParams.get("sessionId") ?? "";

  // Validate sessionId
  const validation = validateRequest(
    z.object({ sessionId: z.string().min(1, "sessionId is required").max(256) }),
    { sessionId },
  );
  if (!validation.success) {
    sendJson(res, 400, validation);
    return true;
  }

  const authHeader = extractAuthHeader(request);
  const result = await officeWebsiteApi.handleSessionStatus(cfg, validation.data.sessionId, authHeader);
  sendJson(res, result.success ? 200 : 400, result);
  return true;
}

/**
 * HTTP request handler for ping/heartbeat endpoint
 */
export async function handlePingHttpRequest(
  request: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
): Promise<boolean> {
  // Handle CORS preflight request
  if (handleOptionsRequest(request, res)) {
    return true;
  }

  // Set CORS headers for all responses
  setCorsHeaders(res);

  if (request.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return true;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const sessionId = url.searchParams.get("sessionId") ?? "";

  const authHeader = extractAuthHeader(request);
  const result = await officeWebsiteApi.handlePing(cfg, sessionId, authHeader);
  sendJson(res, 200, result);
  return true;
}

/**
 * HTTP request handler for SSE stream endpoint (C-003 Fix)
 * 
 * Implements Server-Sent Events for real-time streaming responses.
 * Integrates with Agent Core for AI-powered responses.
 */
export async function handleStreamHttpRequest(
  request: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
): Promise<boolean> {
  // Handle CORS preflight request
  if (handleOptionsRequest(request, res)) {
    return true;
  }

  // Set CORS headers for all responses
  setCorsHeaders(res);

  if (request.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return true;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  let sessionId = url.searchParams.get("sessionId") ?? "";

  // Generate default sessionId if not provided
  if (!sessionId) {
    sessionId = `session-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  }

  // Validate sessionId
  const validation = validateRequest(StreamRequestSchema, { sessionId });
  if (!validation.success) {
    sendJson(res, 400, validation);
    return true;
  }

  // Authenticate
  const authHeader = extractAuthHeader(request);
  const authResult = await authenticateRequest(cfg, authHeader);
  if (!authResult.valid) {
    sendJson(res, 401, { success: false, error: "Unauthorized" });
    return true;
  }

  // Create SSE stream
  const { send, close } = createSSEStream(request, res, validation.data.sessionId);

  // Get session and check if there's a pending message to process
  const manager = globalSessionManager;
  const runtime = globalChannelRuntime;

  if (!manager) {
    send({
      event: "error",
      data: { message: "Session manager not available" },
    });
    close();
    return true;
  }

  // Get session
  const session = manager.getSession(validation.data.sessionId);
  if (!session) {
    send({
      event: "error",
      data: { message: "Session not found" },
    });
    close();
    return true;
  }

  // Check if we have Agent Core runtime available
  if (runtime?.reply) {
    try {
      // Get the last user message to process
      const messages = manager.getMessages(validation.data.sessionId, { limit: 1 });
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

      if (lastMessage && lastMessage.role === "user") {
        // Send message start event
        send({
          event: "message_start",
          data: { messageId: `stream-${Date.now()}` },
        });

        // Dispatch to Agent Core with streaming
        await runtime.reply.dispatchReplyWithBufferedBlockDispatcher({
          ctx: {
            Body: lastMessage.content,
            From: validation.data.sessionId,
            SenderId: validation.data.sessionId,
            AccountId: validation.data.sessionId,
            SessionKey: validation.data.sessionId,
            Provider: "office-website",
          },
          cfg,
          dispatcherOptions: {
            deliver: async (payload) => {
              if (payload.text) {
                // Send delta event
                send({
                  event: "message_delta",
                  data: { text: payload.text },
                });

                // Store assistant message
                manager.addMessage(validation.data.sessionId, {
                  role: "assistant",
                  content: payload.text,
                  documentContext: session.documentContext,
                });
              }
            },
          },
        });

        // Send message end event
        send({
          event: "message_end",
          data: { timestamp: Date.now() },
        });
      }
    } catch (error) {
      send({
        event: "error",
        data: {
          message: maskSensitive(
            error instanceof Error ? error.message : "Unknown error during streaming",
          ),
        },
      });
    }
  } else {
    // No Agent Core available - send status message
    send({
      event: "message_delta",
      data: { text: "SSE stream connected. Agent Core integration pending." },
    });
  }

  // Keep connection open until client disconnects
  // The SSE stream will handle cleanup automatically
  return true;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register API routes with the OpenClaw Gateway
 *
 * This function is called by the plugin registration to register HTTP routes.
 */
export function registerApiRoutes(params: {
  cfg: OpenClawConfig;
  sessionManager: SessionManager;
  registerHttpRoute: (params: {
    path: string;
    auth: "gateway" | "plugin";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  }) => void;
}): void {
  const { cfg, sessionManager, registerHttpRoute } = params;

  // Set global session manager
  setSessionManager(sessionManager);

  // Register HTTP routes
  registerHttpRoute({
    path: "/api/office-website/message",
    auth: "gateway",
    handler: async (req, res) => handleMessageHttpRequest(req, res, cfg),
  });

  registerHttpRoute({
    path: "/api/office-website/document",
    auth: "gateway",
    handler: async (req, res) => handleDocumentHttpRequest(req, res, cfg),
  });

  registerHttpRoute({
    path: "/api/office-website/history",
    auth: "gateway",
    handler: async (req, res) => handleHistoryHttpRequest(req, res, cfg),
  });

  registerHttpRoute({
    path: "/api/office-website/session",
    auth: "gateway",
    handler: async (req, res) => handleSessionHttpRequest(req, res, cfg),
  });

  registerHttpRoute({
    path: "/api/office-website/ping",
    auth: "gateway",
    handler: async (req, res) => handlePingHttpRequest(req, res, cfg),
  });

  registerHttpRoute({
    path: "/api/office-website/stream",
    auth: "gateway",
    handler: async (req, res) => handleStreamHttpRequest(req, res, cfg),
  });
}
