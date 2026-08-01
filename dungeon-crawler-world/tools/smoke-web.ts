/**
 * Boots the built page in a real browser and plays it.
 *
 * Everything else in the test suite runs the engine headlessly in Node, which
 * proves the rules and proves nothing at all about whether the thing you can
 * actually tap works. This walks the intake, takes turns, opens the sheets,
 * reloads the page and checks the run came back — because "sessions save" is a
 * promise about a phone, not about a function.
 *
 *   npm run smoke
 */

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page_url = pathToFileURL(join(root, "web/index.html")).href;

if (!existsSync(join(root, "web/index.html"))) {
  console.error("web/index.html is not built. Run: node tools/build-web.ts");
  process.exit(1);
}

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
// A small phone, because that is the target and the target is unforgiving.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto(page_url);

/* ------------------------------------------------------------- intake */

await page.waitForSelector("#intake.open");
await page.getByRole("button", { name: "Begin" }).click();
await page.locator("#intake-body input.field").fill("Smoke");
await page.getByRole("button", { name: "Next" }).click();
await page.locator("#intake-body input.field").fill("scaffolder");
await page.getByRole("button", { name: "Next" }).click();
await page.locator("#intake-body input.field").fill("competitive shooting");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Strength was the whole point" }).click();
await page.getByRole("button", { name: "Look it up and have a go" }).click();
await page.getByRole("button", { name: "Talk to two people, leave early" }).click();
await page.getByRole("button", { name: "Dressed. Shoes on" }).click();
await page.getByRole("button", { name: "lighter", exact: true }).click();
await page.getByRole("button", { name: "tools", exact: true }).click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "A cat" }).click();

await page.waitForSelector("#intake", { state: "hidden" });
await page.waitForTimeout(300);
check((await page.locator("#name").textContent()) === "Smoke", "intake produced the crawler you asked for");
check((await page.locator("#feed .line").count()) > 0, "the opening narration arrived");
check((await page.locator("#actions .act").count()) > 0, "there is something to tap");

/* --------------------------------------------------------------- play */

// Tap whatever is on offer for a while. Deliberately dumb: the point is that
// nothing on screen can throw, not that the choices are good ones.
for (let i = 0; i < 60; i++) {
  const acts = page.locator("#actions .act:not([disabled])");
  const n = await acts.count();
  if (!n) break;
  await acts.nth(i % n).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(30);
  if (await page.locator("#sheet.open").isVisible()) await page.locator("#sheet-close").click();
}
check((await page.locator("#feed .line").count()) > 3, "sixty taps produced a game");

/* -------------------------------------------------------------- typing */

await page.locator("#input").fill("look under the shelving for anything I can use");
await page.locator("#send").click();
await page.waitForTimeout(400);
const feed = (await page.locator("#feed").textContent()) ?? "";
check(feed.includes("look under the shelving"), "freeform input reached the interpreter");

/* -------------------------------------------------------------- sheets */

for (const [tab, title] of [
  ["#tab-inv", "Inventory"], ["#tab-sheet", "Crawler"], ["#tab-skills", "Skills"],
  ["#tab-spells", "Spells"], ["#tab-craft", "Workshop"], ["#tab-map", "Floor"], ["#tab-menu", "Menu"],
] as const) {
  await page.locator(tab).click();
  const open = await page.locator("#sheet.open").isVisible();
  const heading = await page.locator("#sheet-title").textContent();
  check(open && heading === title, `${title} sheet opens`);
  await page.locator("#sheet-close").click();
}

/* --------------------------------------------------------------- saving */

const saved = await page.evaluate(() => localStorage.getItem("dcw:save:v2"));
check(!!saved && saved.length > 500, "the run is in localStorage");
const before = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("dcw:save:v2")!);
  return { name: s.crawler.name, elapsed: s.elapsed, xp: s.crawler.xp, floor: s.floor.n };
});

await page.reload();
await page.waitForTimeout(300);
check(!(await page.locator("#intake.open").isVisible()), "a reload does not restart your run");
check((await page.locator("#name").textContent()) === before.name, "the crawler came back by name");
const after = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("dcw:save:v2")!);
  return { elapsed: s.elapsed, xp: s.crawler.xp, floor: s.floor.n };
});
check(
  after.elapsed === before.elapsed && after.xp === before.xp && after.floor === before.floor,
  "the clock, the experience and the floor all survived the reload",
);

// And it still takes turns after coming back from disk.
const post = page.locator("#actions .act:not([disabled])");
if (await post.count()) {
  const lines = await page.locator("#feed .line").count();
  await post.first().click().catch(() => {});
  await page.waitForTimeout(300);
  check((await page.locator("#feed .line").count()) > lines, "a restored run can still act");
}

/* ------------------------------------------------ the sheet has to be live */

// Every button in a sheet changes state the sheet is drawing. Nothing used to
// redraw it, so the pack looked identical after wearing something and the game
// read as broken.
await page.locator("#tab-inv").click();
await page.waitForTimeout(200);
// Lock, because it is the one pack action that always changes what the row
// says (a padlock appears) whatever the run's random seed handed you.
{
  const lock = page.locator("#sheet-body .act", { hasText: /^lock$/ }).first();
  if (await lock.count()) {
    const before = await page.locator("#sheet-body").textContent();
    await lock.click();
    await page.waitForTimeout(600);
    const after = await page.locator("#sheet-body").textContent();
    check(before !== after, "the pack redraws after an action taken inside it");
    check((after ?? "").includes("🔒"), "and the change is the one you asked for");
  } else {
    check(false, "no lockable item in the pack — the redraw check did not run");
  }
}
// And it must be closable by more than one 33px button.
await page.keyboard.press("Escape");
check(!(await page.locator("#sheet.open").isVisible()), "Escape closes a sheet");

/* --------------------------------------------- taking things in, for free */

// The freeform box must answer a question rather than shrug at it, and asking
// one must never cost a turn.
{
  const before = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("dcw:save:v2")!);
    return { elapsed: s.elapsed, round: s.encounter?.round ?? null };
  });
  await page.locator("#input").fill("i'm gonna look around, see what the walls and floor are made of");
  await page.locator("#send").click();
  await page.waitForTimeout(600);
  const feed = (await page.locator("#feed").textContent()) ?? "";
  check(!/does not know how to resolve/i.test(feed), "looking around is not met with a shrug");
  check(/Taking the room in|Doing the first part/i.test(feed), "it says what it understood");
  const after = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("dcw:save:v2")!);
    return { elapsed: s.elapsed, round: s.encounter?.round ?? null };
  });
  check(after.elapsed === before.elapsed, "asking a question costs no time");
  check(after.round === before.round, "asking a question costs no combat round");
}

/* ------------------------------------------------------------ no layout */

// Nothing may push the page sideways on a 390px phone.
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, `nothing overflows the phone (${overflow}px)`);

check(errors.length === 0, `no uncaught errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);

await browser.close();

console.log(failures.length ? `\n${failures.length} failed` : "\nweb build is playable");
process.exit(failures.length ? 1 : 0);
