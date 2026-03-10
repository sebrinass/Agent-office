/**
 * Office-Website Channel Session Manager
 *
 * Manages sessions for the office-website channel, including creation,
 * destruction, state management, history tracking, and memory integration.
 *
 * @module channels/office-website/session
 */

import type { DocumentContext } from "./api";
import type { MemoryIntegration, MemoryEntry } from "./memory-integration";

/**
 * Session state
 */
export interface SessionState {
  sessionId: string;
  createdAt: number;
  lastActivityAt: number;
  status: "active" | "idle" | "expired";
  documentContext?: DocumentContext;
  permissions: {
    canView: boolean;
    canAnnotate: boolean;
    canEdit: boolean;
  };
  messageCount: number;
  metadata: Record<string, unknown>;
  // Memory integration
  memoryEnabled: boolean;
  memoryCount: number;
  lastMemoryGeneratedAt?: number;
}

/**
 * Session message
 */
export interface SessionMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  documentContext?: DocumentContext;
}

/**
 * Session Manager configuration
 */
export interface SessionManagerConfig {
  maxSessions: number;
  sessionTimeout: number;
  memoryEnabled: boolean;
  memoryProvider: string;
  embeddingModel: string;
  persistenceEnabled?: boolean;
  persistencePath?: string;
  autoSaveInterval?: number;
}

/**
 * Persistence storage interface
 */
export interface SessionPersistenceStorage {
  save(sessions: Map<string, SessionState>, messages: Map<string, SessionMessage[]>): Promise<void>;
  load(): Promise<{ sessions: Map<string, SessionState>; messages: Map<string, SessionMessage[]> }>;
  clear(): Promise<void>;
}

/**
 * File-based persistence storage
 */
export class FilePersistenceStorage implements SessionPersistenceStorage {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(
    sessions: Map<string, SessionState>,
    messages: Map<string, SessionMessage[]>,
  ): Promise<void> {
    const data = {
      sessions: Array.from(sessions.entries()),
      messages: Array.from(messages.entries()),
      savedAt: Date.now(),
    };

    try {
      const fs = await import("node:fs/promises");
      await fs.mkdir(this.filePath.substring(0, this.filePath.lastIndexOf("/")), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(data), "utf-8");
    } catch (error) {
      console.error("Failed to save sessions to file:", error);
    }
  }

  async load(): Promise<{
    sessions: Map<string, SessionState>;
    messages: Map<string, SessionMessage[]>;
  }> {
    try {
      const fs = await import("node:fs/promises");
      const data = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(data);

      return {
        sessions: new Map(parsed.sessions || []),
        messages: new Map(parsed.messages || []),
      };
    } catch {
      return {
        sessions: new Map(),
        messages: new Map(),
      };
    }
  }

  async clear(): Promise<void> {
    try {
      const fs = await import("node:fs/promises");
      await fs.unlink(this.filePath);
    } catch {
      // File doesn't exist, ignore
    }
  }
}

/**
 * Message search options
 */
export interface MessageSearchOptions {
  query?: string;
  role?: "user" | "assistant" | "system";
  startDate?: number;
  endDate?: number;
  limit?: number;
  offset?: number;
}

/**
 * Generate a unique ID using crypto.randomUUID
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Session Manager
 *
 * Manages the lifecycle of office-website sessions with memory integration.
 */
