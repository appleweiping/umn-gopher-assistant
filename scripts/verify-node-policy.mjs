#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supportedRange = ">=24 <25";
const manifests = [
  "package.json",
  "apps/api/package.json",
  "apps/cli/package.json",
  "apps/mcp-server/package.json",
  "apps/web/package.json",
  "packages/config/package.json",
  "packages/contracts/package.json",
  "packages/crypto/package.json",
  "packages/db/package.json",
  "packages/sdk/package.json",
  "packages/testing/package.json",
];

for (const manifestPath of manifests) {
  const manifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8"));
  assert.equal(
    manifest.engines?.node,
    supportedRange,
    `${manifestPath} must declare engines.node ${supportedRange}`,
  );
}

const npmConfiguration = await readFile(resolve(root, ".npmrc"), "utf8");
const engineStrictAssignments = [...npmConfiguration.matchAll(/^engine-strict\s*=\s*(\S+)\s*$/gmu)];
assert.equal(engineStrictAssignments.length, 1, ".npmrc must define engine-strict exactly once");
assert.equal(engineStrictAssignments[0]?.[1], "true", ".npmrc must enforce engine-strict=true");

const cliBin = await readFile(resolve(root, "apps/cli/src/bin.ts"), "utf8");
const cliSource = ts.createSourceFile("bin.ts", cliBin, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const staticImports = cliSource.statements.filter(ts.isImportDeclaration);
assert.equal(staticImports.length, 1, "the uga entrypoint may statically import only its runtime gate");
assert.equal(
  staticImports[0]?.moduleSpecifier.getText(cliSource),
  '"./runtime.js"',
  "the uga entrypoint must statically import only ./runtime.js",
);

const mainFunction = cliSource.statements.find(
  (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "main",
);
assert(mainFunction && ts.isFunctionDeclaration(mainFunction) && mainFunction.body, "uga must define main");
const runtimeAssertions = [];
const dynamicCliImports = [];
function visitMain(node) {
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === "assertSupportedNodeRuntime") {
      runtimeAssertions.push(node);
    }
    if (
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "./cli.js"
    ) {
      dynamicCliImports.push(node);
    }
  }
  ts.forEachChild(node, visitMain);
}
visitMain(mainFunction.body);
assert.equal(runtimeAssertions.length, 1, "uga main must assert the Node runtime exactly once");
assert.equal(dynamicCliImports.length, 1, "uga main must dynamically import ./cli.js exactly once");
assert(
  runtimeAssertions[0].getStart(cliSource) < dynamicCliImports[0].getStart(cliSource),
  "uga must assert the Node runtime before importing its CLI dependency graph",
);

const workflow = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
for (const requiredFragment of [
  "node-version: 24.11.1",
  "version: 10.34.5",
  "pnpm install --frozen-lockfile",
  "pnpm verify:node-policy",
  "pnpm verify",
]) {
  assert(workflow.includes(requiredFragment), `.github/workflows/ci.yml must include ${requiredFragment}`);
}

console.log(`Node policy verification passed for ${manifests.length} manifests.`);
