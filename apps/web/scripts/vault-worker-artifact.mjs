import { createHash } from "node:crypto";

const WORKER_PREFIX = "personal-vault.worker.";
const WORKER_SUFFIX = ".mjs";
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SERVICE_WORKER_DIGEST_PLACEHOLDER = "__UGA_VAULT_WORKER_DIGEST__";

/**
 * @param {Uint8Array} contents
 * @returns {string}
 */
export function sha256Hex(contents) {
  // Vitest/jsdom and build tooling can provide Uint8Array values from another
  // JavaScript realm, where `instanceof Uint8Array` is false. The intrinsic
  // tag still rejects wider typed arrays without rejecting valid byte views.
  if (Object.prototype.toString.call(contents) !== "[object Uint8Array]") {
    throw new TypeError("Worker contents must be a Uint8Array.");
  }
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * @param {string} digest
 * @returns {string}
 */
export function hashedWorkerFilename(digest) {
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError("Worker digest must be a lowercase SHA-256 hex string.");
  }
  return `${WORKER_PREFIX}${digest}${WORKER_SUFFIX}`;
}

/**
 * @param {string} filename
 * @returns {string}
 */
export function workerBootstrapSource(filename) {
  const digest = filename.slice(WORKER_PREFIX.length, -WORKER_SUFFIX.length);
  if (filename !== hashedWorkerFilename(digest)) {
    throw new TypeError("Worker bootstrap may import only a content-addressed vault Worker.");
  }
  return `import "./${filename}";\n`;
}

/**
 * Bind a Service Worker build to one immutable vault Worker artifact. Cache
 * names include this digest, so an older active Service Worker cannot replace
 * the bootstrap pointer used by a newly installed version.
 *
 * @param {string} template
 * @param {string} digest
 * @returns {string}
 */
export function serviceWorkerSource(template, digest) {
  if (typeof template !== "string") {
    throw new TypeError("Service Worker template must be a string.");
  }
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError("Worker digest must be a lowercase SHA-256 hex string.");
  }
  const parts = template.split(SERVICE_WORKER_DIGEST_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new Error("Service Worker template must contain the vault Worker digest placeholder once.");
  }
  return `${parts[0]}${digest}${parts[1]}`;
}
