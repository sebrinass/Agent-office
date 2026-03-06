/**
 * Office-Website Channel Document Operations
 *
 * Provides document context management and operation interfaces
 * for the office-website channel.
 *
 * @module channels/office-website/document-operations
 */

import type { OpenClawConfig } from "../../config/config.js";
import type { DocumentContext } from "./api.js";
import type { SessionManager } from "./session.js";
import { checkPermission, checkPermissions } from "./permissions.js";

/**
 * Document operation types
 */
export type DocumentOperationType =
  | "insert"
  | "replace"
  | "delete"
  | "annotate"
  | "format"
  | "select";

/**
 * Document operation request
 */
export interface DocumentOperationRequest {
  sessionId: string;
  documentId: string;
  operation: DocumentOperationType;
  params: {
    // For insert/replace
    text?: string;
    position?: number;
    start?: number;
    end?: number;
    // For annotate
    annotationText?: string;
    author?: string;
    // For format
    formatType?: "bold" | "italic" | "underline" | "heading" | "list";
    // For select
    selectionStart?: number;
    selectionEnd?: number;
  };
}

/**
 * Document operation result
 */
export interface DocumentOperationResult {
  success: boolean;
  operationId?: string;
  error?: string;
  data?: {
    affectedRange?: { start: number; end: number };
    annotationId?: string;
  };
}

/**
 * Document context snapshot
 */
export interface DocumentSnapshot {
  documentId: string;
  documentName: string;
  documentType: string;
  content: string;
  selectedText?: string;
  permissions: DocumentContext["permissions"];
  version: number;
  lastModified: number;
  checksum: string;
}

/**
 * Document change event
 */
export interface DocumentChangeEvent {
  documentId: string;
  sessionId: string;
  changeType: "content" | "selection" | "permission" | "metadata";
  previousValue?: unknown;
  newValue?: unknown;
  timestamp: number;
}

/**
 * Document context manager
 *
 * Manages document context for sessions, tracking changes and
 * providing operation interfaces.
 */
export class DocumentContextManager {
  private sessionManager: SessionManager;
  private documentSnapshots: Map<string, DocumentSnapshot> = new Map();
  private documentVersions: Map<string, number> = new Map();
  private changeListeners: Set<(event: DocumentChangeEvent) => void> = new Set();
  private operationHistory: Map<string, DocumentOperationRequest[]> = new Map();

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Update document context for a session
   */
  updateContext(sessionId: string, context: DocumentContext): DocumentSnapshot {
    const previousSnapshot = this.documentSnapshots.get(context.documentId);
    const version = (this.documentVersions.get(context.documentId) || 0) + 1;

    const snapshot: DocumentSnapshot = {
      documentId: context.documentId,
      documentName: context.documentName,
      documentType: context.documentType,
      content: context.content || "",
      selectedText: context.selectedText,
      permissions: context.permissions,
      version,
      lastModified: Date.now(),
      checksum: this.calculateChecksum(context.content || ""),
    };

    // Store snapshot
    this.documentSnapshots.set(context.documentId, snapshot);
    this.documentVersions.set(context.documentId, version);

    // Update session context
    this.sessionManager.updateDocumentContext(sessionId, context);

    // Emit change event
    if (previousSnapshot) {
      this.emitChange({
        documentId: context.documentId,
        sessionId,
        changeType: "content",
        previousValue: previousSnapshot.content,
        newValue: context.content,
        timestamp: Date.now(),
      });
    }

    return snapshot;
  }

  /**
   * Get document context for a session
   */
  getContext(sessionId: string): DocumentContext | undefined {
    const session = this.sessionManager.getSession(sessionId);
    return session?.documentContext;
  }

  /**
   * Get document snapshot
   */
  getSnapshot(documentId: string): DocumentSnapshot | undefined {
    return this.documentSnapshots.get(documentId);
  }

  /**
   * Execute a document operation
   */
  async executeOperation(
    request: DocumentOperationRequest,
  ): Promise<DocumentOperationResult> {
    const { sessionId, documentId, operation, params } = request;

    // Get session and document context
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { success: false, error: "Session not found" };
    }

    const documentContext = session.documentContext;
    if (!documentContext || documentContext.documentId !== documentId) {
      return { success: false, error: "Document not found in session context" };
    }

    // Check permissions based on operation type
    const permissionCheck = this.checkOperationPermission(operation, documentContext.permissions);
    if (!permissionCheck.granted) {
      return { success: false, error: permissionCheck.error };
    }

