import {
  GopherClient,
  operationDefinitions,
  type OperationDefinition,
  type OperationId,
  type DpopPrivateJwk,
  type components,
} from "@umn-gopher-assistant/sdk";
import { Command, CommanderError, InvalidArgumentError } from "commander";

import { AuthManager } from "./auth.js";
import {
  ConfigRepository,
  requireApiBaseUrl,
  requireIssuer,
  resolveConfigPath,
  resolveSettings,
  type ResolvedSettings,
} from "./config.js";
import { CliError, normalizeCliError } from "./errors.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { limitResponseBody } from "./http.js";
import { type CliIo, CliOutput } from "./output.js";
import { abortableSleep, OidcClient, type Sleep } from "./oidc.js";
import { RawApiClient, type RawMethod } from "./raw-api.js";
import { NapiKeyringSecretStore, type SecretStore } from "./secret-store.js";
import { SocketCredentialRefreshLock } from "./refresh-lock.js";
import { CLI_VERSION } from "./version.js";

type CampusId = components["schemas"]["CampusId"];

const campusIds: readonly CampusId[] = ["tc", "duluth", "crookston", "morris", "rochester"];
const operationCatalog: Readonly<Record<OperationId, OperationDefinition>> = operationDefinitions;

interface GlobalOptions {
  readonly apiBaseUrl?: string;
  readonly issuer?: string;
  readonly json?: boolean;
  readonly profile?: string;
}

interface SourcesOptions {
  readonly campus?: CampusId;
  readonly cursor?: string;
  readonly limit?: number;
}

interface WorldOptions {
  readonly campus: CampusId;
}

interface CommandResult {
  readonly data: unknown;
  readonly human?: string;
  readonly profile: string | null;
}

export interface CliDependencies {
  readonly configPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
  readonly generateDpopPrivateJwk?: () => Promise<DpopPrivateJwk>;
  readonly io?: CliIo;
  readonly now?: () => number;
  readonly secretStore?: SecretStore;
  readonly signal?: AbortSignal;
  readonly sleep?: Sleep;
  readonly timeoutMs?: number;
}

export interface CliApplication {
  readonly program: Command;
  run(arguments_: readonly string[]): Promise<ExitCodeValue>;
}

function parseCampus(value: string): CampusId {
  if ((campusIds as readonly string[]).includes(value)) return value as CampusId;
  throw new InvalidArgumentError(`expected one of: ${campusIds.join(", ")}`);
}

function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError("expected an integer from 1 through 100");
  }
  return parsed;
}

function assertImplemented(operationId: OperationId): void {
  if (operationCatalog[operationId].runtimeStatus !== "implemented") {
    throw new CliError(
      ExitCode.internal,
      "command-contract-mismatch",
      "This CLI command is not backed by an implemented API operation.",
    );
  }
}

function isImplemented(operationId: OperationId): boolean {
  return operationCatalog[operationId].runtimeStatus === "implemented";
}

