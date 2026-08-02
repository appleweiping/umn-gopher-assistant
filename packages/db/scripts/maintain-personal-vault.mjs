#!/usr/bin/env node

import { checkServerIdentity } from "node:tls";

import postgres from "postgres";

const applyConfirmation = "APPLY_PERSONAL_VAULT_EPHEMERA_RETENTION";
const maximumBatchSize = 5000;

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  if (normalized === "" || normalized === "localhost" || normalized === "::1") return true;
  if (!normalized.startsWith("127.")) return false;
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
  );
}

function validateDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PERSONAL_VAULT_MAINTENANCE_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("PERSONAL_VAULT_MAINTENANCE_DATABASE_URL must use postgresql://");
  }
  const sslModes = url.searchParams.getAll("sslmode");
  if (sslModes.length > 1) {
    throw new Error("PERSONAL_VAULT_MAINTENANCE_DATABASE_URL permits at most one sslmode parameter");
  }
  if (!isLoopbackHostname(url.hostname) && sslModes[0] !== "verify-full") {
    throw new Error("Non-loopback PERSONAL_VAULT_MAINTENANCE_DATABASE_URL must use sslmode=verify-full");
  }
  return {
    hostname: url.hostname.toLowerCase().replace(/^\[(.*)\]$/u, "$1"),
    loopback: isLoopbackHostname(url.hostname),
  };
}

function usage() {
  return [
    "Usage:",
    "  pnpm maintain:personal-vault [--dry-run] [--batch-size 500]",
    `  pnpm maintain:personal-vault --apply --confirm ${applyConfirmation} [--batch-size 500]`,
    "  pnpm maintain:personal-vault --check-configuration",
    "",
    "PERSONAL_VAULT_MAINTENANCE_DATABASE_URL is required. Dry-run is the default.",
  ].join("\n");
}

function parseArguments(arguments_) {
  let apply = false;
  let checkConfiguration = false;
  let confirmation;
  let batchSize = 500;
  let sawBatchSize = false;
  let sawApply = false;
  let sawDryRun = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--apply") {
      sawApply = true;
      apply = true;
      continue;
    }
    if (argument === "--check-configuration") {
      checkConfiguration = true;
      continue;
    }
    if (argument === "--dry-run") {
      sawDryRun = true;
      apply = false;
      continue;
    }
    if (argument === "--confirm") {
      confirmation = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument?.startsWith("--confirm=")) {
      confirmation = argument.slice("--confirm=".length);
      continue;
    }
    if (argument === "--batch-size") {
      sawBatchSize = true;
      batchSize = Number(arguments_[index + 1]);
      index += 1;
      continue;
    }
    if (argument?.startsWith("--batch-size=")) {
      sawBatchSize = true;
      batchSize = Number(argument.slice("--batch-size=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? ""}`);
  }

  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > maximumBatchSize) {
    throw new Error(`--batch-size must be an integer between 1 and ${String(maximumBatchSize)}`);
  }
  if (sawApply && sawDryRun) {
    throw new Error("--apply and --dry-run are mutually exclusive");
  }
  if (apply && confirmation !== applyConfirmation) {
    throw new Error(`--apply requires --confirm ${applyConfirmation}`);
  }
  if (!apply && confirmation !== undefined) {
    throw new Error("--confirm is accepted only with --apply");
  }
  if (checkConfiguration && (sawApply || sawDryRun || sawBatchSize || confirmation !== undefined)) {
    throw new Error("--check-configuration cannot be combined with maintenance execution arguments");
  }

  return { apply, batchSize, checkConfiguration, help: false };
}

function safeErrorCode(error) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Za-z0-9_-]{1,32}$/u.test(error.code)
  ) {
    return error.code;
  }
  return "UNCLASSIFIED";
}

async function run() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const databaseUrl = process.env["PERSONAL_VAULT_MAINTENANCE_DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    process.stderr.write(
      "PERSONAL_VAULT_MAINTENANCE_DATABASE_URL is required; no development or API-role fallback is used.\n",
    );
    process.exitCode = 2;
    return;
  }
  let databaseConfiguration;
  try {
    databaseConfiguration = validateDatabaseUrl(databaseUrl);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid database URL"}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.checkConfiguration) {
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        status: "valid",
        transport: databaseConfiguration.loopback ? "loopback-development" : "verify-full",
      })}\n`,
    );
    return;
  }

  let database;
  try {
    database = postgres(databaseUrl, {
      application_name: "gopher-personal-vault-maintenance",
      connect_timeout: 10,
      idle_timeout: 5,
      max: 1,
      prepare: false,
      ...(databaseConfiguration.loopback
        ? {}
        : {
            ssl: {
              checkServerIdentity: (driverHostname, certificate) => {
                void driverHostname;
                return checkServerIdentity(databaseConfiguration.hostname, certificate);
              },
              rejectUnauthorized: true,
            },
          }),
    });
    const rows = await database`
      SELECT
        maintenance_run_id AS "maintenanceRunId",
        mode,
        observed_at AS "observedAt",
        command_retention_cutoff AS "commandRetentionCutoff",
        pairing_retention_cutoff AS "pairingRetentionCutoff",
        pending_pairings_eligible AS "pendingPairingsEligible",
        pending_pairings_expired AS "pendingPairingsExpired",
        completed_commands_eligible AS "completedCommandsEligible",
        completed_commands_deleted AS "completedCommandsDeleted",
        terminal_pairings_eligible AS "terminalPairingsEligible",
        terminal_pairings_deleted AS "terminalPairingsDeleted",
        stale_pending_commands_observed AS "stalePendingCommandsObserved",
        pending_pairings_remaining AS "pendingPairingsRemaining",
        completed_commands_remaining AS "completedCommandsRemaining",
        terminal_pairings_remaining AS "terminalPairingsRemaining",
        stale_pending_commands_remaining AS "stalePendingCommandsRemaining"
      FROM public.maintain_personal_vault_ephemera(
        ${!options.apply}::boolean,
        ${options.batchSize}::integer
      )
    `;
    const result = rows[0];
    if (result === undefined) {
      throw new Error("Maintenance function returned no result");
    }
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        ...result,
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Personal-vault maintenance failed (code=${safeErrorCode(error)}); inspect protected database and scheduler logs.\n`,
    );
    process.exitCode = 1;
  } finally {
    if (database !== undefined) {
      try {
        await database.end({ timeout: 5 });
      } catch {
        // Never let a driver shutdown error escape through Node's default
        // formatter, which could include connection configuration.
      }
    }
  }
}

await run();
