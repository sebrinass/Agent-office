/**
 * Office-Website Channel Plugin
 *
 * This plugin enables OpenClaw to integrate with the office-website document collaboration platform.
 * It provides HTTP API endpoints for message exchange, document context awareness, and permission control.
 *
 * @module channels/office-website
 */

import type { OpenClawPluginApi } from "../../plugins/types.js";
import type { ChannelPlugin } from "../plugins/types.plugin.js";
import { officeWebsiteConfig } from "./config.js";
import { monitorOfficeWebsiteChannel } from "./monitor.js";
import { officeWebsitePermissions } from "./permissions.js";
import { registerApiRoutes, setSessionManager } from "./api.js";
import { SessionManager } from "./session.js";

/**
 * Channel metadata for office-website
 */
const officeWebsiteMeta = {
  id: "office-website",
  label: "Office Website",
  selectionLabel: "Office Website (Document Collaboration)",
  docsPath: "/docs/channels/office-website",
  blurb: "Document collaboration platform with AI-powered assistance",
  order: 100,
};

/**
 * Channel capabilities
 */
const officeWebsiteCapabilities: import("../plugins/types.core.js").ChannelCapabilities = {
  chatTypes: ["direct", "group"],
  polls: false,
  reactions: false,
  edit: true,
  unsend: false,
  reply: true,
  effects: false,
  groupManagement: false,
  threads: false,
  media: true,
  nativeCommands: false,
  blockStreaming: false,
};

/**
 * Register the office-website channel plugin
 *
 * This function returns the complete channel plugin configuration
 * that OpenClaw uses to integrate with the office-website platform.
 */
export function registerOfficeWebsiteChannel(): ChannelPlugin {
  return {
    id: "office-website",
    meta: officeWebsiteMeta,
    capabilities: officeWebsiteCapabilities,
    config: officeWebsiteConfig,
    // Gateway monitoring function for receiving messages
    gateway: {
      startAccount: monitorOfficeWebsiteChannel,
    },
    // HTTP API endpoints - these are declared for method listing
    gatewayMethods: [
      "POST /api/office-website/message",
      "GET /api/office-website/stream",
      "POST /api/office-website/document",
      "GET /api/office-website/history",
      "GET /api/office-website/session",
      "GET /api/office-website/ping",
    ],
  };
}

/**
 * Plugin registration function for OpenClaw plugin system
 *
 * This function is called by the OpenClaw plugin loader to register
 * the office-website channel plugin with all its HTTP routes.
 */
export function register(api: OpenClawPluginApi): void {
  // Register the channel
  api.registerChannel(registerOfficeWebsiteChannel());

  // Create session manager
  const sessionManager = new SessionManager({
    maxSessions: 100,
    sessionTimeout: 30 * 60 * 1000, // 30 minutes
    memoryEnabled: true,
    memoryProvider: "openai",
    embeddingModel: "text-embedding-3-small",
  });

  // Set global session manager for API handlers
  setSessionManager(sessionManager);

  // Register HTTP routes using the plugin API
  registerApiRoutes({
    cfg: api.config,
    sessionManager,
    registerHttpRoute: (params) => {
      api.registerHttpRoute({
        path: params.path,
        auth: params.auth,
        handler: params.handler,
      });
    },
  });
}

// Re-export submodules for external use
export { officeWebsiteConfig } from "./config.js";
export { monitorOfficeWebsiteChannel } from "./monitor.js";
export { officeWebsiteApi, registerApiRoutes } from "./api.js";
export { sendMessage, sendRichTextMessage, sendMediaMessage, sendStreamStart, sendStreamDelta, sendStreamEnd, blocksToMarkdown, markdownToBlocks } from "./send.js";
export { SessionManager } from "./session.js";
export { authenticateRequest } from "./auth.js";
export { officeWebsitePermissions, checkPermission } from "./permissions.js";
export { MemoryIntegration, createMemoryIntegration } from "./memory-integration.js";
export { DocumentContextManager, createDocumentContextManager, documentOperation, DocumentOperationBuilder } from "./document-operations.js";

// Default export
export default registerOfficeWebsiteChannel;
