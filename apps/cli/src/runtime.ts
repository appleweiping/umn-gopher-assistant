const supportedNodeRange = ">=24 <25";

export const unsupportedNodeRuntimeExitCode = 3;

export class UnsupportedNodeRuntimeError extends Error {
  readonly detectedVersion: string;
  readonly requiredRange = supportedNodeRange;

  constructor(detectedVersion: string) {
    super(`uga requires Node.js ${supportedNodeRange}; detected ${detectedVersion}.`);
    this.name = "UnsupportedNodeRuntimeError";
    this.detectedVersion = detectedVersion;
  }
}

export function assertSupportedNodeRuntime(version = process.versions.node): void {
  const match = /^(?<major>\d+)\.\d+\.\d+$/u.exec(version);
  if (match?.groups?.["major"] !== "24") {
    throw new UnsupportedNodeRuntimeError(version);
  }
}