export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private messages: Map<string, SessionMessage[]> = new Map();
  private config: SessionManagerConfig;
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private autoSaveInterval?: ReturnType<typeof setInterval>;
  private memoryIntegration: MemoryIntegration | null = null;
  private persistenceStorage: SessionPersistenceStorage | null = null;
  private isDirty = false;

  constructor(config: SessionManagerConfig) {
    this.config = config;
    this.startCleanupTimer();

    // Initialize persistence if enabled
    if (config.persistenceEnabled && config.persistencePath) {
      this.persistenceStorage = new FilePersistenceStorage(config.persistencePath);
      this.loadFromPersistence().catch((error) => {
        console.error("Failed to load sessions from persistence:", error);
      });

      // Start auto-save timer
      if (config.autoSaveInterval && config.autoSaveInterval > 0) {
        this.autoSaveInterval = setInterval(() => {
          if (this.isDirty) {
            this.saveToPersistence().catch((error) => {
              console.error("Failed to auto-save sessions:", error);
            });
          }
        }, config.autoSaveInterval);
      }
    }
  }

  /**
   * Set memory integration instance
   */
  setMemoryIntegration(memory: MemoryIntegration): void {
    this.memoryIntegration = memory;
  }

  /**
   * Get memory integration instance
   */
  getMemoryIntegration(): MemoryIntegration | null {
    return this.memoryIntegration;
  }

  /**
   * Set persistence storage
   */
  setPersistenceStorage(storage: SessionPersistenceStorage): void {
    this.persistenceStorage = storage;
  }

  /**
   * Load sessions from persistence storage
   */
  private async loadFromPersistence(): Promise<void> {
    if (!this.persistenceStorage) return;

    try {
      const { sessions, messages } = await this.persistenceStorage.load();
      this.sessions = sessions;
      this.messages = messages;
    } catch (error) {
      console.error("Failed to load from persistence:", error);
    }
  }

  /**
   * Save sessions to persistence storage
   */
  async saveToPersistence(): Promise<void> {
    if (!this.persistenceStorage) return;

    try {
      await this.persistenceStorage.save(this.sessions, this.messages);
      this.isDirty = false;
    } catch (error) {
      console.error("Failed to save to persistence:", error);
    }
  }

  /**
   * Mark data as dirty for auto-save
   */
  private markDirty(): void {
    this.isDirty = true;
  }

  // ===========================================================================
  // Session Lifecycle
  // ===========================================================================

  /**
   * Create a new session
   */
  createSession(sessionId?: string): SessionState {
    // Check session limit
    if (this.sessions.size >= this.config.maxSessions) {
      // Remove oldest idle session
      this.removeOldestIdleSession();
    }

    const id = sessionId || generateId("session");
    const now = Date.now();

    const session: SessionState = {
      sessionId: id,
      createdAt: now,
      lastActivityAt: now,
      status: "active",
      permissions: {
        canView: true,
        canAnnotate: false,
        canEdit: false,
      },
      messageCount: 0,
      metadata: {},
      memoryEnabled: this.config.memoryEnabled,
      memoryCount: 0,
    };

    this.sessions.set(id, session);
    this.messages.set(id, []);
    this.markDirty();

    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    // Check if session has expired
    if (this.isSessionExpired(session)) {
      this.destroySession(sessionId);
      return undefined;
    }

    return session;
  }

  /**
   * Update a session
   */
  updateSession(
    sessionId: string,
    updates: Partial<SessionState>,
  ): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const updated = {
      ...session,
      ...updates,
      lastActivityAt: Date.now(),
    };

    this.sessions.set(sessionId, updated);
    this.markDirty();
    return updated;
  }

  /**
   * Destroy a session
   */
  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
    this.markDirty();

    return true;
  }

  /**
   * Destroy all sessions
   */
  destroyAll(): void {
    this.sessions.clear();
    this.messages.clear();
    this.markDirty();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    // Final save before destroying
    if (this.persistenceStorage) {
      this.saveToPersistence().catch((error) => {
        console.error("Failed to save sessions on destroy:", error);
      });
    }
  }

  // ===========================================================================
  // Message Management
  // ===========================================================================

  /**
   * Add a message to a session
   */
  addMessage(
    sessionId: string,
    message: Omit<SessionMessage, "id" | "sessionId" | "timestamp">,
  ): SessionMessage | undefined {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    const fullMessage: SessionMessage = {
      ...message,
      id: generateId("msg"),
      sessionId,
      timestamp: Date.now(),
    };

    const messages = this.messages.get(sessionId) || [];
    messages.push(fullMessage);
    this.messages.set(sessionId, messages);
    this.markDirty();

    // Update session message count
    this.updateSession(sessionId, { messageCount: messages.length });

    // Generate memory if enabled and this is an assistant message
    if (this.memoryIntegration && session.memoryEnabled && message.role === "assistant") {
      this.generateMemoryForSession(sessionId, messages).catch((error) => {
        console.error("Failed to generate memory:", error);
      });
    }

    return fullMessage;
  }

  /**
   * Generate memory for a session based on recent messages
   */
  private async generateMemoryForSession(
    sessionId: string,
    messages: SessionMessage[],
  ): Promise<void> {
    if (!this.memoryIntegration) return;

    try {
      const memory = await this.memoryIntegration.generateMemoryFromSession(sessionId, messages);
      if (memory) {
        const session = this.sessions.get(sessionId);
        if (session) {
          this.updateSession(sessionId, {
            memoryCount: (session.memoryCount || 0) + 1,
            lastMemoryGeneratedAt: Date.now(),
          });
        }
      }
    } catch (error) {
      console.error("Memory generation failed:", error);
    }
  }

  /**
   * Get messages for a session
   */
  getMessages(
    sessionId: string,
    options?: {
      limit?: number;
      offset?: number;
      startDate?: number;
      endDate?: number;
    },
  ): SessionMessage[] {
    let messages = this.messages.get(sessionId) || [];

    // Filter by date range
    if (options?.startDate) {
      messages = messages.filter((m) => m.timestamp >= options.startDate!);
    }
    if (options?.endDate) {
      messages = messages.filter((m) => m.timestamp <= options.endDate!);
    }

    // Apply offset and limit
    const offset = options?.offset || 0;
    const limit = options?.limit || messages.length;

    return messages.slice(offset, offset + limit);
  }

  /**
   * Search messages by content
   */
  searchMessages(
    sessionId: string,
    options: MessageSearchOptions,
  ): SessionMessage[] {
    let messages = this.messages.get(sessionId) || [];

    // Filter by role
    if (options.role) {
      messages = messages.filter((m) => m.role === options.role);
    }

    // Filter by date range
    if (options.startDate) {
      messages = messages.filter((m) => m.timestamp >= options.startDate!);
    }
    if (options.endDate) {
      messages = messages.filter((m) => m.timestamp <= options.endDate!);
    }

    // Filter by query (case-insensitive substring match)
    if (options.query) {
      const queryLower = options.query.toLowerCase();
      messages = messages.filter((m) =>
        m.content.toLowerCase().includes(queryLower)
      );
    }

    // Apply offset and limit
    const offset = options.offset || 0;
    const limit = options.limit || messages.length;

    return messages.slice(offset, offset + limit);
  }

  /**
   * Get message by ID
   */
  getMessage(sessionId: string, messageId: string): SessionMessage | undefined {
    const messages = this.messages.get(sessionId) || [];
    return messages.find((m) => m.id === messageId);
  }

  /**
   * Delete a message
   */
  deleteMessage(sessionId: string, messageId: string): boolean {
    const messages = this.messages.get(sessionId) || [];
    const index = messages.findIndex((m) => m.id === messageId);
    
    if (index === -1) {
      return false;
    }

    messages.splice(index, 1);
    this.messages.set(sessionId, messages);
    this.markDirty();
    this.updateSession(sessionId, { messageCount: messages.length });

    return true;
  }

  /**
   * Clear all messages for a session
   */
  clearMessages(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.messages.set(sessionId, []);
    this.markDirty();
    this.updateSession(sessionId, { messageCount: 0 });

    return true;
  }

  // ===========================================================================
  // Document Context Management
  // ===========================================================================

  /**
   * Update document context for a session
   */
  updateDocumentContext(
    sessionId: string,
    documentContext: DocumentContext,
  ): SessionState | undefined {
    return this.updateSession(sessionId, {
      documentContext,
      permissions: documentContext.permissions,
    });
  }

  /**
   * Get document context for a session
   */
  getDocumentContext(sessionId: string): DocumentContext | undefined {
    const session = this.getSession(sessionId);
    return session?.documentContext;
  }

  // ===========================================================================
  // Session Listing and Cleanup
  // ===========================================================================

  /**
   * List all active sessions
   */
  listActiveSessions(): SessionState[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === "active" && !this.isSessionExpired(s),
    );
  }

  /**
   * List all sessions
   */
  listAllSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get total message count across all sessions
   */
  getTotalMessageCount(): number {
    let total = 0;
    for (const messages of this.messages.values()) {
      total += messages.length;
    }
    return total;
  }

  /**
   * Clean up expired sessions
   */
  cleanup(): number {
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (this.isSessionExpired(session)) {
        this.destroySession(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Check if a session is expired
   */
  private isSessionExpired(session: SessionState): boolean {
    const now = Date.now();
    return now - session.lastActivityAt > this.config.sessionTimeout;
  }

  /**
   * Remove the oldest idle session
   */
  private removeOldestIdleSession(): void {
    let oldest: SessionState | undefined;
    for (const session of this.sessions.values()) {
      if (session.status === "idle") {
        if (!oldest || session.lastActivityAt < oldest.lastActivityAt) {
          oldest = session;
        }
      }
    }

    if (oldest) {
      this.destroySession(oldest.sessionId);
    }
  }

  /**
   * Start the cleanup timer
   */
  private startCleanupTimer(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }
}

// Re-export for backward compatibility
export type { DocumentContext };
