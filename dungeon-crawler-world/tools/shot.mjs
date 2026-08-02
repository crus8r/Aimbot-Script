/**
 * Photographs the built page on a phone.
 *
 * A redesign that has only been smoke-tested has been proved not to throw,
 * which is not the same as proved to look like anything.
 *
 *   node tools/shot.mjs
 */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "shots");
mkdirSync(out, { recursive: true });

const exe = process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(pathToFileURL(join(root, "web/index.html")).href);

await p.waitForSelector("#intake.open");
await p.getByRole("button", { name: "Begin" }).click();
await p.locator("#intake-body input.field").fill("Kendrik");
await p.getByRole("button", { name: "Next" }).click();
await p.locator("#intake-body input.field").fill("roofer");
await p.getByRole("button", { name: "Next" }).click();
await p.locator("#intake-body input.field").fill("distance running");
await p.getByRole("button", { name: "Next" }).click();
await p.getByRole("button", { name: "Strength was the whole point" }).click();
await p.getByRole("button", { name: "Look it up and have a go" }).click();
await p.getByRole("button", { name: "Talk to two people, leave early" }).click();
await p.getByRole("button", { name: "Dressed. Shoes on" }).click();
await p.getByRole("button", { name: "lighter", exact: true }).click();
await p.getByRole("button", { name: "tools", exact: true }).click();
await p.getByRole("button", { name: "Next" }).click();
await p.getByRole("button", { name: "A cat" }).click();
await p.waitForSelector("#intake", { state: "hidden" });
await p.waitForTimeout(500);

const shot = async (name) => {
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(out, `${name}.png`) });
  console.log(`shots/${name}.png`);
};

await shot("01-arrival");

// Play until something has happened worth photographing.
for (let i = 0; i < 26; i++) {
  const acts = p.locator("#actions .act:not([disabled]):not(.act--panel)");
  if (!(await acts.count())) break;
  await acts.nth(i % (await acts.count())).click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(90);
  if (await p.locator("#sheet.open").isVisible()) await p.locator("#sheet-close").click().catch(() => {});
  if (await p.locator("#feed .mark").count()) break;
}
await shot("02-played");

await p.locator("#input").fill("break some brick out of the wall");
await p.locator("#send").click();
await p.waitForTimeout(900);
await shot("03-typed");

for (const [tab, name] of [
  ["#tab-inv", "04-manifest"], ["#tab-sheet", "05-personnel"],
  ["#tab-skills", "06-skills"], ["#tab-map", "07-survey"],
]) {
  await p.locator(tab).click();
  await shot(name);
  if (name === "04-manifest") {
    await p.locator("#sheet-body .mrow").first().click().catch(() => {});
    await shot("04b-manifest-open");
  }
  if (name === "05-personnel") {
    await p.locator("#sheet-body .subtabs button", { hasText: "Effects" }).click().catch(() => {});
    await shot("05b-effects");
    await p.locator("#sheet-body .subtabs button", { hasText: "Show" }).click().catch(() => {});
    await shot("05c-show");
  }
  await p.locator("#sheet-close").click().catch(() => {});
}

await b.close();
