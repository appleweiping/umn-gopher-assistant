import { createHmac, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { ACCOUNT_IDENTITY_STORE } from "./account.tokens.js";
import type { AccountContext, AccountIdentityStore, AccountResolver } from "./account.types.js";

const MAX_IDENTITY_COMPONENT_BYTES = 2_048;

function identityBytes(principal: AuthPrincipal): Buffer {
  const issuer = Buffer.from(principal.issuer, "utf8");
  const subject = Buffer.from(principal.subject, "utf8");
  if (
    issuer.byteLength === 0 ||
    issuer.byteLength > MAX_IDENTITY_COMPONENT_BYTES ||
    subject.byteLength === 0 ||
    subject.byteLength > MAX_IDENTITY_COMPONENT_BYTES
  ) {
    throw new TypeError("Verified OIDC identity exceeds the account mapping boundary");
  }
  return Buffer.concat([issuer, Buffer.of(0), subject]);
}

@Injectable()
export class HmacAccountResolver implements AccountResolver {
  constructor(
    @Inject(ACCOUNT_IDENTITY_STORE) private readonly identities: AccountIdentityStore,
    private readonly hmacKey: Uint8Array,
    private readonly previousHmacKey?: Uint8Array,
  ) {
    if (hmacKey.byteLength < 32 || hmacKey.byteLength > 64) {
      throw new TypeError("Account subject HMAC key must contain 32 through 64 bytes");
    }
    if (
      previousHmacKey !== undefined &&
      (previousHmacKey.byteLength < 32 || previousHmacKey.byteLength > 64)
    ) {
      throw new TypeError("Previous account subject HMAC key must contain 32 through 64 bytes");
    }
    if (
      previousHmacKey !== undefined &&
      hmacKey.byteLength === previousHmacKey.byteLength &&
      timingSafeEqual(hmacKey, previousHmacKey)
    ) {
      throw new TypeError("Current and previous account subject HMAC keys must be independent");
    }
  }

  async resolve(principal: AuthPrincipal): Promise<AccountContext> {
    const material = identityBytes(principal);
    let digest: Buffer | undefined;
    let previousDigest: Buffer | undefined;
    try {
      digest = createHmac("sha256", this.hmacKey).update(material).digest();
      previousDigest =
        this.previousHmacKey === undefined
          ? undefined
          : createHmac("sha256", this.previousHmacKey).update(material).digest();
      const resolved = await this.identities.resolveAccount(digest, previousDigest);
      try {
        if (resolved.ownerBinding.byteLength !== 32) {
          throw new TypeError("Account owner binding must contain exactly 32 bytes");
        }
        return Object.freeze({
          accountId: resolved.accountId,
          ownerBinding: Buffer.from(resolved.ownerBinding).toString("base64url"),
        });
      } finally {
        resolved.ownerBinding.fill(0);
      }
    } finally {
      digest?.fill(0);
      previousDigest?.fill(0);
      material.fill(0);
    }
  }
}
