// Генерирует snippet nginx с Content-Security-Policy для собранного index.html.
// Встроенные скрипты (применение темы до отрисовки) разрешаются по SHA-256,
// поэтому 'unsafe-inline' для script-src не нужен.
// Использование: node gen-csp.mjs <dist/index.html> <csp.conf>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [indexPath, outPath] = process.argv.slice(2);
if (indexPath === undefined || outPath === undefined) {
  console.error("usage: node gen-csp.mjs <index.html> <csp.conf>");
  process.exit(2);
}

const html = readFileSync(indexPath, "utf8");
const hashes = [];
for (const match of html.matchAll(/<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/g)) {
  const { attrs, body } = match.groups;
  if (/\bsrc\s*=/.test(attrs) || body.length === 0) {
    continue;
  }
  hashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
}

const policy = [
  "default-src 'self'",
  ["script-src 'self'", ...hashes].join(" "),
  // Monaco и React задают стили во время работы (style-элементы и атрибуты style).
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Web Worker Monaco загружается из /assets.
  "worker-src 'self' blob:",
  // REST и WebSocket только к своему origin.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

writeFileSync(outPath, `add_header Content-Security-Policy "${policy}" always;\n`);
console.log(`csp: ${hashes.length} inline script hash(es)`);
