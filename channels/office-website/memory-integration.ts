/**
 * Office-Website Channel Memory Integration
 *
 * Integrates OpenClaw Memory Manager for session-based memory storage
 * and retrieval. Supports both short-term and long-term memory.
 *
 * @module channels/office-website/memory-integration
 */

import type { OpenClawConfig } from "../../config/config.js";
import type { MemorySearchResult } from "../../memory/types.js";
import type { SessionMessage, SessionState } from "./session.js";
import type { DocumentContext } from "./api.js";

/**
 * Memory integration configuration
 */
export interface MemoryIntegrationConfig {
  enabled: boolean;
  provider: "openai" | "local" | "gemini" | "voyage" | "mistral" | "ollama" | "auto";
  embeddingModel: string;
  maxMemoriesPerSession: number;
  memoryRetentionDays: number;
  autoGenerateMemory: boolean;
}

/**
 * Memory entry structure
 */
export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  embedding?: number[];
  metadata: {
    role: "user" | "assistant" | "system";
    timestamp: number;
    documentContext?: DocumentContext;
    keywords?: string[];
    importance?: number;
  };
  createdAt: number;
  updatedAt: number;
}

/**
 * Memory search options
 */
export interface MemorySearchOptions {
  query: string;
  sessionId?: string;
  limit?: number;
  minScore?: number;
  includeDocumentContext?: boolean;
  timeRange?: {
    start: number;
    end: number;
  };
}

/**
 * Memory search result
 */
export interface MemorySearchResultItem {
  id: string;
  sessionId: string;
  content: string;
  score: number;
  metadata: MemoryEntry["metadata"];
  snippet: string;
}

/**
 * Memory Manager Integration for Office-Website Channel
 *
 * Provides memory storage, retrieval, and management capabilities
 * for the office-website channel sessions.
 */
export class MemoryIntegration {
  private config: MemoryIntegrationConfig;
  private cfg: OpenClawConfig;
  private memories: Map<string, MemoryEntry[]> = new Map();
  private sessionMemories: Map<string, string[]> = new Map();
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(cfg: OpenClawConfig, config: MemoryIntegrationConfig) {
    this.cfg = cfg;
    this.config = config;
  }

