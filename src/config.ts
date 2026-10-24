import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

export const PROJECT_NAME = "OpenStudio";
export const BRIDGE_PORT = Number(process.env.OPENSTUDIO_PORT ?? 3777);
export const BRIDGE_HOST = process.env.OPENSTUDIO_HOST ?? "127.0.0.1";
export const BRIDGE_TOKEN =
  process.env.OPENSTUDIO_TOKEN ?? "openstudio-local-dev-token";
export const STUDIO_TIMEOUT_MS = 15_000;
export const HEARTBEAT_STALE_MS = 10_000;
export const BRIDGE_VERSION = "0.1.0";
export const UPDATE_MANIFEST_URL = process.env.OPENSTUDIO_UPDATE_MANIFEST_URL;
export const FIGMA_ACCESS_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
export const PERMISSION_LEVEL = (process.env.OPENSTUDIO_PERMISSIONS ?? "scripts-only") as
  | "read-only"
  | "scripts-only"
  | "full-edit";

export function runtimeDir(): string {
  return path.join(projectRoot, "data");
}

export function tokenPath(): string {
  return path.join(runtimeDir(), "token.txt");
}

export function makeCommandId(): string {
  return randomBytes(8).toString("hex");
}
