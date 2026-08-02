export interface DestroyableVaultState {
  readonly deviceKey: { destroy(): void } | undefined;
  readonly vaultKey: { destroy(): void };
}

/** Always attempts both destructions, even if one handle reports a failure. */
export function destroyVaultStateHandles(state: DestroyableVaultState): void {
  let firstFailure: unknown;
  try {
    state.deviceKey?.destroy();
  } catch (error) {
    firstFailure = error;
  }
  try {
    state.vaultKey.destroy();
  } catch (error) {
    firstFailure ??= error;
  }
  if (firstFailure instanceof Error) throw firstFailure;
  if (firstFailure !== undefined) {
    throw new Error("A vault key handle could not be destroyed.", {
      cause: firstFailure,
    });
  }
}

/**
 * A reopened root/device pair belongs to the caller only after the operation
 * succeeds. Response loss, reload replay failure, or a malicious read-back must
 * destroy both handles before the original error escapes.
 */
export async function destroyVaultStateOnFailure<T>(
  state: DestroyableVaultState,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    try {
      destroyVaultStateHandles(state);
    } catch {
      // Preserve the network/integrity failure that decides durable recovery
      // behavior; both handle destructions were still attempted.
    }
    throw error;
  }
}

/**
 * Keeps a newly opened state caller-local until every operation needed before
 * publication has succeeded. A rejected preparation destroys both handles and
 * never returns the plaintext-bearing state to the caller for global reuse.
 */
export function prepareVaultStateForPublication<T extends DestroyableVaultState>(
  state: T,
  prepare: (candidate: T) => Promise<void>,
): Promise<T> {
  return destroyVaultStateOnFailure(state, async () => {
    await prepare(state);
    return state;
  });
}
