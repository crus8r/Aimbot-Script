/**
 * Bundles the whole game into one HTML file.
 *
 * Output is a single self-contained document: no scripts to fetch, no fonts,
 * no analytics, no service worker to go stale. Drop it on any static host —
 * or open it off the filesystem — and it runs, saving to localStorage on the
 * device. That is the entire deployment story, deliberately.
 *
 *   node tools/build-web.ts
 */

import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = join(root, "src/web/shell.html");
const OUT_DIR = join(root, "web");
const OUT = join(OUT_DIR, "index.html");
const FRAGMENT = join(OUT_DIR, "embed.html");
const MARKER = "/*BUNDLE*/";

const result = await build({
  entryPoints: [join(root, "src/web/app.ts")],
  bundle: true,
  format: "iife",
  target: ["es2022", "safari16"], // iOS Safari is the actual platform
  platform: "browser",
  minify: true,
  write: false,
  legalComments: "none",
  logLevel: "warning",
});

const js = result.outputFiles[0]!.text;

// A </script> inside a string literal would close the tag we are about to put
// this inside of. Nothing else in the bundle can escape it.
const safe = js.replace(/<\/script>/gi, "<\\/script>");

const shell = await readFile(SHELL, "utf8");
if (!shell.includes(MARKER)) {
  throw new Error(`shell.html no longer contains ${MARKER} — nowhere to put the bundle`);
}
const html = shell.replace(MARKER, () => safe);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, html, "utf8");

/**
 * The same page with the document wrapper taken off.
 *
 * Some hosts supply their own `<!doctype>`, `<html>`, `<head>` and `<body>` and
 * paste your file inside them; handing those a whole document nests one
 * document inside another. So this is the identical page — same styles, same
 * markup, same inlined engine — as a fragment. The `<title>` is dropped with
 * the head it lived in, because a title in the body does nothing; the host
 * names the page instead.
 */
const head = /<head>([\s\S]*?)<\/head>/i.exec(html);
const body = /<body>([\s\S]*?)<\/body>/i.exec(html);
if (!head || !body) throw new Error("shell.html is no longer a document with a head and a body");
const fragment = `${head[1]!.replace(/\s*<title>[\s\S]*?<\/title>/i, "").trim()}\n${body[1]!.trim()}\n`;
await writeFile(FRAGMENT, fragment, "utf8");

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
console.log(`web/index.html   — ${kb(Buffer.byteLength(html))} total, ${kb(Buffer.byteLength(js))} of it engine`);
console.log(`web/embed.html   — ${kb(Buffer.byteLength(fragment))}, the same page without the document wrapper`);
