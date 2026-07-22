import type { Sodium } from "./sodium.js";

const HEX = "0123456789abcdef";

export function randomUuid(sodium: Sodium): string {
  const bytes = sodium.randombytes_buf(16);
  try {
    bytes[6] = ((bytes.at(6) ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes.at(8) ?? 0) & 0x3f) | 0x80;
    let encoded = "";
    for (let index = 0; index < bytes.length; index += 1) {
      if (index === 4 || index === 6 || index === 8 || index === 10) {
        encoded += "-";
      }
      const value = bytes.at(index) ?? 0;
      encoded += HEX.charAt(value >>> 4) + HEX.charAt(value & 0x0f);
    }
    return encoded;
  } finally {
    sodium.memzero(bytes);
  }
}
