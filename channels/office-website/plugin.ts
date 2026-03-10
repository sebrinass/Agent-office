/**
 * Office-Website Channel Plugin
 *
 * Complete ChannelPlugin implementation for OpenClaw Gateway.
 * Supports document collaboration with Agent integration.
 *
 * @module channels/office-website/plugin
 */

import type { ChannelMeta, ChannelPlugin, ClawdbotConfig } from "openclaw/plugin-sdk";
import {
  buildBaseChannelStatusSummary,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
} from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "../../config/config";
import type {
  ChannelConfigAdapter,
  ChannelGatewayAdapter,
  ChannelOutboundAdapter,
  ChannelStatusAdapter,
} from "openclaw/plugin-sdk";
import type { ResolvedOfficeWebsiteAccount } from "./config";
import { officeWebsiteConfig } from "./config";
import { officeWebsiteOutbound } from "./outbound";

// ============================================================================
// Channel Metadata
// ============================================================================

/**
 * Channel metadata definition
 */
const meta: ChannelMeta = {
  id: "office-website",
  label: "Office Website",
  selectionLabel: "Office Website (文档协作)",
  docsPath: "/channels/office-website",
  docsLabel: "office-website",
  blurb: "Office document collaboration channel for AI-powered assistance.",
  aliases: ["office", "doc"],
  order: 100,
};

// ============================================================================
// Resolved Account Type
// ============================================================================

/**
 * Extended resolved account with additional runtime info
 */
export type OfficeWebsiteResolvedAccount = ResolvedOfficeWebsiteAccount & {
  name?: string;
};

// ============================================================================
// Account Resolution Functions
// ============================================================================

/**
 * List all account IDs for this channel
 */
function listOfficeWebsiteAccountIds(cfg: OpenClawConfig): string[] {
  return officeWebsiteConfig.listAccountIds(cfg);
}

/**
 * Resolve an account by ID
 */
function resolveOfficeWebsiteAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): OfficeWebsiteResolvedAccount {
  const resolved = officeWebsiteConfig.resolveAccount(cfg, accountId);
  return {
    ...resolved,
    name: resolved.accountId === DEFAULT_ACCOUNT_ID ? "Default Account" : resolved.accountId,
  };
}

/**
 * Resolve the default account ID
 */
function resolveDefaultOfficeWebsiteAccountId(cfg: OpenClawConfig): string {
  return officeWebsiteConfig.defaultAccountId(cfg) || DEFAULT_ACCOUNT_ID;
}

// ============================================================================
// Config Adapter
// ============================================================================

const configAdapter: ChannelConfigAdapter<OfficeWebsiteResolvedAccount> = {
  listAccountIds: (cfg) => listOfficeWebsiteAccountIds(cfg),
  resolveAccount: (cfg, accountId) => resolveOfficeWebsiteAccount(cfg, accountId),
  defaultAccountId: (cfg) => resolveDefaultOfficeWebsiteAccountId(cfg),
  isConfigured: (account, cfg) => account.configured,
  describeAccount: (account, cfg) => ({
    accountId: account.accountId,
    enabled: account.enabled,
    configured: account.configured,
    name: account.name,
    tokenSource: account.tokenSource,
    webhookUrl: account.webhookUrl,
  }),
};

// ============================================================================
// Outbound Adapter
// ============================================================================

/**
 * Outbound adapter for sending messages
 *
 * Implements ChannelOutboundAdapter for sending messages from OpenClaw
 * to the office-website frontend via Gateway HTTP API.
 */
const outboundAdapter: ChannelOutboundAdapter = officeWebsiteOutbound;

// ============================================================================
// Gateway Adapter
// ============================================================================

/**
 * Gateway adapter for managing channel lifecycle
 *
 * Implements the startAccount and stopAccount methods to integrate
 * with the OpenClaw Gateway for message monitoring.
 */
const gatewayAdapter: ChannelGatewayAdapter<OfficeWebsiteResolvedAccount> = {
  /**
   * Start an account gateway
   *
   * This method initializes the session manager and starts monitoring
   * for incoming messages from the office-website channel.
   */
  startAccount: async (ctx) => {
    const { cfg, accountId, account, runtime, abortSignal, log, channelRuntime, setStatus } = ctx;

    log?.info(`starting office-website[${accountId}]`);

    // Set initial status
    setStatus({
      accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: true,
      lastStartAt: Date.now(),
    });

    // Import and start the monitor
    const { monitorOfficeWebsiteChannel } = await import("./monitor.js");

    return monitorOfficeWebsiteChannel({
      cfg,
      accountId,
      account,
      runtime,
      abortSignal,
      log,
      channelRuntime,
      getStatus: ctx.getStatus,
      setStatus,
    });
  },

  /**
   * Stop an account gateway
   *
   * This method cleans up the session manager and stops the monitor.
   */
  stopAccount: async (ctx) => {
    const { accountId, log, setStatus } = ctx;

    log?.info(`stopping office-website[${accountId}]`);

    // Import and call stop function
    const { stopOfficeWebsiteMonitor } = await import("./monitor.js");
    stopOfficeWebsiteMonitor(accountId);

    // Update status
    setStatus({
      accountId,
      running: false,
      lastStopAt: Date.now(),
    });
  },
};

