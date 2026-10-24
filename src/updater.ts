export interface UpdateManifest {
  version?: string;
  url?: string;
  notes?: string;
}

export async function fetchUpdateManifest(url: string): Promise<UpdateManifest> {
  const response = await fetch(url, { headers: { "User-Agent": "OpenStudio" } });
  if (!response.ok) {
    throw new Error(`Update manifest request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as UpdateManifest;
}

function compareVersions(left: string, right: string): number {
  const normalize = (value: string) =>
    value
      .replace(/^v/i, "")
      .split(".")
      .map((part) => Number(part) || 0);
  const a = normalize(left);
  const b = normalize(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

export function isUpdateAvailable(currentVersion: string, latestVersion?: string): boolean {
  if (!latestVersion) return false;
  return compareVersions(latestVersion, currentVersion) > 0;
}

export async function downloadUpdate(url: string, destinationDir: string): Promise<string> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.mkdirSync(destinationDir, { recursive: true });
  const response = await fetch(url, { headers: { "User-Agent": "OpenStudio" } });
  if (!response.ok || !response.body) {
    throw new Error(`Update download failed: ${response.status} ${response.statusText}`);
  }
  const fileName = path.basename(new URL(url).pathname) || "openstudio-update.zip";
  const destination = path.join(destinationDir, fileName);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
  return destination;
}
