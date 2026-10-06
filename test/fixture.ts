import { readFileSync } from "node:fs";

export function textFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export function jsonFixture(name: string): unknown {
  return JSON.parse(textFixture(name)) as unknown;
}
