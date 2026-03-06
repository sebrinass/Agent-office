/**
 * Office-Website Channel Authentication
 *
 * Provides authentication middleware for the office-website channel.
 * Supports Token and API Key authentication.
 *
 * @module channels/office-website/auth
 */

import type { OpenClawConfig } from "../../config/config.js";

/**
 * Authentication result
 */
export interface AuthResult {
  valid: boolean;
  accountId?: string;
  error?: string;
}

/**
 * Token validation result
 */
export interface TokenValidation {
  valid: boolean;
  expired?: boolean;
  accountId?: string;
  scopes?: string[];
}

/**
 * Authenticate a request
 *
 * Validates the authentication token or API key from the request headers.
 *
 * @param cfg - OpenClaw configuration
 * @param authHeader - Authorization header value
 */
export async function authenticateRequest(
  cfg: OpenClawConfig,
  authHeader?: string,
): Promise<AuthResult> {
  // Check if auth header exists
  if (!authHeader) {
    return { valid: false, error: "Missing authorization header" };
  }

  // Parse auth header
  const [type, token] = authHeader.split(" ");
  if (!type || !token) {
    return { valid: false, error: "Invalid authorization header format" };
  }

  // Handle different auth types
  switch (type.toLowerCase()) {
    case "bearer":
      return validateBearerToken(cfg, token);
    case "apikey":
      return validateApiKey(cfg, token);
    default:
      return { valid: false, error: `Unsupported auth type: ${type}` };
  }
}

/**
 * Validate a Bearer token
 */
async function validateBearerToken(
  cfg: OpenClawConfig,
  token: string,
): Promise<AuthResult> {
  // Get configured tokens
  const accounts = cfg.channels?.["office-website"]?.accounts as
    | Record<string, { token?: string; tokenFile?: string }>
    | undefined;

  if (!accounts) {
    return { valid: false, error: "No accounts configured" };
  }

  // Check each account for matching token
  for (const [accountId, account] of Object.entries(accounts)) {
    // Check direct token
    if (account.token && account.token === token) {
      return { valid: true, accountId };
    }

    // Check token file
    if (account.tokenFile) {
      try {
        const fileToken = await readTokenFile(account.tokenFile);
        if (fileToken === token) {
          return { valid: true, accountId };
        }
      } catch (error) {
        console.error(`Failed to read token file for account ${accountId}:`, error);
      }
    }
  }

  return { valid: false, error: "Invalid token" };
}

/**
 * Validate an API key
 */
async function validateApiKey(
  cfg: OpenClawConfig,
  apiKey: string,
): Promise<AuthResult> {
  // API keys are stored in the same way as tokens
  // but are validated differently (e.g., may have different scopes)
  const accounts = cfg.channels?.["office-website"]?.accounts as
    | Record<string, { token?: string; tokenFile?: string }>
    | undefined;

  if (!accounts) {
    return { valid: false, error: "No accounts configured" };
  }

  // Check each account for matching API key
  for (const [accountId, account] of Object.entries(accounts)) {
    if (account.token && account.token === apiKey) {
      return { valid: true, accountId };
    }
  }

  return { valid: false, error: "Invalid API key" };
}

/**
 * Read token from file
 */
async function readTokenFile(filePath: string): Promise<string> {
  // In a real implementation, this would read from the file system
  // For now, we'll use a simple approach
  const fs = await import("fs/promises");
  const token = await fs.readFile(filePath, "utf-8");
  return token.trim();
}

/**
 * Create authentication middleware
 *
 * Returns a middleware function that can be used with HTTP servers.
 */
export function createAuthMiddleware(cfg: OpenClawConfig) {
  return async (req: { headers: Record<string, string | undefined> }, next: () => void) => {
    const authHeader = req.headers["authorization"];
    const result = await authenticateRequest(cfg, authHeader);

    if (!result.valid) {
      throw new Error(`Authentication failed: ${result.error}`);
    }

    // Attach account ID to request for later use
    (req as Record<string, unknown>).accountId = result.accountId;

    return next();
  };
}

/**
 * Generate a new token for testing
 *
 * This is a utility function for generating test tokens.
 * In production, tokens should be generated securely.
 */
export function generateTestToken(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
