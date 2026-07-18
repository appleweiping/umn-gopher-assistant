import { rm } from "node:fs/promises";
import { resolve } from "node:path";

for (const directory of [".turbo", "coverage"]) {
  await rm(resolve(process.cwd(), directory), { force: true, recursive: true });
}
