import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const generatedPaths = [
  ".turbo",
  "coverage",
  "apps/ai-knowledge/.coverage",
  "apps/ai-knowledge/.pytest_cache",
  "apps/ai-knowledge/.ruff_cache",
  "apps/ai-knowledge/ai_knowledge.egg-info",
  "apps/ai-knowledge/ai_knowledge/__pycache__",
  "apps/ai-knowledge/build",
  "apps/ai-knowledge/coverage.xml",
  "apps/ai-knowledge/dist",
  "apps/ai-knowledge/htmlcov",
  "apps/ai-knowledge/tests/__pycache__",
];

for (const generatedPath of generatedPaths) {
  await rm(resolve(process.cwd(), generatedPath), { force: true, recursive: true });
}
