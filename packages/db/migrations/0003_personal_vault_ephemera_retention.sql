CREATE INDEX "personal_vault_commands_completed_retention_idx" ON "personal_vault_commands" USING btree ("completed_at","id") WHERE "personal_vault_commands"."status" IN ('succeeded', 'failed');--> statement-breakpoint
CREATE INDEX "personal_vault_commands_pending_attention_idx" ON "personal_vault_commands" USING btree ("created_at","id") WHERE "personal_vault_commands"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "personal_vault_pairings_pending_expiry_idx" ON "personal_vault_pairings" USING btree ("expires_at","id") WHERE "personal_vault_pairings"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "personal_vault_pairings_terminal_retention_idx" ON "personal_vault_pairings" USING btree ("updated_at","id") WHERE "personal_vault_pairings"."state" IN ('consumed', 'expired', 'cancelled');
--> statement-breakpoint
CREATE FUNCTION "public"."maintain_personal_vault_ephemera"(
  p_dry_run boolean DEFAULT true,
  p_batch_size integer DEFAULT 500
) RETURNS TABLE(
  maintenance_run_id uuid,
  mode text,
  observed_at timestamp with time zone,
  command_retention_cutoff timestamp with time zone,
  pairing_retention_cutoff timestamp with time zone,
  pending_pairings_eligible integer,
  pending_pairings_expired integer,
  completed_commands_eligible integer,
  completed_commands_deleted integer,
  terminal_pairings_eligible integer,
  terminal_pairings_deleted integer,
  stale_pending_commands_observed integer,
  pending_pairings_remaining boolean,
  completed_commands_remaining boolean,
  terminal_pairings_remaining boolean,
  stale_pending_commands_remaining boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_candidate_count integer;
BEGIN
  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'p_dry_run must be true or false'
      USING ERRCODE = '22004';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'p_batch_size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  maintenance_run_id := NULL;
  mode := CASE WHEN p_dry_run THEN 'dry-run' ELSE 'apply' END;
  observed_at := pg_catalog.clock_timestamp();
  command_retention_cutoff := observed_at - interval '24 hours';
  pairing_retention_cutoff := observed_at - interval '30 days';
  pending_pairings_expired := 0;
  completed_commands_deleted := 0;
  terminal_pairings_deleted := 0;

  IF p_dry_run THEN
    SELECT pg_catalog.count(*)::integer
      INTO v_candidate_count
      FROM (
        SELECT pairing.id
          FROM public.personal_vault_pairings AS pairing
         WHERE pairing.state = 'pending'
           AND pairing.expires_at <= observed_at
         ORDER BY pairing.expires_at, pairing.id
         LIMIT p_batch_size + 1
      ) AS candidates;
    pending_pairings_eligible := LEAST(v_candidate_count, p_batch_size);
    pending_pairings_remaining := v_candidate_count > p_batch_size;

    SELECT pg_catalog.count(*)::integer
      INTO v_candidate_count
      FROM (
        SELECT command.id
          FROM public.personal_vault_commands AS command
         WHERE command.status IN ('succeeded', 'failed')
           AND command.completed_at <= command_retention_cutoff
         ORDER BY command.completed_at, command.id
         LIMIT p_batch_size + 1
      ) AS candidates;
    completed_commands_eligible := LEAST(v_candidate_count, p_batch_size);
    completed_commands_remaining := v_candidate_count > p_batch_size;

    SELECT pg_catalog.count(*)::integer
      INTO v_candidate_count
      FROM (
        SELECT pairing.id
          FROM public.personal_vault_pairings AS pairing
         WHERE pairing.state IN ('consumed', 'expired', 'cancelled')
           AND pairing.updated_at <= pairing_retention_cutoff
         ORDER BY pairing.updated_at, pairing.id
         LIMIT p_batch_size + 1
      ) AS candidates;
    terminal_pairings_eligible := LEAST(v_candidate_count, p_batch_size);
    terminal_pairings_remaining := v_candidate_count > p_batch_size;

    SELECT pg_catalog.count(*)::integer
      INTO v_candidate_count
      FROM (
        SELECT command.id
          FROM public.personal_vault_commands AS command
         WHERE command.status = 'pending'
           AND command.created_at <= command_retention_cutoff
         ORDER BY command.created_at, command.id
         LIMIT p_batch_size + 1
      ) AS candidates;
    stale_pending_commands_observed := LEAST(v_candidate_count, p_batch_size);
    stale_pending_commands_remaining := v_candidate_count > p_batch_size;

    RETURN NEXT;
    RETURN;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT pairing.id
      FROM public.personal_vault_pairings AS pairing
     WHERE pairing.state = 'pending'
       AND pairing.expires_at <= observed_at
     ORDER BY pairing.expires_at, pairing.id
     LIMIT p_batch_size
       FOR UPDATE OF pairing SKIP LOCKED
  ),
  expired AS (
    UPDATE public.personal_vault_pairings AS pairing
       SET state = 'expired',
           updated_at = observed_at
      FROM candidates
     WHERE pairing.id = candidates.id
       AND pairing.state = 'pending'
    RETURNING pairing.id
  )
  SELECT pg_catalog.count(*)::integer
    INTO pending_pairings_expired
    FROM expired;
  pending_pairings_eligible := pending_pairings_expired;

  WITH candidates AS MATERIALIZED (
    SELECT command.id
      FROM public.personal_vault_commands AS command
     WHERE command.status IN ('succeeded', 'failed')
       AND command.completed_at <= command_retention_cutoff
     ORDER BY command.completed_at, command.id
     LIMIT p_batch_size
       FOR UPDATE OF command SKIP LOCKED
  ),
  deleted AS (
    DELETE FROM public.personal_vault_commands AS command
      USING candidates
     WHERE command.id = candidates.id
       AND command.status IN ('succeeded', 'failed')
       AND command.completed_at <= command_retention_cutoff
    RETURNING command.id
  )
  SELECT pg_catalog.count(*)::integer
    INTO completed_commands_deleted
    FROM deleted;
  completed_commands_eligible := completed_commands_deleted;

  WITH candidates AS MATERIALIZED (
    SELECT pairing.id
      FROM public.personal_vault_pairings AS pairing
     WHERE pairing.state IN ('consumed', 'expired', 'cancelled')
       AND pairing.updated_at <= pairing_retention_cutoff
     ORDER BY pairing.updated_at, pairing.id
     LIMIT p_batch_size
       FOR UPDATE OF pairing SKIP LOCKED
  ),
  deleted AS (
    DELETE FROM public.personal_vault_pairings AS pairing
      USING candidates
     WHERE pairing.id = candidates.id
       AND pairing.state IN ('consumed', 'expired', 'cancelled')
       AND pairing.updated_at <= pairing_retention_cutoff
    RETURNING pairing.id
  )
  SELECT pg_catalog.count(*)::integer
    INTO terminal_pairings_deleted
    FROM deleted;
  terminal_pairings_eligible := terminal_pairings_deleted;

  SELECT pg_catalog.count(*)::integer
    INTO v_candidate_count
    FROM (
      SELECT command.id
        FROM public.personal_vault_commands AS command
       WHERE command.status = 'pending'
         AND command.created_at <= command_retention_cutoff
       ORDER BY command.created_at, command.id
       LIMIT p_batch_size + 1
    ) AS candidates;
  stale_pending_commands_observed := LEAST(v_candidate_count, p_batch_size);
  stale_pending_commands_remaining := v_candidate_count > p_batch_size;

  SELECT EXISTS(
    SELECT 1
      FROM public.personal_vault_pairings AS pairing
     WHERE pairing.state = 'pending'
       AND pairing.expires_at <= observed_at
  ) INTO pending_pairings_remaining;
  SELECT EXISTS(
    SELECT 1
      FROM public.personal_vault_commands AS command
     WHERE command.status IN ('succeeded', 'failed')
       AND command.completed_at <= command_retention_cutoff
  ) INTO completed_commands_remaining;
  SELECT EXISTS(
    SELECT 1
      FROM public.personal_vault_pairings AS pairing
     WHERE pairing.state IN ('consumed', 'expired', 'cancelled')
       AND pairing.updated_at <= pairing_retention_cutoff
  ) INTO terminal_pairings_remaining;

  maintenance_run_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.audit_events (
    id,
    occurred_at,
    actor,
    action,
    target,
    outcome,
    trace_id,
    metadata
  ) VALUES (
    maintenance_run_id,
    observed_at,
    pg_catalog.jsonb_build_object(
      'type', 'service',
      'id', 'personal-vault-maintenance'
    ),
    'personal_vault.ephemera.maintain',
    pg_catalog.jsonb_build_object(
      'type', 'personal-vault-ephemera',
      'id', 'global'
    ),
    'SUCCESS',
    'personal-vault-maintenance:' || maintenance_run_id::text,
    pg_catalog.jsonb_build_object(
      'mode', mode,
      'sessionRole', session_user,
      'batchSize', p_batch_size,
      'commandRetentionCutoff', command_retention_cutoff,
      'pairingRetentionCutoff', pairing_retention_cutoff,
      'pendingPairingsExpired', pending_pairings_expired,
      'completedCommandsDeleted', completed_commands_deleted,
      'terminalPairingsDeleted', terminal_pairings_deleted,
      'stalePendingCommandsObserved', stale_pending_commands_observed,
      'pendingPairingsRemaining', pending_pairings_remaining,
      'completedCommandsRemaining', completed_commands_remaining,
      'terminalPairingsRemaining', terminal_pairings_remaining,
      'stalePendingCommandsRemaining', stale_pending_commands_remaining
    )
  );

  RETURN NEXT;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION "public"."maintain_personal_vault_ephemera"(boolean, integer) IS
  'Privileged bounded maintenance entry point: dry-run by default; expires overdue pending pairings, removes completed command results after 24 hours and terminal pairings after 30 days, reports but never deletes pending commands, and writes an anonymous audit summary for each apply batch.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."maintain_personal_vault_ephemera"(boolean, integer) FROM PUBLIC;
