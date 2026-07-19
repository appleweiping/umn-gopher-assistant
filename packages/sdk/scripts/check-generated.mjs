import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { generateArtifacts } from "./generator.mjs";

for (const [path, expected] of await generateArtifacts()) {
  const actual = await readFile(path, "utf8").catch(() => "");
  assert.equal(actual, expected, `${path} does not match openapi/openapi.yaml; run the SDK generate script`);
}

console.log("SDK generated artifacts match openapi/openapi.yaml.");
