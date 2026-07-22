/**
 * WebKit versions before Safari/iOS 26 can commit a partially scheduled
 * IndexedDB transaction when a Dedicated Worker is terminated. That violates
 * the vault's atomic-write boundary, so known affected Apple WebKit engines
 * must fail closed instead of risking an inconsistent encrypted record.
 *
 * WebKit bug 288682 was fixed upstream in March 2025, but the fix was not
 * present in Apple's Safari 18.6 source release. It is present in Safari 26.
 */
export const MINIMUM_SAFE_APPLE_WEBKIT_MAJOR = 26;

const APPLE_WEBKIT = /\bAppleWebKit\//u;
const IOS_DEVICE = /\b(?:iPhone|iPad|iPod)\b/u;
const IOS_VERSION = /\bCPU(?: iPhone)? OS (\d+)(?:[_.]\d+)?/u;
const MOBILE_WEBKIT = /\bMobile\//u;
const SAFARI_VERSION = /\bVersion\/(\d+)(?:\.\d+)?/u;
const NON_APPLE_CHROMIUM = /\b(?:Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPiOS)\//u;

function parsedMajor(match: RegExpMatchArray | null): number | undefined {
  if (match?.[1] === undefined) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Returns true only for an identifiable Apple WebKit engine that is known to
 * predate the transaction fix, or for an Apple WebKit engine whose version
 * cannot be established safely. Desktop Chromium is not affected by this
 * Apple port bug even though its user agent also contains `AppleWebKit`.
 */
export function isKnownUnsafeAppleWebKitVault(userAgent: string): boolean {
  if (!APPLE_WEBKIT.test(userAgent)) return false;

  const isIosWebKit = IOS_DEVICE.test(userAgent) || MOBILE_WEBKIT.test(userAgent);
  if (isIosWebKit) {
    const iosMajor = parsedMajor(IOS_VERSION.exec(userAgent));
    if (iosMajor !== undefined) return iosMajor < MINIMUM_SAFE_APPLE_WEBKIT_MAJOR;

    // iPadOS can request a desktop user agent. Safari's product version is the
    // only remaining release signal; embedded/unknown Apple WebKit fails closed.
    const safariMajor = parsedMajor(SAFARI_VERSION.exec(userAgent));
    return safariMajor === undefined || safariMajor < MINIMUM_SAFE_APPLE_WEBKIT_MAJOR;
  }

  if (NON_APPLE_CHROMIUM.test(userAgent)) return false;

  // After excluding Chromium-family tokens, an unidentified AppleWebKit port
  // fails closed. This also covers embedded desktop WebKit without relying on
  // the deprecated Navigator.vendor signal.
  const safariMajor = parsedMajor(SAFARI_VERSION.exec(userAgent));
  return safariMajor === undefined || safariMajor < MINIMUM_SAFE_APPLE_WEBKIT_MAJOR;
}
