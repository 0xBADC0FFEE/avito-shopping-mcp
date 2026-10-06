import { AvitoMcpError } from "./errors.js";

export type JsonObject = Record<string, unknown>;

/**
 * Unwraps a field the response cannot be used without.
 * @param value Parsed field, `null`/`undefined` when absent or malformed.
 * @param path Dotted response path named in the error.
 * @returns The present value.
 * @throws AvitoMcpError `AVITO_RESPONSE_INVALID` when the field is missing.
 */
export function required<T>(value: T | null | undefined, path: string): T {
  if (value === null || value === undefined) {
    throw new AvitoMcpError("AVITO_RESPONSE_INVALID", `Avito response is missing ${path}; the site format may have changed.`);
  }
  return value;
}

export function at(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    current = object(current)?.[key];
  }
  return current;
}

export function list(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function array(value: unknown): unknown[] {
  return list(value) ?? [];
}

export function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export function decimal(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

export function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