// ============================================================================
// Status Adapter (Stub)
// ============================================================================

/**
 * Status adapter for channel status reporting
 *
 * Provides account health probing and status snapshot building.
 */
const statusAdapter: ChannelStatusAdapter<OfficeWebsiteResolvedAccount> = {
  defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID, { port: null }),

  buildChannelSummary: ({ snapshot }) => ({
    ...buildBaseChannelStatusSummary(snapshot),
    port: snapshot.port ?? null,
  }),

  /**
   * Probe account health
   *
   * Checks if the account is properly configured and enabled.
   */
  probeAccount: async ({ account }) => {
    if (!account.configured) {
      return {
        ok: false,
        error: "Account not configured - missing token or tokenFile",
      };
    }
    if (!account.enabled) {
      return {
        ok: false,
        error: "Account is disabled",
      };
    }
    return {
      ok: true,
      error: undefined,
    };
  },

  buildAccountSnapshot: ({ account, runtime, probe }) => ({
    accountId: account.accountId,
    enabled: account.enabled,
    configured: account.configured,
    name: account.name,
    running: runtime?.running ?? false,
    lastStartAt: runtime?.lastStartAt ?? null,
    lastStopAt: runtime?.lastStopAt ?? null,
    lastError: runtime?.lastError ?? null,
    probe,
  }),
};

// ============================================================================
// Config Schema
// ============================================================================

/**
 * Configuration schema for office-website channel
 */
const configSchema = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      defaultAccount: { type: "string" },
      token: { type: "string" },
      tokenFile: { type: "string" },
      apiUrl: { type: "string", format: "uri" },
      webhookUrl: { type: "string", format: "uri" },
      sessionTimeout: { type: "integer", minimum: 0 },
      maxSessions: { type: "integer", minimum: 1 },
      memoryEnabled: { type: "boolean" },
      memoryProvider: { type: "string", enum: ["openai", "local"] },
      embeddingModel: { type: "string" },
      accounts: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            name: { type: "string" },
            token: { type: "string" },
            tokenFile: { type: "string" },
            apiUrl: { type: "string", format: "uri" },
            webhookUrl: { type: "string", format: "uri" },
            sessionTimeout: { type: "integer", minimum: 0 },
            maxSessions: { type: "integer", minimum: 1 },
            memoryEnabled: { type: "boolean" },
            memoryProvider: { type: "string", enum: ["openai", "local"] },
            embeddingModel: { type: "string" },
          },
        },
      },
    },
  },
};

// ============================================================================
// Channel Plugin Definition
// ============================================================================

/**
 * Office-Website Channel Plugin
 *
 * Complete implementation following OpenClaw ChannelPlugin interface.
 */
export const officeWebsitePlugin: ChannelPlugin<OfficeWebsiteResolvedAccount> = {
  // Metadata
  id: "office-website",
  meta: {
    ...meta,
  },

  // Capabilities
  capabilities: {
    chatTypes: ["direct", "channel"],
    polls: false,
    threads: true,
    media: true,
    reactions: false,
    edit: false,
    reply: true,
    unsend: false,
    effects: false,
    groupManagement: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  // Configuration
  config: configAdapter,
  configSchema,

  // Outbound messaging
  outbound: outboundAdapter,

  // Gateway lifecycle
  gateway: gatewayAdapter,

  // Status reporting
  status: statusAdapter,

  // Reload configuration
  reload: {
    configPrefixes: ["channels.office-website"],
  },

  // Agent prompt hints
  agentPrompt: {
    messageToolHints: () => [
      "- Office-Website targeting: use sessionId as the target identifier.",
      "- Document context is available for collaborative editing assistance.",
      "- Supports streaming responses for real-time collaboration.",
    ],
  },

  // Messaging configuration
  messaging: {
    normalizeTarget: (raw) => raw,
    targetResolver: {
      looksLikeId: (raw) => raw.startsWith("session-") || raw.length > 10,
      hint: "<sessionId>",
    },
  },

  // Directory (stub - no directory service for this channel)
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
};

export default officeWebsitePlugin;
