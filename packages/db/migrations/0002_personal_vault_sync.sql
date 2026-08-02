CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."personal_vault_command_actor_kind" AS ENUM('account', 'device', 'recovery');--> statement-breakpoint
CREATE TYPE "public"."personal_vault_command_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."personal_vault_device_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."personal_vault_pairing_state" AS ENUM('pending', 'approved', 'consumed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "account_identity_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"identity_hmac" "bytea" NOT NULL,
	"hmac_key_version" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "account_identity_keys_hmac_check" CHECK (octet_length("account_identity_keys"."identity_hmac") = 32 AND "account_identity_keys"."hmac_key_version" BETWEEN 1 AND 32767),
	CONSTRAINT "account_identity_keys_lifecycle_check" CHECK ("account_identity_keys"."retired_at" IS NULL OR "account_identity_keys"."retired_at" >= "account_identity_keys"."created_at")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_binding" "bytea" DEFAULT gen_random_bytes(32) NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_lifecycle_check" CHECK (("accounts"."status" IN ('active', 'suspended') AND "accounts"."deleted_at" IS NULL) OR ("accounts"."status" = 'deleted' AND "accounts"."deleted_at" IS NOT NULL AND "accounts"."deleted_at" >= "accounts"."created_at")),
	CONSTRAINT "accounts_owner_binding_check" CHECK (octet_length("accounts"."owner_binding") = 32)
);
--> statement-breakpoint
CREATE TABLE "personal_vault_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_kind" "personal_vault_command_actor_kind" NOT NULL,
	"actor_key_id" uuid,
	"request_hash" text NOT NULL,
	"status" "personal_vault_command_status" DEFAULT 'pending' NOT NULL,
	"response_body" jsonb,
	"response_etag" text,
	"response_revision" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "personal_vault_commands_request_check" CHECK (char_length("personal_vault_commands"."idempotency_key") BETWEEN 16 AND 128 AND "personal_vault_commands"."idempotency_key" !~ '[[:space:]]' AND "personal_vault_commands"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "personal_vault_commands_actor_check" CHECK (("personal_vault_commands"."actor_kind" = 'account' AND "personal_vault_commands"."actor_key_id" IS NULL) OR ("personal_vault_commands"."actor_kind" IN ('device', 'recovery') AND "personal_vault_commands"."actor_key_id" IS NOT NULL)),
	CONSTRAINT "personal_vault_commands_lifecycle_check" CHECK (("personal_vault_commands"."status" = 'pending' AND "personal_vault_commands"."completed_at" IS NULL AND "personal_vault_commands"."response_body" IS NULL AND "personal_vault_commands"."response_etag" IS NULL AND "personal_vault_commands"."response_revision" IS NULL) OR ("personal_vault_commands"."status" = 'succeeded' AND "personal_vault_commands"."completed_at" IS NOT NULL AND "personal_vault_commands"."response_body" IS NOT NULL AND char_length(btrim("personal_vault_commands"."response_etag")) > 0 AND "personal_vault_commands"."response_revision" BETWEEN 1 AND 9007199254740991) OR ("personal_vault_commands"."status" = 'failed' AND "personal_vault_commands"."completed_at" IS NOT NULL AND "personal_vault_commands"."response_body" IS NOT NULL AND "personal_vault_commands"."response_etag" IS NULL AND ("personal_vault_commands"."response_revision" IS NULL OR "personal_vault_commands"."response_revision" BETWEEN 1 AND 9007199254740991)))
);
--> statement-breakpoint
CREATE TABLE "personal_vault_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"parent_commit_id" uuid,
	"payload_id" uuid NOT NULL,
	"keyring_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"wire_payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"byte_length" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_vault_commits_revision_check" CHECK ("personal_vault_commits"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "personal_vault_commits_hash_size_check" CHECK ("personal_vault_commits"."content_hash" ~ '^[a-f0-9]{64}$' AND "personal_vault_commits"."byte_length" BETWEEN 1 AND 1048576 AND jsonb_typeof("personal_vault_commits"."wire_payload") = 'object'),
	CONSTRAINT "personal_vault_commits_parent_check" CHECK (("personal_vault_commits"."revision" = 1 AND "personal_vault_commits"."parent_commit_id" IS NULL) OR ("personal_vault_commits"."revision" > 1 AND "personal_vault_commits"."parent_commit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "personal_vault_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"wrapping_public_key" jsonb NOT NULL,
	"signing_public_key" jsonb NOT NULL,
	"key_digest" "bytea" NOT NULL,
	"status" "personal_vault_device_status" DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "personal_vault_devices_keys_check" CHECK (octet_length("personal_vault_devices"."key_digest") = 32 AND jsonb_typeof("personal_vault_devices"."wrapping_public_key") = 'object' AND jsonb_typeof("personal_vault_devices"."signing_public_key") = 'object'),
	CONSTRAINT "personal_vault_devices_lifecycle_check" CHECK (("personal_vault_devices"."status" = 'active' AND "personal_vault_devices"."revoked_at" IS NULL) OR ("personal_vault_devices"."status" = 'revoked' AND "personal_vault_devices"."revoked_at" IS NOT NULL AND "personal_vault_devices"."revoked_at" >= "personal_vault_devices"."created_at")),
	CONSTRAINT "personal_vault_devices_last_seen_check" CHECK ("personal_vault_devices"."last_seen_at" IS NULL OR "personal_vault_devices"."last_seen_at" >= "personal_vault_devices"."created_at")
);
--> statement-breakpoint
CREATE TABLE "personal_vault_keyrings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"wire_payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"byte_length" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_vault_keyrings_revision_check" CHECK ("personal_vault_keyrings"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "personal_vault_keyrings_hash_size_check" CHECK ("personal_vault_keyrings"."content_hash" ~ '^[a-f0-9]{64}$' AND "personal_vault_keyrings"."byte_length" BETWEEN 1 AND 262144 AND jsonb_typeof("personal_vault_keyrings"."wire_payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "personal_vault_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"wire_payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"byte_length" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_vault_manifests_revision_check" CHECK ("personal_vault_manifests"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "personal_vault_manifests_hash_size_check" CHECK ("personal_vault_manifests"."content_hash" ~ '^[a-f0-9]{64}$' AND "personal_vault_manifests"."byte_length" BETWEEN 1 AND 1048576 AND jsonb_typeof("personal_vault_manifests"."wire_payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "personal_vault_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"requesting_device_id" uuid NOT NULL,
	"approving_device_id" uuid,
	"state" "personal_vault_pairing_state" DEFAULT 'pending' NOT NULL,
	"code_digest" "bytea" NOT NULL,
	"request_payload" jsonb NOT NULL,
	"response_payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_vault_pairings_payload_check" CHECK (octet_length("personal_vault_pairings"."code_digest") = 32 AND jsonb_typeof("personal_vault_pairings"."request_payload") = 'object' AND ("personal_vault_pairings"."response_payload" IS NULL OR jsonb_typeof("personal_vault_pairings"."response_payload") = 'object')),
	CONSTRAINT "personal_vault_pairings_lifecycle_check" CHECK ("personal_vault_pairings"."expires_at" > "personal_vault_pairings"."created_at" AND (("personal_vault_pairings"."state" = 'pending' AND "personal_vault_pairings"."approving_device_id" IS NULL AND "personal_vault_pairings"."response_payload" IS NULL AND "personal_vault_pairings"."consumed_at" IS NULL) OR ("personal_vault_pairings"."state" = 'approved' AND "personal_vault_pairings"."response_payload" IS NOT NULL AND "personal_vault_pairings"."consumed_at" IS NULL) OR ("personal_vault_pairings"."state" = 'consumed' AND "personal_vault_pairings"."response_payload" IS NOT NULL AND "personal_vault_pairings"."consumed_at" IS NOT NULL AND "personal_vault_pairings"."consumed_at" >= "personal_vault_pairings"."created_at") OR ("personal_vault_pairings"."state" IN ('expired', 'cancelled') AND "personal_vault_pairings"."consumed_at" IS NULL))),
	CONSTRAINT "personal_vault_pairings_distinct_devices_check" CHECK ("personal_vault_pairings"."approving_device_id" IS NULL OR "personal_vault_pairings"."approving_device_id" <> "personal_vault_pairings"."requesting_device_id")
);
--> statement-breakpoint
CREATE TABLE "personal_vault_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"wire_payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"byte_length" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_vault_payloads_revision_check" CHECK ("personal_vault_payloads"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "personal_vault_payloads_hash_size_check" CHECK ("personal_vault_payloads"."content_hash" ~ '^[a-f0-9]{64}$' AND "personal_vault_payloads"."byte_length" BETWEEN 4112 AND 8388624 AND ("personal_vault_payloads"."byte_length" - 16) % 4096 = 0 AND jsonb_typeof("personal_vault_payloads"."wire_payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "personal_vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"current_revision" bigint DEFAULT 0 NOT NULL,
	"current_payload_id" uuid,
	"current_keyring_id" uuid,
	"current_manifest_id" uuid,
	"head_commit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_vaults_revision_check" CHECK ("personal_vaults"."current_revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "personal_vaults_head_lifecycle_check" CHECK (("personal_vaults"."current_revision" = 0 AND "personal_vaults"."current_payload_id" IS NULL AND "personal_vaults"."current_keyring_id" IS NULL AND "personal_vaults"."current_manifest_id" IS NULL AND "personal_vaults"."head_commit_id" IS NULL) OR ("personal_vaults"."current_revision" BETWEEN 1 AND 9007199254740991 AND "personal_vaults"."current_payload_id" IS NOT NULL AND "personal_vaults"."current_keyring_id" IS NOT NULL AND "personal_vaults"."current_manifest_id" IS NOT NULL AND "personal_vaults"."head_commit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_commits_id_account_vault_uidx" ON "personal_vault_commits" USING btree ("id","account_id","vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_devices_id_account_vault_uidx" ON "personal_vault_devices" USING btree ("id","account_id","vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_keyrings_id_account_vault_uidx" ON "personal_vault_keyrings" USING btree ("id","account_id","vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_manifests_id_account_vault_uidx" ON "personal_vault_manifests" USING btree ("id","account_id","vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_payloads_id_account_vault_uidx" ON "personal_vault_payloads" USING btree ("id","account_id","vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vaults_id_account_uidx" ON "personal_vaults" USING btree ("id","account_id");--> statement-breakpoint
ALTER TABLE "account_identity_keys" ADD CONSTRAINT "account_identity_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_commands" ADD CONSTRAINT "personal_vault_commands_vault_account_fk" FOREIGN KEY ("vault_id","account_id") REFERENCES "public"."personal_vaults"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_commits" ADD CONSTRAINT "personal_vault_commits_vault_account_fk" FOREIGN KEY ("vault_id","account_id") REFERENCES "public"."personal_vaults"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_commits" ADD CONSTRAINT "personal_vault_commits_parent_fk" FOREIGN KEY ("parent_commit_id","account_id","vault_id") REFERENCES "public"."personal_vault_commits"("id","account_id","vault_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_commits" ADD CONSTRAINT "personal_vault_commits_payload_fk" FOREIGN KEY ("payload_id","account_id","vault_id") REFERENCES "public"."personal_vault_payloads"("id","account_id","vault_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_commits" ADD CONSTRAINT "personal_vault_commits_keyring_fk" FOREIGN KEY ("keyring_id","account_id","vault_id") REFERENCES "public"."personal_vault_keyrings"("id","account_id","vault_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_commits" ADD CONSTRAINT "personal_vault_commits_manifest_fk" FOREIGN KEY ("manifest_id","account_id","vault_id") REFERENCES "public"."personal_vault_manifests"("id","account_id","vault_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_devices" ADD CONSTRAINT "personal_vault_devices_vault_account_fk" FOREIGN KEY ("vault_id","account_id") REFERENCES "public"."personal_vaults"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_keyrings" ADD CONSTRAINT "personal_vault_keyrings_vault_account_fk" FOREIGN KEY ("vault_id","account_id") REFERENCES "public"."personal_vaults"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_manifests" ADD CONSTRAINT "personal_vault_manifests_vault_account_fk" FOREIGN KEY ("vault_id","account_id") REFERENCES "public"."personal_vaults"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_pairings" ADD CONSTRAINT "personal_vault_pairings_vault_account_fk" FOREIGN KEY ("vault_id","account_id") REFERENCES "public"."personal_vaults"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_pairings" ADD CONSTRAINT "personal_vault_pairings_approving_device_fk" FOREIGN KEY ("approving_device_id","account_id","vault_id") REFERENCES "public"."personal_vault_devices"("id","account_id","vault_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault_payloads" ADD CONSTRAINT "personal_vault_payloads_vault_account_fk" FOREIGN KEY ("vault_id","account_id") REFERENCES "public"."personal_vaults"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vaults" ADD CONSTRAINT "personal_vaults_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vaults" ADD CONSTRAINT "personal_vaults_current_payload_fk" FOREIGN KEY ("current_payload_id","account_id","id") REFERENCES "public"."personal_vault_payloads"("id","account_id","vault_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vaults" ADD CONSTRAINT "personal_vaults_current_keyring_fk" FOREIGN KEY ("current_keyring_id","account_id","id") REFERENCES "public"."personal_vault_keyrings"("id","account_id","vault_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vaults" ADD CONSTRAINT "personal_vaults_current_manifest_fk" FOREIGN KEY ("current_manifest_id","account_id","id") REFERENCES "public"."personal_vault_manifests"("id","account_id","vault_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vaults" ADD CONSTRAINT "personal_vaults_head_commit_fk" FOREIGN KEY ("head_commit_id","account_id","id") REFERENCES "public"."personal_vault_commits"("id","account_id","vault_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_identity_keys_hmac_uidx" ON "account_identity_keys" USING btree ("hmac_key_version","identity_hmac");--> statement-breakpoint
CREATE UNIQUE INDEX "account_identity_keys_account_version_uidx" ON "account_identity_keys" USING btree ("account_id","hmac_key_version");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_id_uidx" ON "accounts" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_owner_binding_uidx" ON "accounts" USING btree ("owner_binding");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_commands_id_account_vault_uidx" ON "personal_vault_commands" USING btree ("id","account_id","vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_commands_idempotency_uidx" ON "personal_vault_commands" USING btree ("account_id","vault_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_commits_vault_revision_uidx" ON "personal_vault_commits" USING btree ("account_id","vault_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_devices_key_uidx" ON "personal_vault_devices" USING btree ("account_id","vault_id","key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_devices_digest_uidx" ON "personal_vault_devices" USING btree ("account_id","vault_id","key_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_keyrings_vault_revision_uidx" ON "personal_vault_keyrings" USING btree ("account_id","vault_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_manifests_vault_revision_uidx" ON "personal_vault_manifests" USING btree ("account_id","vault_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_pairings_id_account_vault_uidx" ON "personal_vault_pairings" USING btree ("id","account_id","vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_pairings_code_digest_uidx" ON "personal_vault_pairings" USING btree ("account_id","vault_id","code_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vault_payloads_vault_revision_uidx" ON "personal_vault_payloads" USING btree ("account_id","vault_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_vaults_account_uidx" ON "personal_vaults" USING btree ("account_id");
--> statement-breakpoint
COMMENT ON TABLE "accounts" IS 'owner: core-api; opaque account lifecycle and random stable owner binding with no subject, email, profile, or personal-record metadata';
--> statement-breakpoint
COMMENT ON TABLE "account_identity_keys" IS 'owner: core-api; server-keyed 32-byte identity HMACs only; raw issuer and subject are never persisted';
--> statement-breakpoint
COMMENT ON TABLE "personal_vaults" IS 'owner: core-api; tenant-bound pointers to the current opaque encrypted vault commit';
--> statement-breakpoint
COMMENT ON TABLE "personal_vault_payloads" IS 'owner: core-api; immutable client-encrypted padded payload envelopes without plaintext record metadata';
--> statement-breakpoint
COMMENT ON TABLE "personal_vault_keyrings" IS 'owner: core-api; immutable client-produced device and recovery key envelopes';
--> statement-breakpoint
COMMENT ON TABLE "personal_vault_manifests" IS 'owner: core-api; immutable authenticated synchronization manifests';
--> statement-breakpoint
COMMENT ON TABLE "personal_vault_commits" IS 'owner: core-api; immutable authenticated commit chain joining payload, keyring, and manifest revisions';
--> statement-breakpoint
COMMENT ON TABLE "personal_vault_devices" IS 'owner: core-api; public device key descriptors and verified 32-byte signing-key fingerprints only';
--> statement-breakpoint
COMMENT ON TABLE "personal_vault_pairings" IS 'owner: core-api; short-lived encrypted device-pairing state keyed by a client SHA-256 commitment digest';
--> statement-breakpoint
COMMENT ON COLUMN "personal_vault_pairings"."requesting_device_id" IS 'pending requester identity authenticated inside request_payload; no device row exists until approval';
--> statement-breakpoint
COMMENT ON TABLE "personal_vault_commands" IS 'owner: core-api; bounded idempotency result ledger without decrypted command content';
--> statement-breakpoint
CREATE FUNCTION "resolve_personal_account"(
  p_current_identity_hmac bytea,
  p_current_hmac_key_version smallint,
  p_previous_identity_hmac bytea DEFAULT NULL,
  p_previous_hmac_key_version smallint DEFAULT NULL
) RETURNS TABLE(account_id uuid, owner_binding bytea)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  candidate_account_id uuid := pg_catalog.gen_random_uuid();
  current_lock_key bigint;
  previous_lock_key bigint;
  current_identity_found boolean := false;
  previous_identity_found boolean := false;
  resolved_account_id uuid;
  resolved_owner_binding bytea;
  resolved_account_status public.account_status;
  resolved_identity_retired_at timestamptz;
  previous_account_id uuid;
  previous_owner_binding bytea;
  previous_account_status public.account_status;
  previous_identity_retired_at timestamptz;
BEGIN
  IF p_current_identity_hmac IS NULL
    OR pg_catalog.octet_length(p_current_identity_hmac) <> 32 THEN
    RAISE EXCEPTION 'current identity HMAC must contain exactly 32 bytes'
      USING ERRCODE = '22023';
  END IF;
  IF p_current_hmac_key_version IS NULL
    OR p_current_hmac_key_version NOT BETWEEN 1 AND 32767 THEN
    RAISE EXCEPTION 'current identity HMAC key version is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF (p_previous_identity_hmac IS NULL) <> (p_previous_hmac_key_version IS NULL) THEN
    RAISE EXCEPTION 'previous identity HMAC and key version must be provided together'
      USING ERRCODE = '22023';
  END IF;

  IF p_previous_identity_hmac IS NOT NULL THEN
    IF pg_catalog.octet_length(p_previous_identity_hmac) <> 32 THEN
      RAISE EXCEPTION 'previous identity HMAC must contain exactly 32 bytes'
        USING ERRCODE = '22023';
    END IF;
    IF p_previous_hmac_key_version NOT BETWEEN 1 AND 32767
      OR p_current_hmac_key_version <= p_previous_hmac_key_version THEN
      RAISE EXCEPTION 'identity HMAC rotation requires an increasing key version'
        USING ERRCODE = '22023';
    END IF;
    IF p_current_identity_hmac = p_previous_identity_hmac THEN
      RAISE EXCEPTION 'current and previous identity HMACs must differ'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Old two-argument instances and new rotation-aware instances share the
  -- lock derived from each identity digest/version. Pair locks are always
  -- acquired in numeric order, preventing rolling deployments from splitting
  -- one OIDC identity into separate accounts or deadlocking on reversed work.
  current_lock_key := pg_catalog.hashtextextended(
    'gopher:account-identity:v1:'
      || p_current_hmac_key_version::text
      || ':'
      || pg_catalog.encode(p_current_identity_hmac, 'hex'),
    0
  );
  IF p_previous_identity_hmac IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(current_lock_key);
  ELSE
    previous_lock_key := pg_catalog.hashtextextended(
      'gopher:account-identity:v1:'
        || p_previous_hmac_key_version::text
        || ':'
        || pg_catalog.encode(p_previous_identity_hmac, 'hex'),
      0
    );
    IF current_lock_key <= previous_lock_key THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(current_lock_key);
      IF current_lock_key <> previous_lock_key THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(previous_lock_key);
      END IF;
    ELSE
      PERFORM pg_catalog.pg_advisory_xact_lock(previous_lock_key);
      PERFORM pg_catalog.pg_advisory_xact_lock(current_lock_key);
    END IF;
  END IF;

  SELECT identity_key.account_id,
         identity_key.retired_at,
         account.status,
         account.owner_binding
  INTO resolved_account_id,
       resolved_identity_retired_at,
       resolved_account_status,
       resolved_owner_binding
  FROM public.account_identity_keys AS identity_key
  JOIN public.accounts AS account ON account.id = identity_key.account_id
  WHERE identity_key.hmac_key_version = p_current_hmac_key_version
    AND identity_key.identity_hmac = p_current_identity_hmac
  FOR UPDATE OF identity_key, account;
  current_identity_found := FOUND;

  IF p_previous_identity_hmac IS NOT NULL THEN
    SELECT identity_key.account_id,
           identity_key.retired_at,
           account.status,
           account.owner_binding
    INTO previous_account_id,
         previous_identity_retired_at,
         previous_account_status,
         previous_owner_binding
    FROM public.account_identity_keys AS identity_key
    JOIN public.accounts AS account ON account.id = identity_key.account_id
    WHERE identity_key.hmac_key_version = p_previous_hmac_key_version
      AND identity_key.identity_hmac = p_previous_identity_hmac
    FOR UPDATE OF identity_key, account;
    previous_identity_found := FOUND;
  END IF;

  IF current_identity_found THEN
    IF resolved_identity_retired_at IS NOT NULL OR resolved_account_status <> 'active' THEN
      RAISE EXCEPTION 'current personal account identity is not active'
        USING ERRCODE = '28000';
    END IF;
    IF previous_identity_found AND previous_account_id <> resolved_account_id THEN
      RAISE EXCEPTION 'current and previous identity HMACs map to different accounts'
        USING ERRCODE = '23505';
    END IF;

    -- A valid current mapping is authoritative. A missing or retired previous
    -- mapping is expected after a completed rotation and must not break login.
    RETURN QUERY SELECT resolved_account_id, resolved_owner_binding;
    RETURN;
  END IF;

  IF previous_identity_found THEN
    IF previous_identity_retired_at IS NOT NULL OR previous_account_status <> 'active' THEN
      RAISE EXCEPTION 'previous personal account identity is not active'
        USING ERRCODE = '28000';
    END IF;

    -- Attach the new digest to the locked active account. The global digest
    -- uniqueness and per-account/version uniqueness fail closed on a collision
    -- or two differently configured current keys.
    BEGIN
      INSERT INTO public.account_identity_keys (
        account_id,
        identity_hmac,
        hmac_key_version
      ) VALUES (
        previous_account_id,
        p_current_identity_hmac,
        p_current_hmac_key_version
      )
      ON CONFLICT (hmac_key_version, identity_hmac)
      DO UPDATE SET identity_hmac = EXCLUDED.identity_hmac
      RETURNING account_identity_keys.account_id, account_identity_keys.retired_at
      INTO resolved_account_id, resolved_identity_retired_at;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'account already has a different identity HMAC for current key version'
          USING ERRCODE = '23505';
    END;

    IF resolved_account_id <> previous_account_id THEN
      RAISE EXCEPTION 'current identity HMAC is already bound to another account'
        USING ERRCODE = '23505';
    END IF;
    IF resolved_identity_retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'current personal account identity is not active'
        USING ERRCODE = '28000';
    END IF;

    RETURN QUERY SELECT previous_account_id, previous_owner_binding;
    RETURN;
  END IF;

  -- No mapping exists. This is a safe first login even when a new instance
  -- supplied a previous digest: create the account from the current identity
  -- and also bind the previous digest so an old two-argument instance running
  -- concurrently resolves to the same account during a rolling deployment.
  INSERT INTO public.accounts (id)
  VALUES (candidate_account_id);

  INSERT INTO public.account_identity_keys (
    account_id,
    identity_hmac,
    hmac_key_version
  ) VALUES (
    candidate_account_id,
    p_current_identity_hmac,
    p_current_hmac_key_version
  )
  ON CONFLICT (hmac_key_version, identity_hmac)
  DO UPDATE SET identity_hmac = EXCLUDED.identity_hmac
  RETURNING account_identity_keys.account_id, account_identity_keys.retired_at
  INTO resolved_account_id, resolved_identity_retired_at;

  IF resolved_account_id <> candidate_account_id THEN
    DELETE FROM public.accounts WHERE id = candidate_account_id;
  END IF;

  SELECT status, accounts.owner_binding
  INTO STRICT resolved_account_status, resolved_owner_binding
  FROM public.accounts
  WHERE id = resolved_account_id;

  IF resolved_identity_retired_at IS NOT NULL OR resolved_account_status <> 'active' THEN
    RAISE EXCEPTION 'personal account identity is not active'
      USING ERRCODE = '28000';
  END IF;

  IF p_previous_identity_hmac IS NOT NULL THEN
    BEGIN
      INSERT INTO public.account_identity_keys (
        account_id,
        identity_hmac,
        hmac_key_version
      ) VALUES (
        resolved_account_id,
        p_previous_identity_hmac,
        p_previous_hmac_key_version
      )
      ON CONFLICT (hmac_key_version, identity_hmac)
      DO UPDATE SET identity_hmac = EXCLUDED.identity_hmac
      RETURNING account_identity_keys.account_id, account_identity_keys.retired_at
      INTO previous_account_id, previous_identity_retired_at;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'account already has a different previous identity HMAC for that key version'
          USING ERRCODE = '23505';
    END;

    IF previous_account_id <> resolved_account_id THEN
      RAISE EXCEPTION 'current and previous identity HMACs map to different accounts'
        USING ERRCODE = '23505';
    END IF;
    IF previous_identity_retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'previous personal account identity is not active'
        USING ERRCODE = '28000';
    END IF;
  END IF;

  RETURN QUERY SELECT resolved_account_id, resolved_owner_binding;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "resolve_personal_account"(bytea, smallint, bytea, smallint) FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE "personal_vaults" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_vaults" FORCE ROW LEVEL SECURITY;
CREATE POLICY "personal_vaults_account_isolation" ON "personal_vaults"
  USING ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid)
  WITH CHECK ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "personal_vault_payloads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_vault_payloads" FORCE ROW LEVEL SECURITY;
CREATE POLICY "personal_vault_payloads_account_isolation" ON "personal_vault_payloads"
  USING ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid)
  WITH CHECK ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "personal_vault_keyrings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_vault_keyrings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "personal_vault_keyrings_account_isolation" ON "personal_vault_keyrings"
  USING ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid)
  WITH CHECK ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "personal_vault_manifests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_vault_manifests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "personal_vault_manifests_account_isolation" ON "personal_vault_manifests"
  USING ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid)
  WITH CHECK ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "personal_vault_commits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_vault_commits" FORCE ROW LEVEL SECURITY;
CREATE POLICY "personal_vault_commits_account_isolation" ON "personal_vault_commits"
  USING ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid)
  WITH CHECK ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "personal_vault_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_vault_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "personal_vault_devices_account_isolation" ON "personal_vault_devices"
  USING ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid)
  WITH CHECK ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "personal_vault_pairings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_vault_pairings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "personal_vault_pairings_account_isolation" ON "personal_vault_pairings"
  USING ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid)
  WITH CHECK ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "personal_vault_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_vault_commands" FORCE ROW LEVEL SECURITY;
CREATE POLICY "personal_vault_commands_account_isolation" ON "personal_vault_commands"
  USING ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid)
  WITH CHECK ("account_id" = NULLIF(pg_catalog.current_setting('app.account_id', true), '')::uuid);
