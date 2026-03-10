/**
 * Office-Website Channel Plugin Entry Point
 *
 * This is the main entry point for the office-website channel plugin.
 * It registers the complete ChannelPlugin with OpenClaw Gateway.
 *
 * @module channels/office-website
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "../../config/config";
import { officeWebsitePlugin } from "./plugin";
import {
  handleMessageHttpRequest,
  handleHistoryHttpRequest,
  handleSessionHttpRequest,
  handlePingHttpRequest,
  handleStreamHttpRequest,
} from "./api";

// Import runtime functions from runtime.ts (needed for register() function)
import {
  getOfficeWebsiteRuntime,
  setOfficeWebsiteRuntime,
  // Text APIs
  chunkMarkdownText,
  chunkByNewline,
  chunkTextWithMode,
  hasControlCommand,
  convertMarkdownTables,
  // Reply APIs
  dispatchReplyFromConfig,
  finalizeInboundContext,
  createReplyDispatcherWithTyping,
  withReplyDispatcher,
  resolveEffectiveMessagesConfig,
  resolveHumanDelayConfig,
  // Routing APIs
  resolveAgentRoute,
  // Media APIs
  fetchRemoteMedia,
  saveMediaBuffer,
  // Session APIs
  resolveStorePath,
  updateLastRoute,
  // Activity APIs
  recordChannelActivity,
  getChannelActivity,
  // Mentions APIs
  buildMentionRegexes,
  matchesMentionPatterns,
  // Debounce APIs
  createInboundDebouncer,
  resolveInboundDebounceMs,
} from "./runtime";

// Re-export runtime functions for external consumers
export {
  getOfficeWebsiteRuntime,
  setOfficeWebsiteRuntime,
  // Text APIs
  chunkMarkdownText,
  chunkByNewline,
  chunkTextWithMode,
  hasControlCommand,
  convertMarkdownTables,
  // Reply APIs
  dispatchReplyFromConfig,
  finalizeInboundContext,
  createReplyDispatcherWithTyping,
  withReplyDispatcher,
  resolveEffectiveMessagesConfig,
  resolveHumanDelayConfig,
  // Routing APIs
  resolveAgentRoute,
  // Media APIs
  fetchRemoteMedia,
  saveMediaBuffer,
  // Session APIs
  resolveStorePath,
  updateLastRoute,
  // Activity APIs
  recordChannelActivity,
  getChannelActivity,
  // Mentions APIs
  buildMentionRegexes,
  matchesMentionPatterns,
  // Debounce APIs
  createInboundDebouncer,
  resolveInboundDebounceMs,
};

/**
 * Office-Website Plugin Definition
 *
 * This is the main plugin object that OpenClaw Gateway loads.
 * It uses `api.registerChannel()` to register the complete ChannelPlugin.
 */
const plugin = {
  id: "office-website",
  name: "Office Website",
  description: "Office document collaboration channel for AI-powered assistance",
  version: "1.0.0",
  kind: "channel",

  /**
   * Plugin registration function
   * Called by OpenClaw Gateway when the plugin is loaded
   */
  register(api: OpenClawPluginApi) {
    // Save runtime reference for later use
    setOfficeWebsiteRuntime(api.runtime);

    // Log registration
    console.log(`[office-website] Registering plugin: ${api.id} (${api.name})`);

    // Register the complete channel plugin
    api.registerChannel({ plugin: officeWebsitePlugin });

    // Register HTTP routes for frontend API
    // These routes enable the office-website frontend to communicate with OpenClaw
    const cfg = api.config as OpenClawConfig;

    // GET /api/office-website/ping - Heartbeat endpoint
    // auth: "plugin" means plugin handles auth itself (no gateway enforcement)
    api.registerHttpRoute({
      path: "/api/office-website/ping",
      auth: "plugin",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        return handlePingHttpRequest(req, res, cfg);
      },
    });

    // GET /api/office-website/session - Get session status
    api.registerHttpRoute({
      path: "/api/office-website/session",
      auth: "plugin",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        return handleSessionHttpRequest(req, res, cfg);
      },
    });

    // GET /api/office-website/history - Get message history
    api.registerHttpRoute({
      path: "/api/office-website/history",
      auth: "plugin",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        return handleHistoryHttpRequest(req, res, cfg);
      },
    });

    // POST /api/office-website/message - Send a message
    api.registerHttpRoute({
      path: "/api/office-website/message",
      auth: "plugin",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        return handleMessageHttpRequest(req, res, cfg);
      },
    });

    // GET /api/office-website/stream - SSE streaming endpoint
    api.registerHttpRoute({
      path: "/api/office-website/stream",
      auth: "plugin",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        return handleStreamHttpRequest(req, res, cfg);
      },
    });

    console.log("[office-website] HTTP routes registered successfully");
    console.log("[office-website] Channel plugin registered successfully");
  },
};

export default plugin;
export { plugin, officeWebsitePlugin };
