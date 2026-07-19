import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { generateArtifacts } from "./generator.mjs";

for (const [path, source] of await generateArtifacts()) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, "utf8");
  console.log(`generated ${path}`);
}
