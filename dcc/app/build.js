#!/usr/bin/env node
/* Inline lore.js and rules.js into index.html to produce a single
   self-contained page at ../play/index.html.

   Why: one file drags onto any static host, survives being emailed, and
   removes the "keep these three together" footgun. The three-file version
   in this folder stays the one you edit; re-run `node build.js` after.

   Usage:  node build.js
*/
const fs = require("fs");
const path = require("path");

const here = __dirname;
const outDir = path.join(here, "..", "play");
const html = fs.readFileSync(path.join(here, "index.html"), "utf8");

const inline = name => {
  const src = fs.readFileSync(path.join(here, name), "utf8");
  // A literal </script> inside a JS string would close the tag early.
  return src.replace(/<\/script>/gi, "<\\/script>");
};

let out = html
  .replace('<script src="lore.js"></script>',
    "<script>\n/* ---- lore.js ---- */\n" + inline("lore.js") + "\n</script>")
  .replace('<script src="rules.js"></script>',
    "<script>\n/* ---- rules.js ---- */\n" + inline("rules.js") + "\n</script>");

if (out.includes('src="lore.js"') || out.includes('src="rules.js"')) {
  console.error("build failed: script tags not replaced — did index.html change?");
  process.exit(1);
}

out = out.replace("<title>Crawl</title>",
  "<title>Crawl</title>\n<!-- Single-file build. Edit dcc/app/{lore,rules}.js and re-run build.js. -->");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), out);

const kb = n => (n / 1024).toFixed(1) + " KB";
console.log("built  ../play/index.html  " + kb(Buffer.byteLength(out)));
