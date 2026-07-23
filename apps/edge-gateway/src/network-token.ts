import { createHmac } from "node:crypto";

interface NetworkPrefix {
  readonly family: "ipv4/24" | "ipv6/64";
  readonly bytes: Buffer;
}

function parseIpv4(address: string): Buffer | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part)) return undefined;
    const value = Number(part);
    if (value > 255) return undefined;
    bytes.push(value);
  }
  return Buffer.from(bytes);
}

function parseIpv6(addressWithOptionalZone: string): Buffer | undefined {
  const percent = addressWithOptionalZone.indexOf("%");
  const address = percent === -1 ? addressWithOptionalZone : addressWithOptionalZone.slice(0, percent);
  if (percent !== -1) {
    const zone = addressWithOptionalZone.slice(percent + 1);
    if (zone.length === 0 || addressWithOptionalZone.slice(percent + 1).includes("%")) return undefined;
  }

  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon === -1) return undefined;
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (ipv4 === undefined) return undefined;
    const high = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0);
    const low = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0);
    normalized = `${normalized.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const compression = normalized.indexOf("::");
  if (compression !== -1 && normalized.slice(compression + 2).includes("::")) return undefined;
  const leftText = compression === -1 ? normalized : normalized.slice(0, compression);
  const rightText = compression === -1 ? "" : normalized.slice(compression + 2);
  const left = leftText.length === 0 ? [] : leftText.split(":");
  const right = rightText.length === 0 ? [] : rightText.split(":");
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return undefined;

  const missing = 8 - left.length - right.length;
  if ((compression === -1 && missing !== 0) || (compression !== -1 && missing < 1)) return undefined;
  const words = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (words.length !== 8) return undefined;

  const bytes = Buffer.alloc(16);
  for (const [index, word] of words.entries()) {
    bytes.writeUInt16BE(Number.parseInt(word, 16), index * 2);
  }
  return bytes;
}

function networkPrefix(remoteAddress: string): NetworkPrefix {
  const ipv4 = parseIpv4(remoteAddress);
  if (ipv4 !== undefined) {
    return { bytes: ipv4.subarray(0, 3), family: "ipv4/24" };
  }

  const ipv6 = parseIpv6(remoteAddress);
  if (ipv6 === undefined) throw new TypeError("The peer socket address is not a valid IP address");
  const isIpv4Mapped =
    ipv6.subarray(0, 10).every((byte) => byte === 0) && ipv6[10] === 0xff && ipv6[11] === 0xff;
  if (isIpv4Mapped) {
    return { bytes: ipv6.subarray(12, 15), family: "ipv4/24" };
  }
  return { bytes: ipv6.subarray(0, 8), family: "ipv6/64" };
}

function utcDay(nowMilliseconds: number): string {
  if (!Number.isFinite(nowMilliseconds) || nowMilliseconds < 0) {
    throw new TypeError("Network-token clock is invalid");
  }
  return new Date(nowMilliseconds).toISOString().slice(0, 10);
}

export function derivePrivacyNetworkId(
  remoteAddress: string,
  networkHmacKey: Uint8Array,
  nowMilliseconds: number = Date.now(),
): string {
  if (networkHmacKey.byteLength < 32 || networkHmacKey.byteLength > 64) {
    throw new TypeError("Network-token key is invalid");
  }
  const prefix = networkPrefix(remoteAddress);
  return createHmac("sha256", networkHmacKey)
    .update("umn-gopher-assistant:edge-ai-network:v1\n", "utf8")
    .update(`${utcDay(nowMilliseconds)}\n${prefix.family}\n`, "utf8")
    .update(prefix.bytes)
    .digest("base64url");
}
