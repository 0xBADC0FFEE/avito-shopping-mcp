export type OzonErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_EXPIRED"
  | "OZON_BLOCKED"
  | "OZON_RESPONSE_INVALID"
  | "BROWSER_UNAVAILABLE"
  | "INVALID_PRODUCT"
  | "REQUEST_FAILED";

export class OzonMcpError extends Error {
  constructor(
    public readonly code: OzonErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OzonMcpError";
  }
}

export function safeError(error: unknown): { code: OzonErrorCode | "UNKNOWN"; message: string } {
  if (error instanceof OzonMcpError) {
    return { code: error.code, message: error.message };
  }
  return { code: "UNKNOWN", message: "Unexpected internal error." };
}
