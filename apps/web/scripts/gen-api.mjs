// Генерирует типы TypeScript из OpenAPI-контракта backend.
//
//   node scripts/gen-api.mjs          записать src/api/generated/openapi.ts
//   node scripts/gen-api.mjs --check  exit 1, если закоммиченный файл устарел (git не нужен)
//
// Источник истины: apps/api/openapi.json (экспортируется из backend; вручную не править).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";

const SCHEMA_URL = new URL("../../api/openapi.json", import.meta.url);
const OUTPUT_URL = new URL("../src/api/generated/openapi.ts", import.meta.url);

const check = process.argv.includes("--check");

const ast = await openapiTS(SCHEMA_URL);
const generated = COMMENT_HEADER + astToString(ast);

const outputPath = fileURLToPath(OUTPUT_URL);

if (check) {
  const current = await readFile(outputPath, "utf8").catch(() => null);
  if (current !== generated) {
    console.error(
      `${outputPath} is out of date with apps/api/openapi.json.\nRun: pnpm --filter @microlab/web gen:api`,
    );
    process.exit(1);
  }
  console.log("Generated API types are up to date.");
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(`Wrote ${outputPath}`);
}
