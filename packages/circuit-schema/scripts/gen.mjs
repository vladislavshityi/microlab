// Генерирует TypeScript-представление пакета из JSON Schema и JSON-определений.
//
//   node scripts/gen.mjs          записать src/generated/*
//   node scripts/gen.mjs --check  exit 1, если сгенерированные файлы устарели (git не нужен)
//
// Источник истины: schema/*.schema.json и definitions/*.json (сгенерированное вручную не править).
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { compile } from "json-schema-to-typescript";

const ROOT = new URL("../", import.meta.url);
const GENERATED = new URL("src/generated/", ROOT);
const BANNER =
  "/* Сгенерировано scripts/gen.mjs из packages/circuit-schema. Не редактировать вручную. */";

const check = process.argv.includes("--check");

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function compileSchema(fileName) {
  const schema = await readJson(new URL(`schema/${fileName}`, ROOT));
  return compile(schema, schema.title, {
    bannerComment: BANNER,
    cwd: fileURLToPath(new URL("schema/", ROOT)),
    additionalProperties: false,
    unreachableDefinitions: true,
    strictIndexSignatures: true,
    format: true,
  });
}

async function renderDefinitions() {
  const dir = new URL("definitions/", ROOT);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const definitions = [];
  for (const name of files) {
    definitions.push(await readJson(new URL(name, dir)));
  }
  // Аннотация типа заставляет tsc проверить каждое определение по сгенерированным типам.
  return [
    BANNER,
    "",
    'import type { ComponentDefinition } from "./component-definition";',
    "",
    "export const COMPONENT_DEFINITIONS: readonly ComponentDefinition[] = " +
      JSON.stringify(definitions, null, 2) +
      ";",
    "",
  ].join("\n");
}

const outputs = new Map([
  ["circuit.ts", await compileSchema("circuit.schema.json")],
  ["component-definition.ts", await compileSchema("component-definition.schema.json")],
  ["definitions.ts", await renderDefinitions()],
]);

let outdated = false;
for (const [name, content] of outputs) {
  const url = new URL(name, GENERATED);
  if (check) {
    const current = await readFile(url, "utf8").catch(() => null);
    if (current !== content) {
      console.error(`${fileURLToPath(url)} is out of date.`);
      outdated = true;
    }
  } else {
    await writeFile(url, content, "utf8");
    console.log(`Wrote ${fileURLToPath(url)}`);
  }
}

if (outdated) {
  console.error("Run: pnpm --filter @microlab/circuit-schema gen");
  process.exit(1);
}
if (check) {
  console.log("Generated circuit-schema files are up to date.");
}
