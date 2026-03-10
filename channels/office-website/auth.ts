/**
 * Office-Website Channel Authentication
 *
 * Provides authentication middleware for the office-website channel.
 * Supports Token and API Key authentication.
 *
 * @module channels/office-website/auth
 */

import type { OpenClawConfig } from "../../config/config";
import { maskSensitive } from "./utils";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

export interface AuthResult {
  valid: boolean;
  accountId?: string;
  error?: string;
}

export interface TokenValidation {
  valid: boolean;
  expired?: boolean;
  accountId?: string;
  scopes?: string[];
}

export async function authenticateRequest(
  cfg: OpenClawConfig,
  authHeader?: string,
): Promise<AuthResult> {
  if (!authHeader) {
    return { valid: false, error: "Missing authorization header" };
  }

  const [type, token] = authHeader.split(" ");
  if (!type || !token) {
    return { valid: false, error: "Invalid authorization header format" };
  }

  switch (type.toLowerCase()) {
    case "bearer":
      return validateBearerToken(cfg, token);
    case "apikey":
      return validateApiKey(cfg, token);
    default:
      return { valid: false, error: `Unsupported auth type: ${type}` };
  }
}

async function validateBearerToken(
  cfg: OpenClawConfig,
  token: string,
): Promise<AuthResult> {
  const accounts = cfg.channels?.["office-website"]?.accounts as
    | Record<string, { token?: string; tokenFile?: string }>
    | undefined;
  const gatewayToken = cfg.gateway?.auth?.mode === "token" ? cfg.gateway.auth.token : undefined;

  if (!accounts && !gatewayToken) {
    return { valid: false, error: "No accounts configured" };
  }

  for (const [accountId, account] of Object.entries(accounts ?? {})) {
    if (account.token && timingSafeEqual(account.token, token)) {
      return { valid: true, accountId };
    }

    if (account.tokenFile) {
      try {
        const fileToken = await readTokenFile(account.tokenFile);
        if (timingSafeEqual(fileToken, token)) {
          return { valid: true, accountId };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(
          `Failed to read token file for account ${accountId}: ${maskSensitive(errorMessage)}`,
        );
      }
    }
  }

  if (gatewayToken && timingSafeEqual(gatewayToken, token)) {
    return { valid: true, accountId: "default" };
  }

  return { valid: false, error: "Invalid token" };
}

async function validateApiKey(
  cfg: OpenClawConfig,
  apiKey: string,
): Promise<AuthResult> {
  const accounts = cfg.channels?.["office-website"]?.accounts as
    | Record<string, { token?: string; tokenFile?: string }>
    | undefined;
  const gatewayToken = cfg.gateway?.auth?.mode === "token" ? cfg.gateway.auth.token : undefined;

  if (!accounts && !gatewayToken) {
    return { valid: false, error: "No accounts configured" };
  }

  for (const [accountId, account] of Object.entries(accounts ?? {})) {
    if (account.token && timingSafeEqual(account.token, apiKey)) {
      return { valid: true, accountId };
    }
  }

  if (gatewayToken && timingSafeEqual(gatewayToken, apiKey)) {
    return { valid: true, accountId: "default" };
  }

  return { valid: false, error: "Invalid API key" };
}

async function readTokenFile(filePath: string): Promise<string> {
  const fs = await import("fs/promises");
  const token = await fs.readFile(filePath, "utf-8");
  return token.trim();
}

export function createAuthMiddleware(cfg: OpenClawConfig) {
  return async (req: { headers: Record<string, string | undefined> }, next: () => void) => {
    const authHeader = req.headers["authorization"];
    const result = await authenticateRequest(cfg, authHeader);

    if (!result.valid) {
      throw new Error(`Authentication failed: ${result.error}`);
    }

    (req as Record<string, unknown>).accountId = result.accountId;

    return next();
  };
}

export function generateTestToken(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