  /**
   * Generate a unique ID for memory entries
   */
  private generateId(): string {
    return `mem-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  }

  /**
   * Store a memory entry
   *
   * Creates a new memory from a session message or explicit content.
   */
  async remember(params: {
    sessionId: string;
    content: string;
    role: "user" | "assistant" | "system";
    documentContext?: DocumentContext;
    importance?: number;
  }): Promise<MemoryEntry> {
    const { sessionId, content, role, documentContext, importance } = params;

    // Extract keywords for better retrieval
    const keywords = this.extractKeywords(content);

    // Create memory entry
    const entry: MemoryEntry = {
      id: this.generateId(),
      sessionId,
      content,
      metadata: {
        role,
        timestamp: Date.now(),
        documentContext,
        keywords,
        importance: importance ?? this.calculateImportance(content, role),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Generate embedding if enabled
    if (this.config.enabled) {
      try {
        entry.embedding = await this.generateEmbedding(content);
      } catch (error) {
        console.error("Failed to generate embedding:", error);
      }
    }

    // Store in memory map
    if (!this.memories.has(sessionId)) {
      this.memories.set(sessionId, []);
    }
    const sessionMemories = this.memories.get(sessionId)!;

    // Check memory limit
    if (sessionMemories.length >= this.config.maxMemoriesPerSession) {
      // Remove oldest low-importance memory
      const sortedMemories = sessionMemories.sort(
        (a, b) => (a.metadata.importance ?? 0) - (b.metadata.importance ?? 0),
      );
      const removed = sortedMemories.shift();
      if (removed) {
        this.embeddingCache.delete(removed.id);
      }
    }

    sessionMemories.push(entry);
    this.memories.set(sessionId, sessionMemories);

    // Update session memory index
    if (!this.sessionMemories.has(sessionId)) {
      this.sessionMemories.set(sessionId, []);
    }
    this.sessionMemories.get(sessionId)!.push(entry.id);

    return entry;
  }

  /**
   * Recall memories based on query
   *
   * Performs semantic search over stored memories.
   */
  async recall(options: MemorySearchOptions): Promise<MemorySearchResultItem[]> {
    const { query, sessionId, limit = 10, minScore = 0.5, includeDocumentContext, timeRange } = options;

    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);

    // Collect candidate memories
    let candidates: MemoryEntry[] = [];

    if (sessionId) {
      // Search within specific session
      candidates = this.memories.get(sessionId) || [];
    } else {
      // Search across all sessions
      for (const memories of this.memories.values()) {
        candidates.push(...memories);
      }
    }

    // Filter by time range if specified
    if (timeRange) {
      candidates = candidates.filter(
        (m) => m.metadata.timestamp >= timeRange.start && m.metadata.timestamp <= timeRange.end,
      );
    }

    // Filter by document context if specified
    if (includeDocumentContext) {
      candidates = candidates.filter((m) => m.metadata.documentContext !== undefined);
    }

    // Calculate similarity scores
    const results: MemorySearchResultItem[] = candidates
      .map((entry) => {
        const score = entry.embedding
          ? this.cosineSimilarity(queryEmbedding, entry.embedding)
          : this.keywordMatchScore(query, entry.metadata.keywords || []);

        return {
          id: entry.id,
          sessionId: entry.sessionId,
          content: entry.content,
          score,
          metadata: entry.metadata,
          snippet: this.generateSnippet(entry.content, query),
        };
      })
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  /**
   * Get all memories for a session
   */
  getSessionMemories(sessionId: string): MemoryEntry[] {
    return this.memories.get(sessionId) || [];
  }

  /**
   * Clear memories for a session
   */
  clearSessionMemories(sessionId: string): boolean {
    const memories = this.memories.get(sessionId);
    if (memories) {
      // Clear embedding cache
      for (const memory of memories) {
        this.embeddingCache.delete(memory.id);
      }
      this.memories.delete(sessionId);
      this.sessionMemories.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Generate memory from session messages
   *
   * Automatically extracts important information from conversation history.
   */
  async generateMemoryFromSession(
    sessionId: string,
    messages: SessionMessage[],
  ): Promise<MemoryEntry | null> {
    if (!this.config.autoGenerateMemory || messages.length === 0) {
      return null;
    }

    // Get the last few messages for context
    const recentMessages = messages.slice(-5);

    // Extract key information
    const summary = this.summarizeMessages(recentMessages);

    // Create memory entry
    return this.remember({
      sessionId,
      content: summary,
      role: "system",
      importance: 0.8,
    });
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    totalMemories: number;
    sessionsWithMemory: number;
    averageMemoriesPerSession: number;
    embeddingCacheSize: number;
  } {
    let totalMemories = 0;
    for (const memories of this.memories.values()) {
      totalMemories += memories.length;
    }

    return {
      totalMemories,
      sessionsWithMemory: this.memories.size,
      averageMemoriesPerSession: this.memories.size > 0 ? totalMemories / this.memories.size : 0,
      embeddingCacheSize: this.embeddingCache.size,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate embedding for text
   *
   * In production, this would call the actual embedding provider.
   * For now, we use a simple hash-based approach for testing.
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Check cache first
    const cacheKey = text.slice(0, 100);
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!;
    }

    // Simple embedding generation (placeholder)
    // In production, this would use the configured embedding provider
    const embedding: number[] = [];
    const normalized = text.toLowerCase().trim();

    // Create a simple embedding based on character frequencies
    for (let i = 0; i < 128; i++) {
      let sum = 0;
      for (let j = 0; j < normalized.length; j++) {
        sum += normalized.charCodeAt(j) * (i + 1) * (j + 1);
      }
      embedding.push(Math.sin(sum) * 0.5 + 0.5);
    }

    // Normalize embedding
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    const normalizedEmbedding = embedding.map((val) => val / magnitude);

    // Cache the embedding
    this.embeddingCache.set(cacheKey, normalizedEmbedding);

    return normalizedEmbedding;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) return 0;

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Calculate keyword match score
   */
  private keywordMatchScore(query: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;

    const queryWords = query.toLowerCase().split(/\s+/);
    const matchCount = keywords.filter((k) =>
      queryWords.some((w) => w.includes(k.toLowerCase()) || k.toLowerCase().includes(w)),
    ).length;

    return matchCount / keywords.length;
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    // Simple keyword extraction
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "must",
      "shall",
      "can",
      "need",
      "dare",
      "ought",
      "used",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "as",
      "into",
      "through",
      "during",
      "before",
      "after",
      "above",
      "below",
      "between",
      "under",
      "again",
      "further",
      "then",
      "once",
      "here",
      "there",
      "when",
      "where",
      "why",
      "how",
      "all",
      "each",
      "few",
      "more",
      "most",
      "other",
      "some",
      "such",
      "no",
      "nor",
      "not",
      "only",
      "own",
      "same",
      "so",
      "than",
      "too",
      "very",
      "just",
      "and",
      "but",
      "if",
      "or",
      "because",
      "until",
      "while",
      "although",
      "though",
      "this",
      "that",
      "these",
      "those",
      "i",
      "you",
      "he",
      "she",
      "it",
      "we",
      "they",
      "what",
      "which",
      "who",
      "whom",
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));

    // Count word frequencies
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    // Return top keywords by frequency
    return Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Calculate importance score for a message
   */
  private calculateImportance(content: string, role: "user" | "assistant" | "system"): number {
    let importance = 0.5;

    // User questions are more important
    if (role === "user") {
      importance += 0.2;
      if (content.includes("?")) {
        importance += 0.1;
      }
    }

    // Longer messages might be more important
    if (content.length > 200) {
      importance += 0.1;
    }

    // Messages with specific keywords are more important
    const importantKeywords = ["important", "remember", "note", "key", "critical", "essential"];
    if (importantKeywords.some((k) => content.toLowerCase().includes(k))) {
      importance += 0.2;
    }

    return Math.min(importance, 1.0);
  }

  /**
   * Generate snippet from content
   */
  private generateSnippet(content: string, query: string): string {
    const maxLength = 200;
    const queryWords = query.toLowerCase().split(/\s+/);

    // Find the best position to start the snippet
    let bestPos = 0;
    let bestScore = 0;

    for (let i = 0; i < content.length - maxLength; i += 50) {
      const snippet = content.slice(i, i + maxLength).toLowerCase();
      const score = queryWords.reduce((sum, word) => sum + (snippet.includes(word) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestPos = i;
      }
    }

    let snippet = content.slice(bestPos, bestPos + maxLength);

    // Add ellipsis if truncated
    if (bestPos > 0) {
      snippet = "..." + snippet;
    }
    if (bestPos + maxLength < content.length) {
      snippet = snippet + "...";
    }

    return snippet;
  }

  /**
   * Summarize messages for memory generation
   */
  private summarizeMessages(messages: SessionMessage[]): string {
    // Simple summarization - extract key points
    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
    const assistantMessages = messages.filter((m) => m.role === "assistant").map((m) => m.content);

    const parts: string[] = [];

    if (userMessages.length > 0) {
      parts.push(`User asked: ${userMessages.join("; ")}`);
    }

    if (assistantMessages.length > 0) {
      parts.push(`Assistant responded: ${assistantMessages.join("; ")}`);
    }

    return parts.join(". ");
  }
}

/**
 * Create memory integration instance
 */
export function createMemoryIntegration(
  cfg: OpenClawConfig,
  config: Partial<MemoryIntegrationConfig> = {},
): MemoryIntegration {
  const defaultConfig: MemoryIntegrationConfig = {
    enabled: true,
    provider: "openai",
    embeddingModel: "text-embedding-3-small",
    maxMemoriesPerSession: 100,
    memoryRetentionDays: 30,
    autoGenerateMemory: true,
    ...config,
  };

  return new MemoryIntegration(cfg, defaultConfig);
}
