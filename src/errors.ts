export type WbErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_EXPIRED"
  | "WB_BLOCKED"
  | "WB_RESPONSE_INVALID"
  | "BROWSER_UNAVAILABLE"
  | "INVALID_PRODUCT"
  | "PRODUCT_NOT_FOUND"
  | "REQUEST_FAILED";

export class WbMcpError extends Error {
  constructor(
    public readonly code: WbErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WbMcpError";
  }
}

export function safeError(error: unknown): { code: WbErrorCode | "UNKNOWN"; message: string } {
  if (error instanceof WbMcpError) {
    return { code: error.code, message: error.message };
  }
  return { code: "UNKNOWN", message: "Unexpected internal error." };
}
