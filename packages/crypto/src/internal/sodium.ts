import sodium from "libsodium-wrappers-sumo";

export type Sodium = typeof sodium;

let sodiumReady: Promise<Sodium> | undefined;

export function initializeSodium(): Promise<Sodium> {
  sodiumReady ??= sodium.ready.then(() => sodium);
  return sodiumReady;
}