    // Generate operation ID
    const operationId = `op-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    // Record operation in history
    if (!this.operationHistory.has(documentId)) {
      this.operationHistory.set(documentId, []);
    }
    this.operationHistory.get(documentId)!.push(request);

    // Execute operation (in production, this would interact with the actual document)
    try {
      const result = await this.performOperation(request, operationId);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Operation failed",
      };
    }
  }

  /**
   * Get operation history for a document
   */
  getOperationHistory(documentId: string, limit?: number): DocumentOperationRequest[] {
    const history = this.operationHistory.get(documentId) || [];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Subscribe to document changes
   */
  subscribeToChanges(listener: (event: DocumentChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /**
   * Clear document context for a session
   */
  clearContext(sessionId: string): boolean {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return false;
    }

    this.sessionManager.updateSession(sessionId, {
      documentContext: undefined,
    });

    return true;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Check permission for an operation
   */
  private checkOperationPermission(
    operation: DocumentOperationType,
    permissions: DocumentContext["permissions"],
  ): { granted: boolean; error?: string } {
    switch (operation) {
      case "insert":
      case "replace":
      case "delete":
      case "format":
        if (!permissions.canEdit) {
          return { granted: false, error: "Edit permission required" };
        }
        break;
      case "annotate":
        if (!permissions.canAnnotate && !permissions.canEdit) {
          return { granted: false, error: "Annotate or edit permission required" };
        }
        break;
      case "select":
        if (!permissions.canView) {
          return { granted: false, error: "View permission required" };
        }
        break;
    }
    return { granted: true };
  }

  /**
   * Perform the actual operation
   */
  private async performOperation(
    request: DocumentOperationRequest,
    operationId: string,
  ): Promise<DocumentOperationResult> {
    const { operation, params } = request;

    // In production, this would send the operation to the office-website client
    // For now, we just validate and return success

    switch (operation) {
      case "insert":
        if (params.text === undefined || params.position === undefined) {
          return { success: false, error: "Missing text or position for insert" };
        }
        return {
          success: true,
          operationId,
          data: {
            affectedRange: {
              start: params.position,
              end: params.position + params.text.length,
            },
          },
        };

      case "replace":
        if (params.text === undefined || params.start === undefined || params.end === undefined) {
          return { success: false, error: "Missing text, start, or end for replace" };
        }
        return {
          success: true,
          operationId,
          data: {
            affectedRange: {
              start: params.start,
              end: params.start + params.text.length,
            },
          },
        };

      case "delete":
        if (params.start === undefined || params.end === undefined) {
          return { success: false, error: "Missing start or end for delete" };
        }
        return {
          success: true,
          operationId,
          data: {
            affectedRange: { start: params.start, end: params.end },
          },
        };

      case "annotate":
        if (params.annotationText === undefined || params.start === undefined || params.end === undefined) {
          return { success: false, error: "Missing annotationText, start, or end for annotate" };
        }
        return {
          success: true,
          operationId,
          data: {
            annotationId: `ann-${Date.now()}`,
            affectedRange: { start: params.start, end: params.end },
          },
        };

      case "format":
        if (params.formatType === undefined || params.start === undefined || params.end === undefined) {
          return { success: false, error: "Missing formatType, start, or end for format" };
        }
        return {
          success: true,
          operationId,
          data: {
            affectedRange: { start: params.start, end: params.end },
          },
        };

      case "select":
        if (params.selectionStart === undefined || params.selectionEnd === undefined) {
          return { success: false, error: "Missing selectionStart or selectionEnd for select" };
        }
        return {
          success: true,
          operationId,
          data: {
            affectedRange: { start: params.selectionStart, end: params.selectionEnd },
          },
        };

      default:
        return { success: false, error: `Unknown operation: ${operation}` };
    }
  }

  /**
   * Calculate checksum for content
   */
  private calculateChecksum(content: string): string {
    // Simple checksum for change detection
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * Emit change event to listeners
   */
  private emitChange(event: DocumentChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Document change listener error:", error);
      }
    }
  }
}

/**
 * Create document context manager
 */
export function createDocumentContextManager(sessionManager: SessionManager): DocumentContextManager {
  return new DocumentContextManager(sessionManager);
}

/**
 * Document operation builder for convenient operation creation
 */
export class DocumentOperationBuilder {
  private request: Partial<DocumentOperationRequest> = {};

  sessionId(sessionId: string): this {
    this.request.sessionId = sessionId;
    return this;
  }

  documentId(documentId: string): this {
    this.request.documentId = documentId;
    return this;
  }

  insert(text: string, position: number): this {
    this.request.operation = "insert";
    this.request.params = { text, position };
    return this;
  }

  replace(text: string, start: number, end: number): this {
    this.request.operation = "replace";
    this.request.params = { text, start, end };
    return this;
  }

  delete(start: number, end: number): this {
    this.request.operation = "delete";
    this.request.params = { start, end };
    return this;
  }

  annotate(annotationText: string, start: number, end: number, author?: string): this {
    this.request.operation = "annotate";
    this.request.params = { annotationText, start, end, author };
    return this;
  }

  format(formatType: DocumentOperationRequest["params"]["formatType"], start: number, end: number): this {
    this.request.operation = "format";
    this.request.params = { formatType, start, end };
    return this;
  }

  select(selectionStart: number, selectionEnd: number): this {
    this.request.operation = "select";
    this.request.params = { selectionStart, selectionEnd };
    return this;
  }

  build(): DocumentOperationRequest {
    if (!this.request.sessionId || !this.request.documentId || !this.request.operation) {
      throw new Error("Missing required fields for document operation");
    }
    return this.request as DocumentOperationRequest;
  }
}

/**
 * Create document operation builder
 */
export function documentOperation(): DocumentOperationBuilder {
  return new DocumentOperationBuilder();
}
