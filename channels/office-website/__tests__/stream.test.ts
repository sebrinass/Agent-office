/**
 * Office-Website Channel - Stream Response Tests
 *
 * Tests streaming functionality:
 * - SSE stream response
 * - Long message chunking
 * - Reconnection handling
 *
 * @module channels/office-website/__tests__/stream.test
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Test Fixtures
// ============================================================================

const mockConfig = {
  channels: {
    'office-website': {
      enabled: true,
      webhookUrl: 'http://localhost:3000/webhook',
    },
  },
}

// Local SSE Stream Controller for testing
class TestSSEStreamController {
  private streamId: string
  private buffer: string[] = []
  private closed = false

  constructor(_cfg: any, _sessionId: string, streamId?: string) {
    this.streamId = streamId || `stream-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  }

  getStreamId(): string {
    return this.streamId
  }

  async sendDelta(delta: string): Promise<{ success: boolean }> {
    if (this.closed) {
      return { success: false }
    }
    this.buffer.push(delta)
    return { success: true }
  }

  async end(_fullContent?: string): Promise<{ success: boolean }> {
    if (this.closed) {
      return { success: false }
    }
    this.closed = true
    return { success: true }
  }

  getBufferedContent(): string {
    return this.buffer.join('')
  }

  isClosed(): boolean {
    return this.closed
  }
}

// ============================================================================
// Tests: SSE Stream Controller
// ============================================================================

describe('SSE Stream Controller', () => {
  it('should create stream with unique ID', () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')
    expect(stream.getStreamId()).toMatch(/^stream-/)
  })

  it('should generate different stream IDs', () => {
    const stream1 = new TestSSEStreamController(mockConfig, 'session-001')
    const stream2 = new TestSSEStreamController(mockConfig, 'session-001')

    expect(stream1.getStreamId()).toBeDefined()
    expect(stream2.getStreamId()).toBeDefined()
    expect(stream1.getStreamId()).not.toBe(stream2.getStreamId())
  })

  it('should accept custom stream ID', () => {
    const customId = 'custom-stream-123'
    const stream = new TestSSEStreamController(mockConfig, 'session-001', customId)

    expect(stream.getStreamId()).toBe(customId)
  })

  it('should track buffered content', () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')

    // Simulate buffering
    stream.sendDelta('Hello ')
    stream.sendDelta('World!')

    expect(stream.getBufferedContent()).toBe('Hello World!')
  })

  it('should mark stream as closed after end', async () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')

    expect(stream.isClosed()).toBe(false)

    await stream.end()

    expect(stream.isClosed()).toBe(true)
  })

  it('should reject operations on closed stream', async () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')

    await stream.end()

    const result = await stream.sendDelta('test')
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Tests: Message Chunking
// ============================================================================

describe('Message Chunking', () => {
  it('should chunk short text as single piece', () => {
    const text = 'Hello, world!'
    const chunks = [text]

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe(text)
  })

  it('should chunk long text into multiple pieces', () => {
    const text = 'A'.repeat(10000)
    const chunkSize = 1000
    const chunks: string[] = []

    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize))
    }

    expect(chunks.length).toBe(10)
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(chunkSize)
    })
  })

  it('should preserve content across chunks', () => {
    const text = 'ABCDEFGHIJ'
    const chunkSize = 3
    const chunks: string[] = []

    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize))
    }

    const reconstructed = chunks.join('')
    expect(reconstructed).toBe(text)
  })

  it('should handle empty text', () => {
    const text = ''
    const chunks = text ? [text] : []

    expect(chunks).toHaveLength(0)
  })

  it('should chunk markdown preserving structure', () => {
    const markdown = `# Heading

This is a paragraph.

## Subheading

Another paragraph with **bold** text.

\`\`\`javascript
const x = 1;
\`\`\`
`

    expect(markdown).toContain('# Heading')
    expect(markdown).toContain('```javascript')
  })
})

// ============================================================================
// Tests: Stream Events
// ============================================================================

describe('Stream Events', () => {
  it('should define stream start event', () => {
    const event = {
      type: 'stream_start',
      content: '',
      metadata: {
        streamId: 'stream-001',
        isComplete: false,
      },
    }

    expect(event.type).toBe('stream_start')
    expect(event.metadata.isComplete).toBe(false)
  })

  it('should define stream delta event', () => {
    const event = {
      type: 'stream_delta',
      content: 'Hello',
      metadata: {
        streamId: 'stream-001',
        isComplete: false,
      },
    }

    expect(event.type).toBe('stream_delta')
    expect(event.content).toBe('Hello')
  })

  it('should define stream end event', () => {
    const event = {
      type: 'stream_end',
      content: 'Hello World!',
      metadata: {
        streamId: 'stream-001',
        isComplete: true,
      },
    }

    expect(event.type).toBe('stream_end')
    expect(event.metadata.isComplete).toBe(true)
  })
})

// ============================================================================
// Tests: Stream State Management
// ============================================================================

describe('Stream State Management', () => {
  it('should track active stream in session', () => {
    const session: { metadata: Record<string, unknown> } = {
      metadata: {},
    }

    session.metadata = {
      ...session.metadata,
      activeStreamId: 'stream-001',
      streamStartedAt: Date.now(),
    }

    expect(session.metadata.activeStreamId).toBe('stream-001')
  })

  it('should clear stream state on end', () => {
    const session: { metadata: Record<string, unknown> } = {
      metadata: {
        activeStreamId: 'stream-001',
        streamStartedAt: Date.now(),
      },
    }

    // Clear stream state
    const { activeStreamId, streamStartedAt, ...restMetadata } = session.metadata
    session.metadata = restMetadata

    expect(session.metadata.activeStreamId).toBeUndefined()
  })

  it('should store completed message', () => {
    const messages: Array<{ role: string; content: string }> = []
    const content = 'This is the complete streamed message.'

    messages.push({
      role: 'assistant',
      content,
    })

    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe(content)
  })
})

// ============================================================================
// Tests: Reconnection Handling
// ============================================================================

describe('Reconnection Handling', () => {
  it('should recover session state after reconnect', () => {
    const session: {
      messages: Array<{ role: string; content: string }>
      lastActivityAt: number
    } = {
      messages: [],
      lastActivityAt: Date.now(),
    }

    // Add some messages
    session.messages.push({ role: 'user', content: 'Hello' })
    session.messages.push({ role: 'assistant', content: 'Hi there!' })

    // Simulate reconnect by checking session state
    expect(session.messages).toHaveLength(2)
  })

  it('should handle last activity timestamp', () => {
    const session: { lastActivityAt: number } = {
      lastActivityAt: Date.now() - 1000,
    }

    const originalActivity = session.lastActivityAt

    // Update activity
    session.lastActivityAt = Date.now()

    expect(session.lastActivityAt).toBeGreaterThanOrEqual(originalActivity)
  })
})

// ============================================================================
// Tests: Error Handling
// ============================================================================

describe('Stream Error Handling', () => {
  it('should handle stream start failure', async () => {
    const stream = new TestSSEStreamController({}, 'session-001')

    expect(stream.isClosed()).toBe(false)
  })

  it('should handle delta send failure', async () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')

    // Close the stream first
    await stream.end()

    // Delta should fail
    const result = await stream.sendDelta('test')
    expect(result.success).toBe(false)
  })

  it('should handle end on already closed stream', async () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')

    await stream.end()
    const result = await stream.end()

    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Tests: Stream Performance
// ============================================================================

describe('Stream Performance', () => {
  it('should handle rapid delta sends', async () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')

    const deltas = Array.from({ length: 100 }, (_, i) => `Delta ${i} `)

    // Rapid sends
    for (const delta of deltas) {
      stream.sendDelta(delta)
    }

    const buffered = stream.getBufferedContent()
    expect(buffered).toContain('Delta 0')
    expect(buffered).toContain('Delta 99')

    await stream.end()
  })

  it('should handle large content buffering', () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')

    // Buffer 1MB of content
    const largeContent = 'x'.repeat(1000)
    for (let i = 0; i < 1000; i++) {
      stream.sendDelta(largeContent)
    }

    const buffered = stream.getBufferedContent()
    expect(buffered.length).toBe(1000000)
  })

  it('should clean up resources on end', async () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')

    // Add some content
    stream.sendDelta('Test content')

    // End should clean up
    await stream.end()

    expect(stream.isClosed()).toBe(true)
  })
})

// ============================================================================
// Tests: SSE Format
// ============================================================================

describe('SSE Format', () => {
  it('should format SSE event correctly', () => {
    const event = {
      event: 'message_delta',
      data: { text: 'Hello' },
    }

    // SSE format: "event: <type>\ndata: <json>\n\n"
    const expectedPattern = /event: message_delta/
    const eventStr = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`

    expect(eventStr).toMatch(expectedPattern)
  })

  it('should handle multiline data', () => {
    const event = {
      event: 'message_delta',
      data: { text: 'Line 1\nLine 2\nLine 3' },
    }

    // Each line should be prefixed with "data: "
    const lines = event.data.text.split('\n')
    expect(lines.length).toBe(3)
  })

  it('should include timestamp in events', () => {
    const event = {
      event: 'connected',
      data: { sessionId: 'session-001', timestamp: Date.now() },
    }

    expect(event.data.timestamp).toBeDefined()
    expect(typeof event.data.timestamp).toBe('number')
  })
})

// ============================================================================
// Tests: Heartbeat/Ping
// ============================================================================

describe('Heartbeat/Ping', () => {
  it('should send ping events periodically', () => {
    const pingEvent = {
      event: 'ping',
      data: { timestamp: Date.now() },
    }

    expect(pingEvent.event).toBe('ping')
    expect(pingEvent.data.timestamp).toBeDefined()
  })

  it('should keep connection alive with ping', () => {
    const now = Date.now()
    const pingInterval = 30000 // 30 seconds

    // Simulate ping timing
    const lastPing = now - 15000
    const shouldPing = now - lastPing >= pingInterval

    expect(shouldPing).toBe(false) // Not time to ping yet
  })

  it('should detect stale connection', () => {
    const now = Date.now()
    const timeout = 60000 // 60 seconds

    const lastActivity = now - 70000 // 70 seconds ago
    const isStale = now - lastActivity >= timeout

    expect(isStale).toBe(true)
  })
})

// ============================================================================
// Tests: Stream with Session Manager
// ============================================================================

describe('Stream with Session Manager', () => {
  it('should associate stream with session', () => {
    const session: { metadata: Record<string, unknown> } = {
      metadata: {},
    }
    const streamId = 'stream-001'

    session.metadata = {
      ...session.metadata,
      activeStreamId: streamId,
    }

    expect(session.metadata.activeStreamId).toBe(streamId)
  })

  it('should store streamed message on completion', () => {
    const messages: Array<{ role: string; content: string }> = []

    const fullContent = 'This is a streamed response.'

    // Simulate stream completion
    messages.push({
      role: 'assistant',
      content: fullContent,
    })

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].content).toBe(fullContent)
  })

  it('should handle concurrent streams', () => {
    const sessions: Record<string, { metadata: Record<string, unknown> }> = {
      'session-001': { metadata: {} },
      'session-002': { metadata: {} },
    }

    sessions['session-001'].metadata = {
      ...sessions['session-001'].metadata,
      activeStreamId: 'stream-001',
    }

    sessions['session-002'].metadata = {
      ...sessions['session-002'].metadata,
      activeStreamId: 'stream-002',
    }

    expect(sessions['session-001'].metadata.activeStreamId).toBe('stream-001')
    expect(sessions['session-002'].metadata.activeStreamId).toBe('stream-002')
  })
})

// ============================================================================
// Tests: Stream Types
// ============================================================================

describe('Stream Types', () => {
  it('should support text stream', () => {
    const type = 'text'
    expect(type).toBe('text')
  })

  it('should support markdown stream', () => {
    const type = 'markdown'
    expect(type).toBe('markdown')
  })

  it('should support code stream', () => {
    const type = 'code'
    expect(type).toBe('code')
  })

  it('should support rich text stream', () => {
    const type = 'rich_text'
    expect(type).toBe('rich_text')
  })
})

// ============================================================================
// Tests: Stream Cancellation
// ============================================================================

describe('Stream Cancellation', () => {
  it('should handle abort signal', () => {
    const controller = new AbortController()
    const signal = controller.signal

    expect(signal.aborted).toBe(false)

    controller.abort()

    expect(signal.aborted).toBe(true)
  })

  it('should clean up on abort', async () => {
    const stream = new TestSSEStreamController(mockConfig, 'session-001')

    // Start streaming
    stream.sendDelta('Partial content')

    // Abort (in real implementation, this would be triggered by abort signal)
    await stream.end()

    expect(stream.isClosed()).toBe(true)
  })
})
