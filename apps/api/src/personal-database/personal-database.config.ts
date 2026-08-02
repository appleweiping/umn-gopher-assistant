type Environment = Readonly<Record<string, string | undefined>>;

export interface PersonalDatabaseConfig {
  readonly identityHmacKeyVersion: number;
  readonly identityHmacRotationFinalized: boolean;
  readonly previousIdentityHmacKeyVersion?: number;
  readonly url: string;
}

function parseIdentityHmacKeyVersion(value: string | undefined): number {
  const candidate = value ?? "1";
  if (!/^[1-9][0-9]{0,4}$/u.test(candidate)) {
    throw new TypeError("API_ACCOUNT_HMAC_KEY_VERSION must be an integer between 1 and 32767");
  }
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed > 32_767) {
    throw new TypeError("API_ACCOUNT_HMAC_KEY_VERSION must be an integer between 1 and 32767");
  }
  return parsed;
}

function parseRotationFinalized(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError("API_ACCOUNT_HMAC_ROTATION_FINALIZED must be exactly true or false");
}

function parsePersonalDatabaseUrl(raw: string, production: boolean): string {
  if (raw.trim() !== raw) {
    throw new TypeError("API_PERSONAL_DATABASE_URL must not contain surrounding whitespace");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("API_PERSONAL_DATABASE_URL must be an absolute PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new TypeError("API_PERSONAL_DATABASE_URL must use postgres or postgresql");
  }
  if (
    url.username.length === 0 ||
    url.password.length === 0 ||
    url.hostname.length === 0 ||
    url.pathname.length <= 1 ||
    url.hash.length > 0
  ) {
    throw new TypeError(
      "API_PERSONAL_DATABASE_URL must contain a username, password, host, and database without a fragment",
    );
  }
  const parameterNames = [...url.searchParams.keys()];
  if (parameterNames.some((name) => name !== "sslmode") || parameterNames.length > 1) {
    throw new TypeError("API_PERSONAL_DATABASE_URL permits at most one sslmode query parameter");
  }
  if (production && url.searchParams.get("sslmode") !== "verify-full") {
    throw new TypeError("API_PERSONAL_DATABASE_URL must use sslmode=verify-full in production");
  }
  return url.toString();
}

/**
 * Development and tests default to the in-memory repository. Merely setting
 * the personal database URL selects the real PostgreSQL/RLS implementation,
 * while production fails closed when the dedicated runtime URL is absent.
 */
export function loadPersonalDatabaseConfig(
  environment: Environment = process.env,
): PersonalDatabaseConfig | null {
  const production = environment["NODE_ENV"] === "production";
  const rawUrl = environment["API_PERSONAL_DATABASE_URL"];
  if (rawUrl === undefined) {
    if (production) {
      throw new TypeError("API_PERSONAL_DATABASE_URL is required in production");
    }
    return null;
  }
  if (production && environment["API_ACCOUNT_HMAC_KEY_VERSION"] === undefined) {
    throw new TypeError("API_ACCOUNT_HMAC_KEY_VERSION is required in production");
  }
  const identityHmacKeyVersion = parseIdentityHmacKeyVersion(environment["API_ACCOUNT_HMAC_KEY_VERSION"]);
  const identityHmacRotationFinalized = parseRotationFinalized(
    environment["API_ACCOUNT_HMAC_ROTATION_FINALIZED"],
  );
  const previousVersionRaw = environment["API_PREVIOUS_ACCOUNT_HMAC_KEY_VERSION"];
  const previousIdentityHmacKeyVersion =
    previousVersionRaw === undefined ? undefined : parseIdentityHmacKeyVersion(previousVersionRaw);
  if (
    (identityHmacKeyVersion > 1 &&
      !identityHmacRotationFinalized &&
      previousIdentityHmacKeyVersion !== identityHmacKeyVersion - 1) ||
    (identityHmacKeyVersion === 1 && previousIdentityHmacKeyVersion !== undefined)
  ) {
    throw new TypeError("API_PREVIOUS_ACCOUNT_HMAC_KEY_VERSION must immediately precede the current version");
  }
  if (identityHmacRotationFinalized && identityHmacKeyVersion === 1) {
    throw new TypeError("API_ACCOUNT_HMAC_ROTATION_FINALIZED requires a key version above 1");
  }
  if (identityHmacRotationFinalized && previousIdentityHmacKeyVersion !== undefined) {
    throw new TypeError("A finalized account HMAC rotation must not retain the previous key version");
  }
  return Object.freeze({
    identityHmacKeyVersion,
    identityHmacRotationFinalized,
    ...(previousIdentityHmacKeyVersion === undefined ? {} : { previousIdentityHmacKeyVersion }),
    url: parsePersonalDatabaseUrl(rawUrl, production),
  });
}
