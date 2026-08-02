export type RecoverableRotationFailureStatus = 403 | 409 | 412 | 422;

export function isDurableCommandRecoveryStatus(status: number): status is RecoverableRotationFailureStatus {
  return status === 403 || status === 409 || status === 412 || status === 422;
}

/**
 * 403 is the API's expired-proof response. 409 can be inspected for an exact
 * already-applied head but must not renew into an existing idempotency digest.
 */
export function mayRenewRecoveryRotationProof(status: RecoverableRotationFailureStatus): boolean {
  return status !== 409;
}
