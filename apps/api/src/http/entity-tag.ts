import { createHash } from "node:crypto";

export function createEntityTag(value: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("base64url");
  return `"${digest}"`;
}

function splitEntityTagList(value: string): readonly string[] {
  const tags: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      tags.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  tags.push(value.slice(start).trim());
  return tags;
}

function weakOpaqueTag(value: string): string | null {
  const candidate = value.startsWith("W/") ? value.slice(2) : value;
  return /^"[\u0021\u0023-\u007e\u0080-\u00ff]*"$/u.test(candidate) ? candidate : null;
}

export function ifNoneMatchMatches(ifNoneMatch: string | undefined, currentEntityTag: string): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  const fieldValue = ifNoneMatch.trim();
  if (fieldValue === "*") {
    return true;
  }
  const currentOpaqueTag = weakOpaqueTag(currentEntityTag);
  if (currentOpaqueTag === null) {
    return false;
  }
  return splitEntityTagList(fieldValue).some((candidate) => weakOpaqueTag(candidate) === currentOpaqueTag);
}
