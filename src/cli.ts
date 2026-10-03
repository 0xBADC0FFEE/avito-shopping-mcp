#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { safeError } from "./errors.js";
import { serve } from "./mcp-server.js";
import { WbClient } from "./wb-client.js";
import { VERSION } from "./version.js";

function timeoutArgument(args: string[]): number {
  const index = args.indexOf("--timeout");
  const raw = index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith("--timeout="))?.split("=", 2)[1];
  if (raw === undefined) return 120;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 300) {
    throw new Error("--timeout must be an integer between 30 and 300 seconds");
  }
  return seconds;
}

function printHelp(): void {
  console.log(`wb-shopping-mcp ${VERSION}

Usage:
  wb-shopping-mcp setup [--timeout 120]  Create or refresh the local Wildberries session
  wb-shopping-mcp doctor                Verify configuration and the saved session
  wb-shopping-mcp serve                 Run the MCP server over stdio
  wb-shopping-mcp help                  Show this help
`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  const client = new WbClient(loadConfig());

  if (command === "setup") {
    const result = await client.setup(timeoutArgument(process.argv.slice(3)) * 1_000, (message) => console.error(message));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "doctor") {
    const result = await client.health(true);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    await client.shutdown();
    return;
  }

  if (command === "serve") {
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await client.shutdown();
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    serve(client);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(JSON.stringify({ error: safeError(error) }, null, 2));
  process.exitCode = 1;
});
