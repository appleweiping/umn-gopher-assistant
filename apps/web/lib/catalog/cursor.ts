const SIGNED_CURSOR = /^([A-Za-z0-9_-]{1,1950})\.([A-Za-z0-9_-]{43})$/u;

export function isSignedCatalogCursor(value: string): boolean {
  return value.length <= 1994 && SIGNED_CURSOR.test(value);
}
