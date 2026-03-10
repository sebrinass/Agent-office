/**
 * Office-Website Channel Utilities
 *
 * Common utility functions for the office-website channel.
 *
 * @module channels/office-website/utils
 */

// ============================================================================
// Sensitive Information Masking
// ============================================================================

/**
 * Mask sensitive information in text
 *
 * This function masks sensitive information like tokens, API keys,
 * and long text content that might contain sensitive data.
 *
 * @param text - Text to mask
 * @param options - Masking options
 * @returns Masked text safe for logging
 */
export function maskSensitive(
  text: string,
  options?: {
    /** Maximum length before truncation (default: 200) */
    maxLength?: number;
    /** Whether to mask tokens (default: true) */
    maskTokens?: boolean;
    /** Whether to truncate long text (default: true) */
    truncateLongText?: boolean;
  },
): string {
  const {
    maxLength = 200,
    maskTokens = true,
    truncateLongText = true,
  } = options ?? {};

  let maskedText = text;

  // Mask tokens and API keys in various formats
  if (maskTokens) {
    // Match patterns like: token: xxx, token=xxx, "token": "xxx", token: "xxx"
    maskedText = maskedText.replace(
      /(token["\s:=]+)([a-zA-Z0-9_\-]{8,})/gi,
      "$1***MASKED***",
    );

    // Match patterns like: apiKey: xxx, api_key=xxx, "apiKey": "xxx"
    maskedText = maskedText.replace(
      /(api[_-]?key["\s:=]+)([a-zA-Z0-9_\-]{8,})/gi,
      "$1***MASKED***",
    );

    // Match patterns like: Authorization: Bearer xxx
    maskedText = maskedText.replace(
      /(bearer\s+)([a-zA-Z0-9_\-\.]{8,})/gi,
      "$1***MASKED***",
    );

    // Match patterns like: password: xxx, "password": "xxx"
    maskedText = maskedText.replace(
      /(password["\s:=]+)([^\s"]+)/gi,
      "$1***MASKED***",
    );

    // Match patterns like: secret: xxx, "secret": "xxx"
    maskedText = maskedText.replace(
      /(secret["\s:=]+)([a-zA-Z0-9_\-]{8,})/gi,
      "$1***MASKED***",
    );
  }

  // Truncate long text that might contain document content
  if (truncateLongText && maskedText.length > maxLength) {
    const halfLength = Math.floor(maxLength / 2);
    return (
      maskedText.substring(0, halfLength) +
      `...[TRUNCATED ${maskedText.length - maxLength} chars]...` +
      maskedText.substring(maskedText.length - halfLength)
    );
  }

  return maskedText;
}

/**
 * Mask sensitive headers in HTTP request
 *
 * @param headers - Headers object to mask
 * @returns Masked headers object safe for logging
 */
export function maskHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const sensitiveHeaders = [
    "authorization",
    "x-api-key",
    "x-auth-token",
    "cookie",
    "set-cookie",
  ];

  const masked: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey) && value) {
      masked[key] = "***MASKED***";
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

/**
 * Mask sensitive fields in an object
 *
 * @param obj - Object to mask
 * @param sensitiveFields - List of field names to mask
 * @returns Masked object safe for logging
 */
export function maskObject(
  obj: Record<string, unknown>,
  sensitiveFields: string[] = ["token", "password", "secret", "apiKey", "api_key"],
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveFields.some((field) =>
      lowerKey.includes(field.toLowerCase()),
    );

    if (isSensitive && typeof value === "string") {
      masked[key] = "***MASKED***";
    } else if (typeof value === "object" && value !== null) {
      masked[key] = maskObject(
        value as Record<string, unknown>,
        sensitiveFields,
      );
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

/**
 * Create a safe log function that masks sensitive information
 *
 * @param logFn - Original log function
 * @returns Safe log function that masks sensitive data
 */
export function createSafeLogger(
  logFn: (...args: unknown[]) => void,
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const safeArgs = args.map((arg) => {
      if (typeof arg === "string") {
        return maskSensitive(arg);
      }
      if (typeof arg === "object" && arg !== null) {
        return maskObject(arg as Record<string, unknown>);
      }
      return arg;
    });
    logFn(...safeArgs);
  };
}

// ============================================================================
// Other Utilities
// ============================================================================

/**
 * Safely stringify an object for logging
 *
 * Handles circular references and masks sensitive information.
 *
 * @param obj - Object to stringify
 * @param space - Number of spaces for indentation
 * @returns Safe JSON string
 */
export function safeStringify(
  obj: unknown,
  space?: number,
): string {
  const seen = new WeakSet();

  const stringify = (value: unknown): unknown => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);

      if (Array.isArray(value)) {
        return value.map(stringify);
      }

      const masked = maskObject(value as Record<string, unknown>);
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(masked)) {
        result[key] = stringify(val);
      }
      return result;
    }
    return value;
  };

  try {
    return JSON.stringify(stringify(obj), null, space);
  } catch {
    return "[Unable to stringify]";
  }
}