function settingsOverrides(options: GlobalOptions): {
  readonly apiBaseUrl?: string;
  readonly issuer?: string;
  readonly profile?: string;
} {
  return {
    ...(options.apiBaseUrl === undefined ? {} : { apiBaseUrl: options.apiBaseUrl }),
    ...(options.issuer === undefined ? {} : { issuer: options.issuer }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  };
}

function campusText(campuses: readonly components["schemas"]["Campus"][]): string {
  if (campuses.length === 0) return "No campuses returned.";
  return campuses
    .map((campus) => `${campus.id}\t${campus.name.en}\t${campus.city.en}\t${campus.officialStatus}`)
    .join("\n");
}

function sourceText(page: components["schemas"]["SourcePage"]): string {
  if (page.items.length === 0) return "No sources returned.";
  const sources = page.items as readonly components["schemas"]["SourceDescriptor"][];
  const lines = sources.map(
    (source) =>
      `${source.id}\t${source.campusIds.join(",")}\t${source.licenseStatus}\t${source.freshnessState}`,
  );
  if (page.nextCursor !== null) lines.push(`next cursor: ${page.nextCursor}`);
  return lines.join("\n");
}

function worldText(manifest: components["schemas"]["CampusWorldManifest"]): string {
  return [
    `${manifest.campusId} world ${manifest.worldVersion} (revision ${manifest.revision})`,
    `verification: ${manifest.verificationState}`,
    `tiles: ${manifest.tiles.length}; portals: ${manifest.portals.length}`,
    `generated: ${manifest.generatedAt}`,
  ].join("\n");
}

function jsonEnabled(arguments_: readonly string[]): boolean {
  return arguments_.includes("--json");
}

export function createCli(dependencies: CliDependencies = {}): CliApplication {
  const environment = dependencies.environment ?? process.env;
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const now = dependencies.now ?? Date.now;
  const io: CliIo = dependencies.io ?? { stderr: process.stderr, stdout: process.stdout };
  const output = new CliOutput(io);
  const repository = new ConfigRepository(
    dependencies.configPath ?? resolveConfigPath(environment, process.platform),
  );
  const http = {
    fetch: fetchImplementation,
    timeoutMs: dependencies.timeoutMs ?? 15_000,
  };
  const operationSignal = (): AbortSignal => {
    const timeout = AbortSignal.timeout(http.timeoutMs);
    return dependencies.signal === undefined ? timeout : AbortSignal.any([dependencies.signal, timeout]);
  };
  const sdkFetch: typeof fetch = async (input, init) => {
    try {
      return limitResponseBody(await fetchImplementation(input, init));
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(
        ExitCode.unavailable,
        "network-unavailable",
        "The remote service could not be reached.",
      );
    }
  };
  const oidc = new OidcClient({
    ...http,
    now,
    sleep: dependencies.sleep ?? abortableSleep,
  });
  const auth = new AuthManager({
    environment,
    ...(dependencies.generateDpopPrivateJwk === undefined
      ? {}
      : { generateDpopPrivateJwk: dependencies.generateDpopPrivateJwk }),
    now,
    oidc,
    refreshLock: new SocketCredentialRefreshLock(`config:${repository.path}`),
    secretStore: dependencies.secretStore ?? new NapiKeyringSecretStore(),
  });
  const program = new Command();
  let exitCode: ExitCodeValue = ExitCode.success;
  let activeProfile: string | null = null;
  let commanderStdout = "";
  let commanderStderr = "";

  const globalOptions = (): GlobalOptions => program.opts<GlobalOptions>();
  const currentSettings = async (): Promise<ResolvedSettings> => {
    const settings = await resolveSettings(repository, environment, settingsOverrides(globalOptions()));
    activeProfile = settings.profile;
    return settings;
  };
  const clientFor = (settings: ResolvedSettings): GopherClient => {
    const issuer = settings.issuer;
    return new GopherClient({
      ...(issuer === undefined
        ? {}
        : {
            dpopCredential: () => auth.getDpopCredential(settings.profile, issuer, dependencies.signal),
          }),
      baseUrl: requireApiBaseUrl(settings),
      fetch: sdkFetch,
    });
  };

  const execute = async (commandName: string, action: () => Promise<CommandResult>): Promise<void> => {
    try {
      const result = await action();
      output.success(commandName, result.data, { profile: result.profile }, result.human);
      exitCode = ExitCode.success;
    } catch (error) {
      const normalized = normalizeCliError(error);
      output.failure(commandName, normalized, { profile: activeProfile });
      exitCode = normalized.exitCode;
    }
  };

  program
    .name("uga")
    .description("Secure read-only client for implemented UMN Gopher Assistant API operations")
    .version(CLI_VERSION)
    .option("--json", "emit one stable JSON envelope to stdout")
    .option("--profile <name>", "configuration and keychain profile", environment["UGA_PROFILE"])
    .option("--api-base-url <url>", "override the profile API base URL")
    .option("--issuer <url>", "override the profile OIDC issuer")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeErr: (value) => {
        commanderStderr += value;
      },
      writeOut: (value) => {
        commanderStdout += value;
        if (!output.json) output.rawStdout(value);
      },
    });

  program
    .command("init")
    .description("save non-secret API and OIDC endpoints for a profile")
    .action(async () => {
      await execute("init", async () => {
        const settings = await currentSettings();
        const apiBaseUrl = requireApiBaseUrl(settings);
        const issuer = requireIssuer(settings);
        await repository.saveProfile(settings.profile, {
          apiBaseUrl: apiBaseUrl.toString(),
          issuer: issuer.toString(),
        });
        return {
          data: {
            apiBaseUrl: apiBaseUrl.toString(),
            configPath: repository.path,
            issuer: issuer.toString(),
            profile: settings.profile,
          },
          human: `Saved profile "${settings.profile}" to ${repository.path}`,
          profile: settings.profile,
        };
      });
    });

  program
    .command("doctor")
    .description("check configuration, authentication, API, and OIDC reachability")
    .action(async () => {
      await execute("doctor", async () => {
        const settings = await currentSettings();
        const authentication = await auth.status(settings.profile);
        let api: Readonly<Record<string, unknown>> = { reachable: false, status: "not-configured" };
        if (settings.apiBaseUrl !== undefined) {
          try {
            assertImplemented("getHealth");
            const response = await clientFor(settings).request("getHealth", { signal: operationSignal() });
            api = { data: response.data, reachable: true, status: response.status };
          } catch (error) {
            const normalized = normalizeCliError(error);
            api = { errorCode: normalized.code, reachable: false, status: "unavailable" };
          }
        }
        let identity: Readonly<Record<string, unknown>> = {
          reachable: false,
          status: "not-configured",
        };
        if (settings.issuer !== undefined) {
          try {
            await oidc.discover(settings.issuer, dependencies.signal);
            identity = { reachable: true, status: "discovered" };
          } catch (error) {
            const normalized = normalizeCliError(error);
            identity = { errorCode: normalized.code, reachable: false, status: "unavailable" };
          }
        }
        const data = {
          api,
          authentication,
          configured: settings.apiBaseUrl !== undefined && settings.issuer !== undefined,
          identity,
          pat: { implemented: false, status: "planned" },
          profile: settings.profile,
          version: CLI_VERSION,
        };
        return {
          data,
          human: [
            `profile: ${settings.profile}`,
            `configuration: ${data.configured ? "ready" : "incomplete"}`,
            `authentication: ${authentication.source}`,
            `API: ${String(api["status"])}`,
            `OIDC: ${String(identity["status"])}`,
            "PAT: planned (not implemented)",
          ].join("\n"),
          profile: settings.profile,
        };
      });
    });

  const authCommand = program.command("auth").description("manage RFC 8628 device authentication");
  authCommand
    .command("login")
    .description("authenticate with the configured OIDC issuer using the device flow")
    .action(async () => {
      await execute("auth.login", async () => {
        const settings = await currentSettings();
        const result = await auth.login(settings.profile, requireIssuer(settings), {
          ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
          verification: (authorization) => {
            const destination = authorization.verificationUriComplete ?? authorization.verificationUri;
            output.diagnostic(`Open ${destination.toString()} and enter code ${authorization.userCode}`);
          },
        });
        return {
          data: {
            authenticated: true,
            expiresAt: result.expiresAt,
            persisted: result.persisted,
            scope: result.scope,
          },
          human: `Authenticated; token storage: ${result.persisted}.`,
          profile: settings.profile,
        };
      });
    });
  authCommand
    .command("status")
    .description("show credential availability without printing credentials")
    .action(async () => {
      await execute("auth.status", async () => {
        const settings = await currentSettings();
        const status = await auth.status(settings.profile);
        return {
          data: { ...status, pat: { implemented: false, status: "planned" } },
          human: [
            `authentication: ${status.source}`,
            `available: ${String(status.available)}`,
            `refreshable: ${String(status.refreshable)}`,
            "PAT: planned (not implemented)",
          ].join("\n"),
          profile: settings.profile,
        };
      });
    });
  authCommand
    .command("logout")
    .description("delete this profile's keychain entry")
    .action(async () => {
      await execute("auth.logout", async () => {
        const settings = await currentSettings();
        const result = await auth.logout(settings.profile);
        return {
          data: result,
          human: result.removed
            ? result.environmentTokenStillSet
              ? "Stored credentials removed. UGA_ACCESS_TOKEN remains set in the environment."
              : "Stored credentials removed."
            : result.environmentTokenStillSet
              ? "No stored keychain credentials were found. UGA_ACCESS_TOKEN remains set in the environment."
              : "No stored credentials were found.",
          profile: settings.profile,
        };
      });
    });

  if (isImplemented("listCampuses")) {
    program
      .command("campuses")
      .description("discover supported campuses")
      .command("list")
      .description("list all five supported campuses")
      .action(async () => {
        await execute("campuses.list", async () => {
          const settings = await currentSettings();
          assertImplemented("listCampuses");
          const response = await clientFor(settings).request("listCampuses", { signal: operationSignal() });
          if (response.notModified) {
            throw new CliError(
              ExitCode.protocol,
              "unexpected-not-modified",
              "The API returned an unusable 304.",
            );
          }
          return {
            data: response.data,
            human: campusText(response.data),
            profile: settings.profile,
          };
        });
      });
  }

  if (isImplemented("listSources")) {
    program
      .command("sources")
      .description("inspect provenance and connector policy")
      .command("list")
      .description("list source descriptors with bounded cursor pagination")
      .option("--campus <campus>", "filter by campus", parseCampus)
      .option("--cursor <cursor>", "continue from an opaque server cursor")
      .option("--limit <count>", "return 1-100 sources", parseLimit, 20)
      .action(async (options: SourcesOptions) => {
        await execute("sources.list", async () => {
          const settings = await currentSettings();
          assertImplemented("listSources");
          const query = {
            ...(options.campus === undefined ? {} : { campusId: options.campus }),
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
            ...(options.limit === undefined ? {} : { limit: options.limit }),
          };
          const response = await clientFor(settings).request("listSources", {
            query,
            signal: operationSignal(),
          });
          if (response.notModified) {
            throw new CliError(
              ExitCode.protocol,
              "unexpected-not-modified",
              "The API returned an unusable 304.",
            );
          }
          return {
            data: response.data,
            human: sourceText(response.data),
            profile: settings.profile,
          };
        });
      });
  }

  if (isImplemented("getWorldManifest")) {
    program
      .command("world")
      .description("inspect published schematic campus worlds")
      .command("manifest")
      .description("read a campus world manifest and its verification state")
      .requiredOption("--campus <campus>", "campus identifier", parseCampus)
      .action(async (options: WorldOptions) => {
        await execute("world.manifest", async () => {
          const settings = await currentSettings();
          assertImplemented("getWorldManifest");
          const response = await clientFor(settings).request("getWorldManifest", {
            path: { campusId: options.campus },
            signal: operationSignal(),
          });
          if (response.notModified) {
            throw new CliError(
              ExitCode.protocol,
              "unexpected-not-modified",
              "The API returned an unusable 304.",
            );
          }
          return {
            data: response.data,
            human: worldText(response.data),
            profile: settings.profile,
          };
        });
      });
  }

  const request = program
    .command("request")
    .description("read an implemented /v1 path; only GET and HEAD are accepted");
  const addRawCommand = (verb: "get" | "head", method: RawMethod): void => {
    request
      .command(`${verb} <path>`)
      .description(`${method} an implemented OpenAPI path without following redirects`)
      .action(async (path: string) => {
        await execute(`request.${verb}`, async () => {
          const settings = await currentSettings();
          const issuer = settings.issuer;
          const raw = new RawApiClient({
            credential: async () => {
              if (issuer === undefined) {
                throw new CliError(
                  ExitCode.config,
                  "issuer-missing",
                  "OIDC issuer is required for authentication.",
                );
              }
              return auth.getDpopCredential(settings.profile, issuer, dependencies.signal);
            },
            baseUrl: requireApiBaseUrl(settings),
            http,
          });
          const response = await raw.request(method, path, dependencies.signal);
          return {
            data: response,
            human: JSON.stringify(response, null, 2),
            profile: settings.profile,
          };
        });
      });
  };
  addRawCommand("get", "GET");
  addRawCommand("head", "HEAD");

  return {
    program,
    async run(arguments_: readonly string[]): Promise<ExitCodeValue> {
      output.setJson(jsonEnabled(arguments_));
      exitCode = ExitCode.success;
      activeProfile = globalOptions().profile ?? environment["UGA_PROFILE"] ?? "default";
      commanderStdout = "";
      commanderStderr = "";
      try {
        await program.parseAsync([...arguments_], { from: "user" });
        return exitCode;
      } catch (error) {
        if (error instanceof CommanderError) {
          if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
            if (output.json) {
              output.success(
                error.code === "commander.version" ? "version" : "help",
                error.code === "commander.version"
                  ? { version: commanderStdout.trim() }
                  : { text: commanderStdout },
                { profile: activeProfile },
              );
            }
            return ExitCode.success;
          }
          activeProfile = program.opts<GlobalOptions>().profile ?? environment["UGA_PROFILE"] ?? "default";
          const message = error.message || commanderStderr.trim() || "Invalid command usage.";
          const usageError = new CliError(ExitCode.usage, "invalid-usage", message);
          output.failure("usage", usageError, { profile: activeProfile });
          return ExitCode.usage;
        }
        const normalized = normalizeCliError(error);
        output.failure("uga", normalized, { profile: activeProfile });
        return normalized.exitCode;
      }
    },
  };
}
