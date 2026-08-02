import type { AuthPrincipal } from "../auth/auth.types.js";

export class AccountIdentityInactiveError extends Error {
  constructor() {
    super("Personal account identity is inactive");
    this.name = "AccountIdentityInactiveError";
  }
}

export class AccountIdentityUnavailableError extends Error {
  constructor() {
    super("Personal account identity resolution is unavailable");
    this.name = "AccountIdentityUnavailableError";
  }
}

export interface AccountContext {
  readonly accountId: string;
  /** Stable, random account binding persisted independently from login identifiers. */
  readonly ownerBinding: string;
}

export interface AccountIdentityStore {
  resolveAccount(
    subjectHmac: Uint8Array,
    previousSubjectHmac?: Uint8Array,
  ): Promise<{
    readonly accountId: string;
    readonly ownerBinding: Uint8Array;
  }>;
}

export interface AccountResolver {
  resolve(principal: AuthPrincipal): Promise<AccountContext>;
}
