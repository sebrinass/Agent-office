/**
 * Office-Website Channel Configuration
 *
 * Defines the configuration schema and adapter for the office-website channel.
 *
 * @module channels/office-website/config
 */

import type { OpenClawConfig } from "../../config/config.js";
import type { ChannelConfigAdapter } from "../plugins/types.adapters.js";
import { z } from "zod";
import { buildChannelConfigSchema } from "../plugins/config-schema.js";

/**
 * Office-Website account configuration schema
 */
export const OfficeWebsiteAccountSchema = z.object({
  enabled: z.boolean().default(true),
  token: z.string().optional(),
  tokenFile: z.string().optional(),
  apiUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
  sessionTimeout: z.number().default(3600000), // 1 hour in ms
  maxSessions: z.number().default(100),
  memoryEnabled: z.boolean().default(true),
  memoryProvider: z.enum(["openai", "local"]).default("openai"),
  embeddingModel: z.string().default("text-embedding-3-small"),
});

export type OfficeWebsiteAccount = z.infer<typeof OfficeWebsiteAccountSchema>;

/**
 * Resolved account type with runtime information
 */
export type ResolvedOfficeWebsiteAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  token?: string;
  tokenSource?: string;
  apiUrl?: string;
  webhookUrl?: string;
  sessionTimeout: number;
  maxSessions: number;
  memoryEnabled: boolean;
  memoryProvider: string;
  embeddingModel: string;
};

/**
 * Channel configuration adapter for office-website
 *
 * Implements the ChannelConfigAdapter interface to provide
 * account management and configuration resolution.
 */
export const officeWebsiteConfig: ChannelConfigAdapter<ResolvedOfficeWebsiteAccount> = {
  /**
   * List all account IDs configured for this channel
   */
  listAccountIds: (cfg: OpenClawConfig): string[] => {
    const accounts = cfg.channels?.["office-website"]?.accounts;
    if (!accounts || typeof accounts !== "object") {
      return [];
    }
    return Object.keys(accounts);
  },

  /**
   * Resolve an account configuration by ID
   */
  resolveAccount: (
    cfg: OpenClawConfig,
    accountId?: string | null,
  ): ResolvedOfficeWebsiteAccount => {
    const accounts = cfg.channels?.["office-website"]?.accounts as
      | Record<string, OfficeWebsiteAccount>
      | undefined;

    // Default account ID
    const id = accountId || "default";

    // Get account config or use defaults
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

    return {
      accountId: id,
      enabled: accountConfig.enabled ?? true,
      configured: !!(accountConfig.token || accountConfig.tokenFile),
      token: accountConfig.token,
      tokenSource: accountConfig.token ? "config" : accountConfig.tokenFile ? "file" : undefined,
      apiUrl: accountConfig.apiUrl,
      webhookUrl: accountConfig.webhookUrl,
      sessionTimeout: accountConfig.sessionTimeout ?? 3600000,
      maxSessions: accountConfig.maxSessions ?? 100,
      memoryEnabled: accountConfig.memoryEnabled ?? true,
      memoryProvider: accountConfig.memoryProvider ?? "openai",
      embeddingModel: accountConfig.embeddingModel ?? "text-embedding-3-small",
    };
  },

  /**
   * Get the default account ID
   */
  defaultAccountId: (cfg: OpenClawConfig): string => {
    const ids = officeWebsiteConfig.listAccountIds(cfg);
    return ids.includes("default") ? "default" : ids[0] || "default";
  },

  /**
   * Check if an account is enabled
   */
  isEnabled: (account: ResolvedOfficeWebsiteAccount): boolean => {
    return account.enabled;
  },

  /**
   * Check if an account is properly configured
   */
  isConfigured: (account: ResolvedOfficeWebsiteAccount): boolean => {
    return account.configured;
  },

  /**
   * Get the reason why an account is not configured
   */
  unconfiguredReason: (account: ResolvedOfficeWebsiteAccount): string => {
    if (account.configured) {
      return "";
    }
    return "No token or tokenFile configured for office-website channel";
  },

  /**
   * Describe an account for status display
   */
  describeAccount: (
    account: ResolvedOfficeWebsiteAccount,
    _cfg: OpenClawConfig,
  ): import("../plugins/types.core.js").ChannelAccountSnapshot => {
    return {
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      tokenSource: account.tokenSource,
      webhookUrl: account.webhookUrl,
    };
  },
};

/**
 * Get the configuration schema for the channel
 */
export function getOfficeWebsiteConfigSchema() {
  return buildChannelConfigSchema(OfficeWebsiteAccountSchema);
}
