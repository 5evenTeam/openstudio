import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(projectRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const PROJECT_NAME = "OpenStudio";
export const BRIDGE_PORT = Number(process.env.OPENSTUDIO_PORT ?? 3777);
export const BRIDGE_HOST = process.env.OPENSTUDIO_HOST ?? "127.0.0.1";
export const BRIDGE_TOKEN =
  process.env.OPENSTUDIO_TOKEN ?? "openstudio-local-dev-token";
export const STUDIO_TIMEOUT_MS = envNumber("OPENSTUDIO_STUDIO_TIMEOUT_MS", 15_000);
export const HEARTBEAT_STALE_MS = envNumber("OPENSTUDIO_HEARTBEAT_STALE_MS", 10_000);
export const BRIDGE_VERSION = readPackageVersion();
export const UPDATE_MANIFEST_URL = process.env.OPENSTUDIO_UPDATE_MANIFEST_URL;
export const PERMISSION_LEVEL = (process.env.OPENSTUDIO_PERMISSIONS ?? "scripts-only") as
  | "read-only"
  | "scripts-only"
  | "full-edit";

export const MAX_BODY_BYTES = envNumber("OPENSTUDIO_MAX_BODY_BYTES", 10 * 1024 * 1024);
export const MAX_COMMANDS_PER_REQUEST = envNumber("OPENSTUDIO_MAX_COMMANDS_PER_REQUEST", 1000);
export const MAX_LONG_POLL_MS = envNumber("OPENSTUDIO_MAX_LONG_POLL_MS", 10_000);
export const MAX_LOG_ENTRIES = envNumber("OPENSTUDIO_MAX_LOG_ENTRIES", 1000);
export const COMMAND_QUEUE_LIMIT = envNumber("OPENSTUDIO_COMMAND_QUEUE_LIMIT", 5000);

export function runtimeDir(): string {
  return path.join(projectRoot, "data");
}

export function tokenPath(): string {
  return path.join(runtimeDir(), "token.txt");
}

export function makeCommandId(): string {
  return randomBytes(8).toString("hex");
}

