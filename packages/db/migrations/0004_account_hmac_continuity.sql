CREATE TABLE "account_hmac_key_registry" (
	"hmac_key_version" smallint PRIMARY KEY NOT NULL,
	"key_fingerprint" "bytea" NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "account_hmac_key_registry_fingerprint_check" CHECK ("account_hmac_key_registry"."hmac_key_version" BETWEEN 1 AND 32767 AND octet_length("account_hmac_key_registry"."key_fingerprint") = 32),
	CONSTRAINT "account_hmac_key_registry_lifecycle_check" CHECK ("account_hmac_key_registry"."retired_at" IS NULL OR "account_hmac_key_registry"."retired_at" >= "account_hmac_key_registry"."activated_at")
);
--> statement-breakpoint
COMMENT ON TABLE "account_hmac_key_registry" IS
  'owner: account-identity; domain-separated deployment fingerprints only; no login identifiers or HMAC secrets';
--> statement-breakpoint
REVOKE ALL ON TABLE "account_hmac_key_registry" FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_account_hmac_key_continuity"(
  p_current_hmac_key_version smallint,
  p_current_key_fingerprint bytea,
  p_previous_hmac_key_version smallint DEFAULT NULL,
  p_previous_key_fingerprint bytea DEFAULT NULL,
  p_finalize_rotation boolean DEFAULT false,
  p_allow_existing_identity_bootstrap boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  registry_count bigint;
  identity_count bigint;
  maximum_key_version smallint;
  registered_current_fingerprint bytea;
  registered_current_retired_at timestamptz;
  registered_previous_fingerprint bytea;
  registered_previous_retired_at timestamptz;
  current_registered boolean := false;
  previous_registered boolean := false;
  unmigrated_account_count bigint;
  transition_time timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_current_hmac_key_version IS NULL
    OR p_current_hmac_key_version NOT BETWEEN 1 AND 32767
    OR p_current_key_fingerprint IS NULL
    OR pg_catalog.octet_length(p_current_key_fingerprint) <> 32
    OR p_finalize_rotation IS NULL
    OR p_allow_existing_identity_bootstrap IS NULL THEN
    RAISE EXCEPTION 'current account HMAC version or fingerprint is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF (p_previous_hmac_key_version IS NULL) <> (p_previous_key_fingerprint IS NULL) THEN
    RAISE EXCEPTION 'previous account HMAC version and fingerprint must be provided together'
      USING ERRCODE = '22023';
  END IF;
  IF p_previous_hmac_key_version IS NOT NULL AND (
    p_previous_hmac_key_version <> p_current_hmac_key_version - 1
    OR pg_catalog.octet_length(p_previous_key_fingerprint) <> 32
    OR p_previous_key_fingerprint = p_current_key_fingerprint
  ) THEN
    RAISE EXCEPTION 'account HMAC rotation requires a distinct immediately previous key'
      USING ERRCODE = '22023';
  END IF;
  IF p_finalize_rotation AND (
    p_current_hmac_key_version = 1 OR p_previous_hmac_key_version IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'account HMAC finalization requires only a current version above one'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize every replica's startup decision. This protects first install,
  -- rotation registration, and finalization from split-brain deployment races.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gopher:account-hmac-continuity:v1', 0)
  );

  SELECT pg_catalog.count(*), pg_catalog.max(registry.hmac_key_version)
  INTO registry_count, maximum_key_version
  FROM public.account_hmac_key_registry AS registry;

  IF registry_count = 0 THEN
    SELECT pg_catalog.count(*)
    INTO identity_count
    FROM public.account_identity_keys;

    IF identity_count > 0 AND NOT p_allow_existing_identity_bootstrap THEN
      RAISE EXCEPTION 'account HMAC continuity registry is uninitialized for existing identities'
        USING ERRCODE = '55000',
              HINT = 'Perform the documented one-time bootstrap with the known-good account HMAC key.';
    END IF;

    IF p_previous_hmac_key_version IS NOT NULL THEN
      INSERT INTO public.account_hmac_key_registry (
        hmac_key_version,
        key_fingerprint,
        activated_at
      ) VALUES (
        p_previous_hmac_key_version,
        p_previous_key_fingerprint,
        transition_time
      );
    END IF;
    INSERT INTO public.account_hmac_key_registry (
      hmac_key_version,
      key_fingerprint,
      activated_at
    ) VALUES (
      p_current_hmac_key_version,
      p_current_key_fingerprint,
      transition_time
    );

    IF p_finalize_rotation THEN
      SELECT pg_catalog.count(*)
      INTO unmigrated_account_count
      FROM public.accounts AS account
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.account_identity_keys AS identity_key
        WHERE identity_key.account_id = account.id
          AND identity_key.hmac_key_version = p_current_hmac_key_version
          AND identity_key.retired_at IS NULL
      );
      IF unmigrated_account_count > 0 THEN
        RAISE EXCEPTION 'account HMAC rotation cannot be finalized while accounts remain unmigrated'
          USING ERRCODE = '55000',
                DETAIL = pg_catalog.format('%s account mappings still require the current key version', unmigrated_account_count);
      END IF;
      UPDATE public.account_identity_keys
      SET retired_at = transition_time
      WHERE hmac_key_version < p_current_hmac_key_version
        AND retired_at IS NULL;
    END IF;
    RETURN;
  END IF;

  SELECT registry.key_fingerprint, registry.retired_at
  INTO registered_current_fingerprint, registered_current_retired_at
  FROM public.account_hmac_key_registry AS registry
  WHERE registry.hmac_key_version = p_current_hmac_key_version
  FOR UPDATE;
  current_registered := FOUND;

  IF current_registered THEN
    IF registered_current_fingerprint IS DISTINCT FROM p_current_key_fingerprint THEN
      RAISE EXCEPTION 'account HMAC fingerprint does not match the registered key version'
        USING ERRCODE = '55000';
    END IF;
    IF registered_current_retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'account HMAC key version is retired'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    IF p_finalize_rotation OR p_previous_hmac_key_version IS NULL THEN
      RAISE EXCEPTION 'unregistered account HMAC key version requires an active previous version'
        USING ERRCODE = '55000';
    END IF;
    IF p_current_hmac_key_version <> maximum_key_version + 1
      OR p_previous_hmac_key_version <> maximum_key_version THEN
      RAISE EXCEPTION 'account HMAC rotation must advance the latest registered version by one'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF p_previous_hmac_key_version IS NOT NULL THEN
    SELECT registry.key_fingerprint, registry.retired_at
    INTO registered_previous_fingerprint, registered_previous_retired_at
    FROM public.account_hmac_key_registry AS registry
    WHERE registry.hmac_key_version = p_previous_hmac_key_version
    FOR UPDATE;
    previous_registered := FOUND;

    IF NOT previous_registered
      OR registered_previous_fingerprint IS DISTINCT FROM p_previous_key_fingerprint
      OR registered_previous_retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'previous account HMAC key does not match an active registered version'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NOT current_registered THEN
    -- A later rotation is safe only after the preceding one completed its
    -- serialized finalization. Otherwise a dormant account that still has
    -- only an older digest would be indistinguishable from a first login once
    -- runtimes retain only the current and immediately previous keys.
    IF EXISTS (
      SELECT 1
      FROM public.account_hmac_key_registry AS registry
      WHERE registry.hmac_key_version < p_previous_hmac_key_version
        AND registry.retired_at IS NULL
    ) OR EXISTS (
      SELECT 1
      FROM public.account_identity_keys AS identity_key
      WHERE identity_key.hmac_key_version < p_previous_hmac_key_version
        AND identity_key.retired_at IS NULL
    ) THEN
      RAISE EXCEPTION 'account HMAC rotation requires the previous rotation to be finalized'
        USING ERRCODE = '55000',
              HINT = 'Finalize the active rotation before registering another key version.';
    END IF;

    SELECT pg_catalog.count(*)
    INTO unmigrated_account_count
    FROM public.accounts AS account
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.account_identity_keys AS identity_key
      WHERE identity_key.account_id = account.id
        AND identity_key.hmac_key_version = p_previous_hmac_key_version
        AND identity_key.retired_at IS NULL
    );

    IF unmigrated_account_count > 0 THEN
      RAISE EXCEPTION 'account HMAC rotation cannot advance while accounts lack the previous key version'
        USING ERRCODE = '55000',
              DETAIL = pg_catalog.format(
                '%s account mappings still require key version %s',
                unmigrated_account_count,
                p_previous_hmac_key_version
              ),
              HINT = 'Complete and finalize the active rotation before registering another key version.';
    END IF;

    INSERT INTO public.account_hmac_key_registry (
      hmac_key_version,
      key_fingerprint,
      activated_at
    ) VALUES (
      p_current_hmac_key_version,
      p_current_key_fingerprint,
      transition_time
    );
  END IF;

  IF p_finalize_rotation THEN
    IF EXISTS (
      SELECT 1
      FROM public.account_hmac_key_registry AS registry
      WHERE registry.hmac_key_version > p_current_hmac_key_version
    ) THEN
      RAISE EXCEPTION 'account HMAC finalization cannot target an older registered version'
        USING ERRCODE = '55000';
    END IF;

    SELECT pg_catalog.count(*)
    INTO unmigrated_account_count
    FROM public.accounts AS account
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.account_identity_keys AS identity_key
      WHERE identity_key.account_id = account.id
        AND identity_key.hmac_key_version = p_current_hmac_key_version
        AND identity_key.retired_at IS NULL
    );

    IF unmigrated_account_count > 0 THEN
      RAISE EXCEPTION 'account HMAC rotation cannot be finalized while accounts remain unmigrated'
        USING ERRCODE = '55000',
              DETAIL = pg_catalog.format('%s account mappings still require the current key version', unmigrated_account_count);
    END IF;

    UPDATE public.account_identity_keys
    SET retired_at = transition_time
    WHERE hmac_key_version < p_current_hmac_key_version
      AND retired_at IS NULL;

    UPDATE public.account_hmac_key_registry
    SET retired_at = transition_time
    WHERE hmac_key_version < p_current_hmac_key_version
      AND retired_at IS NULL;
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_account_hmac_key_continuity"(smallint, bytea, smallint, bytea, boolean, boolean) FROM PUBLIC;
