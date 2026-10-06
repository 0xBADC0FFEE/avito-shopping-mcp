export type AvitoErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_EXPIRED"
  | "AVITO_BLOCKED"
  | "AVITO_RATE_LIMITED"
  | "AVITO_RESPONSE_INVALID"
  | "BROWSER_UNAVAILABLE"
  | "INVALID_INPUT"
  | "INVALID_ITEM"
  | "ITEM_NOT_FOUND"
  | "LOCATION_NOT_FOUND"
  | "REQUEST_FAILED";

export class AvitoMcpError extends Error {
  constructor(
    public readonly code: AvitoErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AvitoMcpError";
  }
}

export function safeError(error: unknown): { code: AvitoErrorCode | "UNKNOWN"; message: string } {
  if (error instanceof AvitoMcpError) {
    return { code: error.code, message: error.message };
  }
  return { code: "UNKNOWN", message: "Unexpected internal error." };
}
