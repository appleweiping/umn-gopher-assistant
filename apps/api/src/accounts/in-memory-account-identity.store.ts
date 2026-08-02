import { randomBytes, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import type { AccountIdentityStore } from "./account.types.js";

@Injectable()
export class InMemoryAccountIdentityStore implements AccountIdentityStore {
  readonly #accounts = new Map<string, { readonly accountId: string; readonly ownerBinding: Uint8Array }>();

  resolveAccount(
    subjectHmac: Uint8Array,
    previousSubjectHmac?: Uint8Array,
  ): Promise<{
    readonly accountId: string;
    readonly ownerBinding: Uint8Array;
  }> {
    if (subjectHmac.byteLength !== 32) throw new TypeError("Account subject HMAC must be 32 bytes");
    const key = Buffer.from(subjectHmac).toString("base64url");
    let account = this.#accounts.get(key);
    if (account === undefined && previousSubjectHmac !== undefined) {
      if (previousSubjectHmac.byteLength !== 32) {
        throw new TypeError("Previous account subject HMAC must be 32 bytes");
      }
      account = this.#accounts.get(Buffer.from(previousSubjectHmac).toString("base64url"));
      if (account !== undefined) this.#accounts.set(key, account);
    }
    if (account === undefined) {
      account = Object.freeze({
        accountId: randomUUID(),
        ownerBinding: new Uint8Array(randomBytes(32)),
      });
      this.#accounts.set(key, account);
    }
    return Promise.resolve({
      accountId: account.accountId,
      ownerBinding: new Uint8Array(account.ownerBinding),
    });
  }
}
