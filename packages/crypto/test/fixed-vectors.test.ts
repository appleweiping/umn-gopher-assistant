import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it } from "vitest";

import { buildPayloadAadV1 } from "@umn-gopher-assistant/contracts";

import { openXChaCha, sealXChaCha } from "../src/internal/xchacha.js";

describe("fixed cryptographic and encoding vectors", () => {
  it("matches the libsodium XChaCha20-Poly1305-IETF regression vector", async () => {
    await sodium.ready;
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const nonce = Uint8Array.from({ length: 24 }, (_, index) => index + 32);
    const plaintext = new TextEncoder().encode("fixed-vector");
    const aad = new TextEncoder().encode("uga-aad-v1");
    const ciphertext = sealXChaCha(sodium, key, nonce, plaintext, aad);
    expect(sodium.to_hex(ciphertext)).toBe("7b3035ae1f1a62ee5bca3fcff15f15b076518f1f699e3596f1b08637");
    expect(openXChaCha(sodium, key, nonce, ciphertext, aad)).toEqual(plaintext);
    ciphertext[0] = (ciphertext.at(0) ?? 0) ^ 1;
    expect(() => openXChaCha(sodium, key, nonce, ciphertext, aad)).toThrow(
      expect.objectContaining({ code: "AUTHENTICATION_FAILED" }),
    );
    sodium.memzero(key);
    sodium.memzero(nonce);
    sodium.memzero(plaintext);
    sodium.memzero(aad);
    sodium.memzero(ciphertext);
  });

  it("uses the contracts package's domain-separated canonical AAD vector", () => {
    const aad = buildPayloadAadV1({
      formatVersion: 1,
      vaultId: "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
      vaultKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523111",
      revision: 1,
      baseRevision: null,
      cipherSuite: "XCHACHA20_POLY1305",
      contentType: "application/vnd.umn-gopher-assistant.personal-vault+json",
      contentSchemaVersion: 1,
      padding: { algorithm: "SODIUM_PAD", blockSize: 4_096 },
      nonce: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJ",
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    expect(new TextDecoder().decode(Buffer.from(aad, "base64url"))).toBe(
      '["UGA1/PAYLOAD/AAD",1,"018fb9d8-3ec5-7e8b-a512-35f8ff523110","018fb9d8-3ec5-7e8b-a512-35f8ff523111",1,null,"XCHACHA20_POLY1305","application/vnd.umn-gopher-assistant.personal-vault+json",1,"SODIUM_PAD",4096,"CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJ","2026-07-19T00:00:00.000Z"]',
    );
  });
});
