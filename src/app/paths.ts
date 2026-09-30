import { homedir } from "node:os";
import path from "node:path";

const APP_NAME = "Claudex";

/** Cross-platform application data directory, overridable via CLAUDEX_DATA_DIR. */
export function appDataDir(): string {
  const override = process.env["CLAUDEX_DATA_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return path.join(process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming"), APP_NAME);
    case "darwin":
      return path.join(home, "Library", "Application Support", APP_NAME);
    default:
      return path.join(
        process.env["XDG_DATA_HOME"] ?? path.join(home, ".local", "share"),
        APP_NAME,
      );
  }
}

export function appDataSubdir(...parts: string[]): string {
  return path.join(appDataDir(), ...parts);
}

/** Legacy per-repository data dir, imported once when present. */
export function legacyDataDir(root: string): string {
  return path.join(root, ".claudex");
}
