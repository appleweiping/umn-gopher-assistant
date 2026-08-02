import { createHash, randomUUID } from "node:crypto";

import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from "jose";

const BASE64URL_256 = /^[A-Za-z0-9_-]{43}$/u;
const DPOP_NONCE = /^[\x21\x23-\x5B\x5D-\x7E]{1,512}$/u;

export interface DpopPrivateJwk {
  readonly crv: "P-256";
  readonly d: string;
  readonly kty: "EC";
  readonly x: string;
  readonly y: string;
}

export interface DpopProofOptions {
  readonly accessToken?: string;
  readonly htm: string;
  readonly htu: string | URL;
  readonly jti?: string;
  readonly nonce?: string;
  readonly now?: () => number;
  readonly privateJwk: DpopPrivateJwk;
}

function canonicalCoordinate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    BASE64URL_256.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

export function parseDpopPrivateJwk(value: unknown): DpopPrivateJwk | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "crv,d,kty,x,y"
  ) {
    return undefined;
  }
  const jwk = value as Record<string, unknown>;
  if (
    jwk["kty"] !== "EC" ||
    jwk["crv"] !== "P-256" ||
    !canonicalCoordinate(jwk["d"]) ||
    !canonicalCoordinate(jwk["x"]) ||
    !canonicalCoordinate(jwk["y"])
  ) {
    return undefined;
  }
  return {
    crv: "P-256",
    d: jwk["d"],
    kty: "EC",
    x: jwk["x"],
    y: jwk["y"],
  };
}

export function publicDpopJwk(privateJwk: DpopPrivateJwk): JWK {
  return {
    crv: privateJwk.crv,
    kty: privateJwk.kty,
    x: privateJwk.x,
    y: privateJwk.y,
  };
}

export async function generateDpopPrivateJwk(): Promise<DpopPrivateJwk> {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const exported = parseDpopPrivateJwk(await exportJWK(pair.privateKey));
  if (exported === undefined) throw new TypeError("Generated DPoP key was not canonical P-256");
  return exported;
}

export function dpopThumbprint(privateJwk: DpopPrivateJwk): Promise<string> {
  return calculateJwkThumbprint(publicDpopJwk(privateJwk), "sha256");
}

function normalizePercentEncoding(pathname: string): string {
  if (/%(?![0-9A-Fa-f]{2})/u.test(pathname)) {
    throw new TypeError("DPoP target has malformed percent encoding");
  }
  return pathname.replace(/%([0-9A-Fa-f]{2})/gu, (_encoded, hexadecimal: string) => {
    const character = String.fromCharCode(Number.parseInt(hexadecimal, 16));
    return /^[A-Za-z0-9\-._~]$/u.test(character) ? character : `%${hexadecimal.toUpperCase()}`;
  });
}

export function canonicalizeDpopHtu(value: string | URL): string {
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") {
    throw new TypeError("DPoP target must be a credential-free HTTP URL");
  }
  url.search = "";
  url.hash = "";
  url.pathname = normalizePercentEncoding(url.pathname || "/");
  return url.toString();
}

export function parseDpopNonce(value: string | null): string | undefined {
  return value !== null && DPOP_NONCE.test(value) ? value : undefined;
}

function splitAuthenticateChallenges(value: string): readonly string[] {
  if (value.length > 8_192 || /[\r\n]/u.test(value)) return [];
  const segments: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (quoted && character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      segments.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || escaped) return [];
  segments.push(value.slice(start).trim());
  return segments.filter((segment) => segment.length > 0);
}

function hasUseDpopNonceChallenge(value: string | null): boolean {
  if (value === null) return false;
  let dpopChallenge = false;
  for (const segment of splitAuthenticateChallenges(value)) {
    const challenge = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)(?:[ \t]+(.*))?$/u.exec(segment);
    const parameterOnly = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)[ \t]*=/u.test(segment);
    if (challenge !== null && !parameterOnly) {
      dpopChallenge = challenge[1]?.toLowerCase() === "dpop";
    }
    if (
      dpopChallenge &&
      /(?:^|[ \t])error[ \t]*=[ \t]*(?:"use_dpop_nonce"|use_dpop_nonce)(?:$|[ \t])/iu.test(
        challenge?.[2] ?? segment,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function isDpopNonceChallenge(response: Response): string | undefined {
  if (response.status !== 400 && response.status !== 401) {
    return undefined;
  }
  if (!hasUseDpopNonceChallenge(response.headers.get("www-authenticate"))) return undefined;
  return parseDpopNonce(response.headers.get("dpop-nonce"));
}

export async function createDpopProof(options: DpopProofOptions): Promise<string> {
  if (
    options.htm.length < 1 ||
    options.htm !== options.htm.toUpperCase() ||
    (options.nonce !== undefined && !DPOP_NONCE.test(options.nonce))
  ) {
    throw new TypeError("DPoP proof input is invalid");
  }
  const key = await importJWK(options.privateJwk, "ES256");
  const issuedAt = Math.floor((options.now?.() ?? Date.now()) / 1_000);
  const payload: Record<string, unknown> = {
    htm: options.htm,
    htu: canonicalizeDpopHtu(options.htu),
    iat: issuedAt,
    jti: options.jti ?? randomUUID(),
    ...(options.accessToken === undefined
      ? {}
      : {
          ath: createHash("sha256").update(options.accessToken, "ascii").digest("base64url"),
        }),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", jwk: publicDpopJwk(options.privateJwk), typ: "dpop+jwt" })
    .sign(key);
}
