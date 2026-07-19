import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { CliError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import { normalizeApiBaseUrl, normalizeIssuerUrl } from "./url-policy.js";

const maximumConfigBytes = 64 * 1024;
const profileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const secretKeyPattern = /(?:token|password|secret|api[_-]?key|authorization|cookie)/iu;

export interface ProfileConfig {
  readonly apiBaseUrl: string;
  readonly issuer: string;
}

interface ConfigDocument {
  readonly profiles: Readonly<Record<string, ProfileConfig>>;
  readonly version: 1;
}

export function validateProfileName(profile: string): string {
  if (!profileNamePattern.test(profile)) {
    throw new CliError(
      ExitCode.config,
      "invalid-profile",
      "Profile names must be 1-64 characters using letters, numbers, dot, underscore, or hyphen.",
    );
  }
  return profile;
}

export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  userHome = homedir(),
): string {
  if (platform === "win32") {
    const root = env["APPDATA"] ?? path.win32.join(userHome, "AppData", "Roaming");
    return path.win32.join(root, "umn-gopher-assistant", "uga", "config.json");
  }
  if (platform === "darwin") {
    return path.posix.join(
      userHome,
      "Library",
      "Application Support",
      "umn-gopher-assistant",
      "uga",
      "config.json",
    );
  }
  const root = env["XDG_CONFIG_HOME"] ?? path.posix.join(userHome, ".config");
  return path.posix.join(root, "umn-gopher-assistant", "uga", "config.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectSecretKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectSecretKeys(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) {
      throw new CliError(
        ExitCode.config,
        "secret-in-config",
        "The configuration file contains a forbidden credential field.",
      );
    }
    rejectSecretKeys(child);
  }
}

function parseProfile(name: string, value: unknown): ProfileConfig {
  validateProfileName(name);
  if (!isRecord(value) || typeof value["apiBaseUrl"] !== "string" || typeof value["issuer"] !== "string") {
    throw new CliError(ExitCode.config, "invalid-config", `Profile ${name} is malformed.`);
  }
  const unknownKeys = Object.keys(value).filter((key) => key !== "apiBaseUrl" && key !== "issuer");
  if (unknownKeys.length > 0) {
    throw new CliError(ExitCode.config, "invalid-config", `Profile ${name} contains unsupported fields.`);
  }
  return {
    apiBaseUrl: normalizeApiBaseUrl(value["apiBaseUrl"]).toString(),
    issuer: normalizeIssuerUrl(value["issuer"]).toString(),
  };
}

function parseDocument(value: unknown): ConfigDocument {
  rejectSecretKeys(value);
  if (!isRecord(value) || value["version"] !== 1 || !isRecord(value["profiles"])) {
    throw new CliError(ExitCode.config, "invalid-config", "Configuration must use schema version 1.");
  }
  const unknownKeys = Object.keys(value).filter((key) => key !== "version" && key !== "profiles");
  if (unknownKeys.length > 0) {
    throw new CliError(ExitCode.config, "invalid-config", "Configuration contains unsupported fields.");
  }
  return {
    profiles: Object.fromEntries(
      Object.entries(value["profiles"]).map(([name, profile]) => [name, parseProfile(name, profile)]),
    ),
    version: 1,
  };
}

const emptyDocument: ConfigDocument = { profiles: {}, version: 1 };

export class ConfigRepository {
  readonly path: string;

  constructor(configPath: string) {
    this.path = configPath;
  }

  async load(): Promise<ConfigDocument> {
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(this.path);
    } catch (error) {
      if (isRecord(error) && error["code"] === "ENOENT") return emptyDocument;
      throw new CliError(ExitCode.config, "config-unreadable", "Configuration could not be inspected.");
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximumConfigBytes) {
      throw new CliError(
        ExitCode.config,
        "unsafe-config-file",
        "Configuration must be a regular file no larger than 64 KiB.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(ExitCode.config, "invalid-config", "Configuration is not valid JSON.");
    }
    return parseDocument(parsed);
  }

  async saveProfile(name: string, profile: ProfileConfig): Promise<void> {
    const validatedName = validateProfileName(name);
    const normalized: ProfileConfig = {
      apiBaseUrl: normalizeApiBaseUrl(profile.apiBaseUrl).toString(),
      issuer: normalizeIssuerUrl(profile.issuer).toString(),
    };
    const current = await this.load();
    const document: ConfigDocument = {
      profiles: { ...current.profiles, [validatedName]: normalized },
      version: 1,
    };
    const directory = path.dirname(this.path);
    await mkdir(directory, { mode: 0o700, recursive: true });
    const temporaryPath = path.join(directory, `.config.${process.pid}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600).catch(() => undefined);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export interface ResolvedSettings {
  readonly apiBaseUrl?: URL;
  readonly issuer?: URL;
  readonly profile: string;
}

export interface SettingsOverrides {
  readonly apiBaseUrl?: string;
  readonly issuer?: string;
  readonly profile?: string;
}

export async function resolveSettings(
  repository: ConfigRepository,
  env: NodeJS.ProcessEnv,
  overrides: SettingsOverrides,
): Promise<ResolvedSettings> {
  const profile = validateProfileName(overrides.profile ?? env["UGA_PROFILE"] ?? "default");
  const document = await repository.load();
  const saved = document.profiles[profile];
  const apiBaseUrlValue = overrides.apiBaseUrl ?? env["UGA_API_BASE_URL"] ?? saved?.apiBaseUrl;
  const issuerValue = overrides.issuer ?? env["UGA_ISSUER"] ?? saved?.issuer;
  return {
    ...(apiBaseUrlValue === undefined ? {} : { apiBaseUrl: normalizeApiBaseUrl(apiBaseUrlValue) }),
    ...(issuerValue === undefined ? {} : { issuer: normalizeIssuerUrl(issuerValue) }),
    profile,
  };
}

export function requireApiBaseUrl(settings: ResolvedSettings): URL {
  if (settings.apiBaseUrl === undefined) {
    throw new CliError(
      ExitCode.config,
      "api-base-url-missing",
      "API base URL is missing. Run `uga init` or set UGA_API_BASE_URL.",
    );
  }
  return settings.apiBaseUrl;
}

export function requireIssuer(settings: ResolvedSettings): URL {
  if (settings.issuer === undefined) {
    throw new CliError(
      ExitCode.config,
      "issuer-missing",
      "OIDC issuer is missing. Run `uga init` or set UGA_ISSUER.",
    );
  }
  return settings.issuer;
}
