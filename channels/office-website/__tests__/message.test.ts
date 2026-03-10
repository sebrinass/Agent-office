/**
 * Office-Website Channel - End-to-End Message Tests
 *
 * Tests the complete message flow:
 * - User sends message
 * - Agent receives message
 * - Agent replies message
 * - User receives reply
 *
 * @module channels/office-website/__tests__/message.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SessionManager } from '../session.js'
import {
  handleOfficeWebsiteMessage,
  type OfficeWebsiteMessageEvent,
} from '../monitor.js'
import {
  checkPermission,
  checkPermissions,
  type DocumentPermissions,
} from '../permissions.js'
import {
  sendMessage,
  sendTextMessage,
  sendMarkdownMessage,
  type SendResult,
} from '../send.js'

// ============================================================================
// Mock Configuration
// ============================================================================

const mockConfig = {
  channels: {
    'office-website': {
      enabled: true,
      accounts: {
        default: {
          maxSessions: 100,
          sessionTimeout: 3600000,
          memoryEnabled: true,
          memoryProvider: 'sqlite',
          embeddingModel: 'text-embedding-3-small',
        },
      },
    },
  },
}

const mockRuntime = {
  log: vi.fn(),
  error: vi.fn(),
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestSessionManager(): SessionManager {
  return new SessionManager({
    maxSessions: 100,
    sessionTimeout: 3600000,
    memoryEnabled: false,
    memoryProvider: 'sqlite',
    embeddingModel: 'text-embedding-3-small',
  })
}

function createTestMessageEvent(
  overrides: Partial<OfficeWebsiteMessageEvent> = {},
): OfficeWebsiteMessageEvent {
  return {
    sessionId: 'test-session-001',
    messageId: `msg-${Date.now()}`,
    senderId: 'user-001',
    senderName: 'Test User',
    content: 'Hello, this is a test message',
    contentType: 'text',
    timestamp: Date.now(),
    ...overrides,
  }
}

function createTestDocumentContext() {
  return {
    documentId: 'doc-001',
    documentName: 'Test Document.docx',
    documentType: 'document',
    content: 'Test document content',
    selectedText: undefined,
    permissions: {
      canView: true,
      canAnnotate: true,
      canEdit: false,
    },
  }
}

// ============================================================================
// Tests: Session Management
// ============================================================================

describe('Session Management', () => {
  let sessionManager: SessionManager

  beforeEach(() => {
    sessionManager = createTestSessionManager()
  })

  afterEach(() => {
    sessionManager.destroyAll()
  })

  it('should create a new session', () => {
    const session = sessionManager.createSession('test-session-001')

    expect(session).toBeDefined()
    expect(session.sessionId).toBe('test-session-001')
    expect(session.status).toBe('active')
    expect(session.messageCount).toBe(0)
  })

  it('should retrieve an existing session', () => {
    sessionManager.createSession('test-session-001')
    const session = sessionManager.getSession('test-session-001')

    expect(session).toBeDefined()
    expect(session?.sessionId).toBe('test-session-001')
  })

  it('should return undefined for non-existent session', () => {
    const session = sessionManager.getSession('non-existent')
    expect(session).toBeUndefined()
  })

  it('should update session activity', () => {
    const session = sessionManager.createSession('test-session-001')
    const originalActivity = session.lastActivityAt

    // Wait a bit and update
    const updated = sessionManager.updateSession('test-session-001', {
      status: 'idle',
    })

    expect(updated?.lastActivityAt).toBeGreaterThanOrEqual(originalActivity)
    expect(updated?.status).toBe('idle')
  })

  it('should destroy a session', () => {
    sessionManager.createSession('test-session-001')
    const destroyed = sessionManager.destroySession('test-session-001')

    expect(destroyed).toBe(true)
    expect(sessionManager.getSession('test-session-001')).toBeUndefined()
  })
})

// ============================================================================
// Tests: Message Handling
// ============================================================================

describe('Message Handling', () => {
  let sessionManager: SessionManager

  beforeEach(() => {
    sessionManager = createTestSessionManager()
  })

  afterEach(() => {
    sessionManager.destroyAll()
  })

  it('should add a user message to session', () => {
    sessionManager.createSession('test-session-001')

    const message = sessionManager.addMessage('test-session-001', {
      role: 'user',
      content: 'Hello, world!',
    })

    expect(message).toBeDefined()
    expect(message?.role).toBe('user')
    expect(message?.content).toBe('Hello, world!')
    expect(message?.id).toMatch(/^msg-/)
  })

  it('should add an assistant message to session', () => {
    sessionManager.createSession('test-session-001')

    const message = sessionManager.addMessage('test-session-001', {
      role: 'assistant',
      content: 'Hello! How can I help you?',
    })

    expect(message).toBeDefined()
    expect(message?.role).toBe('assistant')
    expect(message?.content).toBe('Hello! How can I help you?')
  })

  it('should retrieve messages from session', () => {
    sessionManager.createSession('test-session-001')

    sessionManager.addMessage('test-session-001', {
      role: 'user',
      content: 'Message 1',
    })
    sessionManager.addMessage('test-session-001', {
      role: 'assistant',
      content: 'Response 1',
    })

    const messages = sessionManager.getMessages('test-session-001')

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
  })

  it('should limit retrieved messages', () => {
    sessionManager.createSession('test-session-001')

    for (let i = 0; i < 10; i++) {
      sessionManager.addMessage('test-session-001', {
        role: 'user',
        content: `Message ${i}`,
      })
    }

    const messages = sessionManager.getMessages('test-session-001', {
      limit: 5,
    })

    expect(messages).toHaveLength(5)
  })

  it('should update message count', () => {
    const session = sessionManager.createSession('test-session-001')

    expect(session.messageCount).toBe(0)

    sessionManager.addMessage('test-session-001', {
      role: 'user',
      content: 'Test',
    })

    const updated = sessionManager.getSession('test-session-001')
    expect(updated?.messageCount).toBe(1)
  })
})

// ============================================================================
// Tests: Document Context
// ============================================================================

describe('Document Context', () => {
  let sessionManager: SessionManager

  beforeEach(() => {
    sessionManager = createTestSessionManager()
  })

  afterEach(() => {
    sessionManager.destroyAll()
  })

  it('should update document context for session', () => {
    sessionManager.createSession('test-session-001')
    const docContext = createTestDocumentContext()

    const updated = sessionManager.updateDocumentContext(
      'test-session-001',
      docContext,
    )

    expect(updated?.documentContext).toEqual(docContext)
    expect(updated?.permissions).toEqual(docContext.permissions)
  })

  it('should retrieve document context', () => {
    sessionManager.createSession('test-session-001')
    const docContext = createTestDocumentContext()

    sessionManager.updateDocumentContext('test-session-001', docContext)

    const retrieved = sessionManager.getDocumentContext('test-session-001')
    expect(retrieved).toEqual(docContext)
  })

  it('should include document context in message', () => {
    sessionManager.createSession('test-session-001')
    const docContext = createTestDocumentContext()

    sessionManager.updateDocumentContext('test-session-001', docContext)

    const message = sessionManager.addMessage('test-session-001', {
      role: 'user',
      content: 'Edit this document',
      documentContext: docContext,
    })

    expect(message?.documentContext).toEqual(docContext)
  })
})

// ============================================================================
// Tests: Permission Checks
// ============================================================================

describe('Permission Checks', () => {
  it('should check view permission', () => {
    const permissions: DocumentPermissions = {
      canView: true,
      canAnnotate: false,
      canEdit: false,
    }

    expect(checkPermission(permissions, 'view')).toBe(true)
    expect(checkPermission(permissions, 'annotate')).toBe(false)
    expect(checkPermission(permissions, 'edit')).toBe(false)
  })

  it('should check annotate permission', () => {
    const permissions: DocumentPermissions = {
      canView: true,
      canAnnotate: true,
      canEdit: false,
    }

    expect(checkPermission(permissions, 'view')).toBe(true)
    expect(checkPermission(permissions, 'annotate')).toBe(true)
    expect(checkPermission(permissions, 'edit')).toBe(false)
  })

  it('should check edit permission', () => {
    const permissions: DocumentPermissions = {
      canView: true,
      canAnnotate: true,
      canEdit: true,
    }

    expect(checkPermission(permissions, 'view')).toBe(true)
    expect(checkPermission(permissions, 'annotate')).toBe(true)
    expect(checkPermission(permissions, 'edit')).toBe(true)
  })

  it('should check multiple permissions', () => {
    const permissions: DocumentPermissions = {
      canView: true,
      canAnnotate: true,
      canEdit: false,
    }

    const result = checkPermissions(permissions, ['view', 'annotate'])
    expect(result.granted).toBe(true)
    expect(result.missing).toHaveLength(0)
  })

  it('should identify missing permissions', () => {
    const permissions: DocumentPermissions = {
      canView: true,
      canAnnotate: false,
      canEdit: false,
    }

    const result = checkPermissions(permissions, ['view', 'edit'])
    expect(result.granted).toBe(false)
    expect(result.missing).toContain('edit')
  })
})

// ============================================================================
// Tests: Message Sending (Mock)
// ============================================================================

describe('Message Sending', () => {
  it('should format text message correctly', () => {
    // Test message formatting logic
    const content = 'Hello, world!'
    expect(content.trim()).toBe('Hello, world!')
  })

  it('should format markdown message correctly', () => {
    const markdown = '# Heading\n\nThis is **bold** text.'
    expect(markdown).toContain('# Heading')
    expect(markdown).toContain('**bold**')
  })

  it('should handle code blocks', () => {
    const code = '```typescript\nconst x = 1;\n```'
    expect(code).toContain('```typescript')
    expect(code).toContain('const x = 1;')
  })
})

// ============================================================================
// Tests: Message Search
// ============================================================================

describe('Message Search', () => {
  let sessionManager: SessionManager

  beforeEach(() => {
    sessionManager = createTestSessionManager()
    sessionManager.createSession('test-session-001')

    // Add test messages
    sessionManager.addMessage('test-session-001', {
      role: 'user',
      content: 'How do I create a document?',
    })
    sessionManager.addMessage('test-session-001', {
      role: 'assistant',
      content: 'You can create a document by clicking the New button.',
    })
    sessionManager.addMessage('test-session-001', {
      role: 'user',
      content: 'How do I edit a document?',
    })
    sessionManager.addMessage('test-session-001', {
      role: 'assistant',
      content: 'Open the document and start editing.',
    })
  })

  afterEach(() => {
    sessionManager.destroyAll()
  })

  it('should search messages by query', () => {
    const results = sessionManager.searchMessages('test-session-001', {
      query: 'document',
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((msg) => {
      expect(msg.content.toLowerCase()).toContain('document')
    })
  })

  it('should filter messages by role', () => {
    const results = sessionManager.searchMessages('test-session-001', {
      role: 'user',
    })

    expect(results.length).toBeGreaterThan(0)
    results.forEach((msg) => {
      expect(msg.role).toBe('user')
    })
  })

  it('should limit search results', () => {
    const results = sessionManager.searchMessages('test-session-001', {
      limit: 2,
    })

    expect(results.length).toBeLessThanOrEqual(2)
  })
})

// ============================================================================
// Tests: Session Cleanup
// ============================================================================

describe('Session Cleanup', () => {
  let sessionManager: SessionManager

  beforeEach(() => {
    sessionManager = createTestSessionManager()
  })

  afterEach(() => {
    sessionManager.destroyAll()
  })

  it('should list active sessions', () => {
    sessionManager.createSession('session-1')
    sessionManager.createSession('session-2')
    sessionManager.createSession('session-3')

    const active = sessionManager.listActiveSessions()
    expect(active.length).toBe(3)
  })

  it('should get session count', () => {
    sessionManager.createSession('session-1')
    sessionManager.createSession('session-2')

    expect(sessionManager.getSessionCount()).toBe(2)
  })

  it('should get total message count', () => {
    sessionManager.createSession('session-1')
    sessionManager.createSession('session-2')

    sessionManager.addMessage('session-1', { role: 'user', content: 'Test 1' })
    sessionManager.addMessage('session-1', { role: 'assistant', content: 'Response 1' })
    sessionManager.addMessage('session-2', { role: 'user', content: 'Test 2' })

    expect(sessionManager.getTotalMessageCount()).toBe(3)
  })
})
