// Headless runs of Sunny Lane with screenshots. The loop is stepped by hand
// (?test), so every run is the same run.
//
// node tools/homes-shots.mjs <scenario> [outdir]
import { withPage, waitReady } from './harness.mjs';
import fs from 'node:fs';

const name = process.argv[2] || 'overview';
const outDir = process.argv[3] || process.env.SHOTS || '/tmp/homes';
fs.mkdirSync(outDir, { recursive: true });
const mobile = !!process.env.MOBILE;

const helpers = `
  window.T = {
    step(n, dt = 1/30) { for (let i = 0; i < n; i++) game.step(dt, i === n - 1); },
    cam(x, z, o) { game.view.focus(x, z, { ...o, instant: true }); game.step(1/30); },
    // Where a world point lands on screen (for real mouse clicks).
    screen(v) { const p = v.clone().project(game.camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; },
    item(id) { return game.home.items.list.find((i) => i.id === id); },
    itemScreen(id, dy = 0.5) { const it = T.item(id); const p = it.group.position.clone(); p.y += dy; return T.screen(p); },
    sim(name) { return game.sims.find((s) => s.name === name); },
    state() { return game.sims.map((s) => ({ name: s.name, task: s.task && s.task.label, q: s.queue.length, state: s.actor.state, pos: s.pos.toArray().map((v) => +v.toFixed(2)), needs: Object.fromEntries(Object.entries(s.needs).map(([k, v]) => [k, Math.round(v)])) })); },
  };
`;

const scenarios = {
  async overview(page, shot, log) {
    await page.evaluate(helpers);
    log(await page.evaluate(() => ({ items: game.home.items.list.length, runs: game.home.house.runs.length, sims: game.sims.length, calls: game.renderer.info.render.calls })));
    await page.evaluate(() => { T.step(3); });
    await shot('01-cutaway');
    log(await page.evaluate(() => ({ calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles })));
    await page.evaluate(() => { game.home.house.setRoof(true); T.cam(0, 2, { dist: 34, pitch: 0.5, yaw: 0.5 }); T.step(3); });
    await shot('02-roof');
    await page.evaluate(() => { game.home.house.setRoof(false); T.cam(0, -2, { dist: 30, pitch: 1.2, yaw: Math.PI / 4 }); T.step(3); });
    await shot('03-top');
    await page.evaluate(() => { T.cam(0, 0, { dist: 70, pitch: 0.55, yaw: 0.3 }); T.step(3); });
    await shot('04-street');
  },
};

scenarios.tour = async (page, shot, log) => {
  await page.evaluate(helpers);
  const click = async (xy) => { await page.mouse.click(xy[0], xy[1]); await page.evaluate(() => T.step(2)); };
  const pickOpt = async (label) => {
    const ok = await page.evaluate((label) => { const b = [...document.querySelectorAll('#pie .opt')].find((x) => x.textContent === label); if (!b) return [...document.querySelectorAll('#pie .opt')].map((x) => x.textContent); b.click(); return true; }, label);
    if (ok !== true) log('no option', label, 'have', ok);
  };
  await page.evaluate(() => T.step(3));
  await shot('01-live');
  log('calls', await page.evaluate(() => { const i = game.renderer.info.render; return { calls: i.calls, tris: i.triangles, batch: game.home.items.batchMeshes.length }; }));
  // Maya: watch TV. Click the TV, then the pie option.
  await page.evaluate(() => { T.cam(-4.5, 1.5, { dist: 15, pitch: 0.85, yaw: Math.PI / 4 }); T.step(2); });
  await click(await page.evaluate(() => T.itemScreen('tv', 0.9)));
  await page.evaluate(() => T.step(6));
  await page.waitForTimeout(500);
  await shot('02-pie-tv');
  await pickOpt('Watch TV');
  // Theo: a snack from the fridge.
  await page.evaluate(() => { game.select(T.sim('Theo')); T.step(2); });
  await click(await page.evaluate(() => T.itemScreen('fridge', 1.0)));
  await pickOpt('Have a snack');
  await page.evaluate(() => T.step(30 * 12));
  log('after 12s', await page.evaluate(() => T.state()));
  await page.evaluate(() => T.step(30 * 10));
  log('after 22s', await page.evaluate(() => T.state()));
  await page.evaluate(() => { T.cam(-4, 1.5, { dist: 11, pitch: 0.7, yaw: 0.9 }); T.step(2); });
  await shot('03-living');
  // Typed line: Theo speaks, the nearest housemate answers.
  await page.evaluate(() => { game.ui.openChat(); document.getElementById('chat-input').value = 'Hey Maya, what are you watching?'; });
  await shot('04-chat');
  await page.evaluate(() => { document.getElementById('chat').requestSubmit(); T.step(20); });
  await page.evaluate(() => T.step(30 * 3));
  await shot('05-reply');
  log('bubbles', await page.evaluate(() => [...document.querySelectorAll('.bubble')].map((b) => b.textContent)));
  // Buy mode: catalogue, a sofa on the ghost.
  await page.evaluate(() => { game.ui.setMode('buy'); T.cam(0, 0, { dist: 22, pitch: 0.9, yaw: Math.PI / 4 }); T.step(10); });
  await page.evaluate(() => T.step(20));
  await shot('06-buy');
  await page.evaluate(() => { game.ui.cat = 'seating'; game.ui.renderCatalog(); T.step(20); game.ui.build.hold('sofa_rust'); const [x, z] = game.home.house.toWorld(-3, 5); game.ui.build.aim(x, z); T.step(3); });
  log('ghost', await page.evaluate(() => game.ui.build.held.place));
  await shot('07-ghost-bad');
  await page.evaluate(() => { const [x, z] = game.home.house.toWorld(3.8, 1.2); game.ui.build.rotateHeld(1); game.ui.build.aim(x, z); T.step(3); });
  log('ghost2', await page.evaluate(() => game.ui.build.held.place));
  await shot('08-ghost-ok');
  await page.evaluate(() => { game.ui.build.place(); game.ui.build.drop(); T.step(3); });
  // Build: paint the kitchen, new floor in the living room, a window.
  await page.evaluate(() => { game.ui.setMode('build'); T.step(3); });
  await page.evaluate(() => {
    const h = game.home.house, room = h.rooms.find((r) => r.id === 'living');
    h.paintRoom(room, 'navy'); h.setFloor(room, 'walnut');
    h.paintRoom(h.rooms.find((r) => r.id === 'kitchen'), 'mint');
    h.addOpening(-7, 0.6, 'window', 1.2);
    game.ui.setWalls('cutaway'); T.cam(-2, 1, { dist: 16, pitch: 0.9, yaw: Math.PI / 4 }); T.step(3);
  });
  await shot('09-build');
  await page.evaluate(() => { game.ui.setMode('live'); game.day.setHours(21); T.step(30); T.cam(0, 0, { dist: 20, pitch: 0.75, yaw: Math.PI / 4 }); T.step(10); });
  await shot('10-night');
  await page.evaluate(() => { game.day.setHours(17.8); game.home.house.setRoof(true); T.cam(0, 4, { dist: 30, pitch: 0.35, yaw: 0.25 }); T.step(10); });
  await shot('11-golden');
};

// Every object action, one after another, with a verdict for each.
scenarios.actions = async (page, shot, log) => {
  await scenarios.actions.setup(page);
  const R = async (...a) => log(await page.evaluate((a) => run(...a), a));
  await scenarios.actions.body(page, shot, log, R);
};
scenarios.actions.setup = async (page) => {
  await page.evaluate(helpers);
  await page.evaluate(() => {
    game.settings.freeWill = false;
    window.notes = [];
    game.onSimNote = (s, why) => notes.push(`${s.name}: ${why}`);
    window.run = (simName, itemId, label, max = 900, nth = 0) => {
      const sim = T.sim(simName);
      const item = game.home.items.list.filter((i) => i.id === itemId)[nth];
      if (!item) return { label, err: 'no item ' + itemId };
      const acts = game.ui ? null : null;
      const all = window.__acts(sim, item);
      const a = all.find((x) => x.label === label);
      if (!a) return { label, err: 'no action', have: all.map((x) => x.label) };
      const t = a.make();
      sim.push(t, { now: true });
      let i = 0;
      for (; i < max; i++) { game.step(1 / 30, false); if (!sim.task && !sim.queue.length) break; }
      game.step(1 / 30, true);
      return { label, frames: i, state: sim.actor.state, pos: sim.pos.toArray().map((v) => +v.toFixed(2)), notes: notes.splice(0) };
    };
  });
  await page.evaluate(() => { window.__acts = (sim, item) => window.__itemActions(game, sim, item); });
};
scenarios.actions.body = async (page, shot, log, R) => {
  await R('Theo', 'bed_double', 'Nap', 1200);
  await page.evaluate(() => { const s = T.sim('Theo'); s.needs.energy = 20; const it = T.item('bed_double'); const a = __itemActions(game, s, it).find((x) => x.label === 'Sleep') || __itemActions(game, s, it).find((x) => x.label === 'Nap'); s.push(a.make(), { now: true }); T.step(30 * 9); T.cam(3.6, -3.4, { dist: 7, pitch: 0.8, yaw: 0.6 }); T.step(2); });
  await shot('01-sleep');
  log(await page.evaluate(() => T.state()[1]));
  await page.evaluate(() => { T.sim('Theo').cancelAll(); T.step(30 * 6); });
  await R('Maya', 'shower', 'Take a shower', 900);
  await R('Maya', 'toilet', 'Use the toilet', 900);
  await R('Maya', 'basin', 'Wash hands', 600);
  await R('Maya', 'tub', 'Take a bath', 900);
  await R('Ruby', 'office_chair', 'Use the computer', 300);
  await page.evaluate(() => { T.cam(-4.2, -1.8, { dist: 6, pitch: 0.7, yaw: 0.5 }); T.step(2); });
  await shot('02-computer');
  await R('Ruby', 'kitchen_run', 'Cook a meal', 900);
  await R('Ruby', 'fridge', 'Grab a drink', 600);
  await R('Ruby', 'grill', 'Grill burgers', 900);
  await R('Theo', 'lounger', 'Sunbathe', 300);
  await page.evaluate(() => { T.cam(-3.2, -9.8, { dist: 7, pitch: 0.7, yaw: 0.4 }); T.step(2); });
  await shot('03-lounger');
  await R('Theo', 'wardrobe', 'Change outfit', 900);
  await R('Maya', 'bookshelf', 'Read a book', 1200);
  await R('Maya', 'boombox', 'Play music', 600);
  await R('Maya', 'boombox', 'Dance', 900);
  await R('Ruby', 'mailbox', 'Check the mail', 900);
  await R('Ruby', 'flower_bed', 'Water the flowers', 900);
  await R('Ruby', 'floor_lamp', 'Turn light on', 900);
  await R('Theo', 'picnic', 'Sit', 900);
  await R('Theo', 'stool', 'Sit', 900);
  await page.evaluate(() => { T.cam(4.8, 2.6, { dist: 6, pitch: 0.7, yaw: 0.7 }); T.step(2); });
  await shot('04-stool');
  await R('Maya', 'painting_2', 'Admire', 900);
  log('final', await page.evaluate(() => T.state()));
};

// Every preset piece checked against the same rules the buy tool uses.
scenarios.presets = async (page, shot, log) => {
  await page.evaluate(helpers);
  for (const lot of ['A', 'B', 'C']) {
    const r = await page.evaluate((lot) => {
      if (game.home.lot.id !== lot) game.moveTo(lot);
      T.step(2);
      const I = game.home.items;
      const bad = [];
      for (const it of I.list) {
        const wall = it.wall ? { run: it.wallRun, side: it.wallSide } : null;
        const why = I.whyNot(it.entry, it.x, it.z, it.rot, it.y, { ignore: it, wall });
        if (why) bad.push(`${it.id}@${it.x},${it.z}: ${why}`);
      }
      // Can someone standing on the path reach every seat and doorway?
      const [sx, sz] = game.home.plan.spawn;
      const from = game.home.house.toWorld(sx, sz);
      const unreachable = [];
      for (const s of I.seats()) { const p = game.nav.find(from[0], from[1], s.standPoint.x, s.standPoint.z); if (!p) unreachable.push(`${s.item.id}`); }
      return { lot, items: I.list.length, bad, unreachable, calls: game.renderer.info.render.calls };
    }, lot);
    log(r);
  }
};

scenarios.actions2 = async (page, shot, log) => {
  await scenarios.actions.setup(page);
  const R = async (...a) => log(await page.evaluate((a) => run(...a), a));
  await page.evaluate(() => { game.moveTo('A'); T.step(5); });
  await R('Maya', 'shower', 'Take a shower', 700);
  await page.evaluate(() => { const s = T.sim('Maya'); const it = T.item('shower'); s.push(__itemActions(game, s, it).find((x) => x.label === 'Take a shower').make(), { now: true }); T.step(30 * 9); T.cam(-28 + 4.4, -1.4, { dist: 6, pitch: 0.75, yaw: 0.6 }); T.step(2); });
  await shot('01-shower');
  await page.evaluate(() => T.step(30 * 8));
  await R('Theo', 'mailbox', 'Check the mail', 900);
  await R('Ruby', 'picnic', 'Sit', 900);
  await page.evaluate(() => { game.moveTo('C'); T.step(5); });
  await R('Maya', 'piano', 'Play piano', 400);
  await page.evaluate(() => { T.cam(28 - 6, 5, { dist: 6, pitch: 0.7, yaw: 0.8 }); T.step(2); });
  await shot('02-piano');
  await R('Theo', 'lounger', 'Sunbathe', 900);
  await R('Ruby', 'office_chair', 'Use the computer', 500);
  await page.evaluate(() => { T.cam(28, -4, { dist: 13, pitch: 0.8, yaw: 0.6 }); T.step(2); });
  await shot('03-courtyard');
  log('final', await page.evaluate(() => T.state()));
};

// Saving, moving house and back, export and import.
scenarios.persist = async (page, shot, log) => {
  await page.evaluate(helpers);
  log(await page.evaluate(() => {
    const B = game.ui.build, h = game.home.house;
    const n0 = game.home.items.list.length;
    game.ui.setMode('buy');
    B.hold('plant_big'); const [x, z] = h.toWorld(-1.5, 3.5); B.aim(x, z); const placed = B.place(); B.drop();
    B.hold('painting_2'); const [wx, wz] = h.toWorld(-1.9, 5.85); B.aim(wx, wz); const hung = B.held.place; B.place(); B.drop();
    h.paintRoom(h.rooms.find((r) => r.id === 'kids'), 'blush');
    const funds = game.funds;
    game.save();
    game.moveTo('C'); game.moveTo('B');
    const back = { n: game.home.items.list.length, painted: Object.values(game.home.house.paint).filter((v) => v === 'blush').length, funds: game.funds };
    const exported = JSON.stringify(game.exportLot());
    game.resetLot();
    const afterReset = game.home.items.list.length;
    game.importLot(JSON.parse(exported));
    const afterImport = game.home.items.list.length;
    const undo = (() => { game.ui.setMode('buy'); const it = game.home.items.list.find((i) => i.id === 'plant_big'); game.ui.build.select(it); game.ui.build.sell(); const a = game.home.items.list.length; game.ui.build.undo(); return [a, game.home.items.list.length]; })();
    return { n0, placed, hung: hung.why || 'ok', funds, back, bytes: exported.length, afterReset, afterImport, undo };
  }));
};

scenarios.phone = async (page, shot, log) => {
  await page.evaluate(helpers);
  await page.evaluate(() => T.step(30 * 8));
  await shot('01-live');
  await page.evaluate(() => { const it = T.item('sofa_blue'); const p = it.group.position.clone(); p.y += 0.6; game.view.focus(p.x, p.z, { dist: 18, instant: true }); T.step(2); });
  const xy = await page.evaluate(() => T.itemScreen('sofa_blue', 0.6));
  await page.touchscreen.tap(xy[0], xy[1]);
  await page.evaluate(() => T.step(4));
  await page.waitForTimeout(500);
  await shot('02-pie');
  await page.evaluate(() => { game.ui.closePie(); game.ui.setMode('buy'); game.ui.cat = 'outdoor'; game.ui.renderCatalog(); T.step(40); });
  await page.evaluate(() => { game.ui.build.hold('palm_0'); const [x, z] = game.home.house.toWorld(9, 8); game.ui.build.aim(x, z); game.view.focus(x, z, { dist: 22, instant: true }); T.step(3); });
  await shot('03-buy');
  await page.evaluate(() => { game.ui.build.drop(); game.ui.setMode('build'); T.step(3); });
  await shot('04-build');
  await page.evaluate(() => { game.ui.setMode('live'); game.ui.openChat(); document.getElementById('chat-input').value = 'Ruby, want to go swimming?'; T.step(2); });
  await shot('05-chat');
  await page.evaluate(() => { document.getElementById('chat').requestSubmit(); T.step(30 * 3); game.view.focus(game.selected.pos.x, game.selected.pos.z, { dist: 12, instant: true }); T.step(3); });
  await shot('06-talk');
  log(await page.evaluate(() => [...document.querySelectorAll('.bubble')].map((b) => b.textContent)));
};

// The pictures that go to people: a tour of what the game does.
scenarios.showcase = async (page, shot, log) => {
  await page.evaluate(helpers);
  const wait = (ms) => page.waitForTimeout(ms);
  // Let the household get on with things for a while.
  await page.evaluate(() => {
    const act = (sim, id, label) => { const s = T.sim(sim); const a = __itemActions(game, s, T.item(id)).find((x) => x.label === label); s.push(a.make(), { now: true }); };
    act('Maya', 'tv', 'Watch TV'); act('Theo', 'kitchen_run', 'Cook a meal'); act('Ruby', 'boombox', 'Dance');
    T.step(30 * 16);
  });
  await page.evaluate(() => { T.cam(0.5, 0.5, { dist: 24, pitch: 0.82, yaw: Math.PI / 4 }); T.step(4); });
  await shot('01-family-house');
  await page.evaluate(() => { game.select(T.sim('Theo')); game.ui.openChat(); });
  await page.evaluate(() => { document.getElementById('chat-input').value = 'Maya, dinner is almost ready!'; document.getElementById('chat').requestSubmit(); T.step(30 * 3.4); T.cam(0.5, 2.2, { dist: 13, pitch: 0.7, yaw: 0.95 }); T.step(4); });
  await shot('02-talking');
  // A pie menu on a housemate.
  await page.evaluate(() => { T.cam(-3.5, 2.5, { dist: 12, pitch: 0.75, yaw: Math.PI / 4 }); T.step(2); });
  const xy = await page.evaluate(() => { const p = T.sim('Maya').pos.clone(); p.y += 1.0; return T.screen(p); });
  await page.mouse.click(xy[0], xy[1]);
  await page.evaluate(() => T.step(3));
  await wait(600);
  await shot('03-pie-menu');
  await page.evaluate(() => game.ui.closePie());
  // Buy: the catalogue, and a sofa being placed.
  await page.evaluate(() => { game.ui.setMode('buy'); game.ui.cat = 'seating'; game.ui.renderCatalog(); T.step(40); game.ui.build.hold('velvet_sofa'); game.ui.build.rotateHeld(1); const [x, z] = game.home.house.toWorld(-1.2, 4.2); game.ui.build.aim(x, z); T.cam(-2, 3, { dist: 14, pitch: 0.85, yaw: Math.PI / 4 }); T.step(4); });
  await wait(300);
  await shot('04-buy-furniture');
  // The yard: palms, a hammock-free lounge, a grill, a flower bed.
  await page.evaluate(() => {
    const B = game.ui.build; B.drop();
    game.ui.cat = 'outdoor'; game.ui.renderCatalog(); T.step(40);
    for (const [id, x, z, r] of [['tree_1', 11, -11.5, 0], ['flower_bed', 8.5, -12.3, 0], ['flower_bed_blue', 6.5, -12.3, 0], ['garden_lamp', 9.5, -9.5, 0], ['bench', 11.5, -7.5, -Math.PI / 2], ['deck', 9, -7, 0], ['deck', 9, -5, 0], ['table_round', 9, -6, 0], ['chair_wood', 8.25, -6, Math.PI / 2], ['chair_wood', 9.75, -6, -Math.PI / 2]]) {
      B.hold(id); B.held.rot = r; const [wx, wz] = game.home.house.toWorld(x, z); B.aim(wx, wz); B.place(); B.drop();
    }
    B.hold('lounger'); B.held.rot = Math.PI; const [ux, uz] = game.home.house.toWorld(11.2, -4.2); B.aim(ux, uz);
    T.cam(8, -7.5, { dist: 15, pitch: 0.95, yaw: 0.75 }); T.step(4);
  });
  await wait(300);
  await shot('05-buy-yard');
  // Build: repaint and refloor a room, add a window.
  await page.evaluate(() => {
    game.ui.build.drop();
    game.ui.setMode('build');
    const h = game.home.house;
    game.ui.build.commit();
    h.paintRoom(h.rooms.find((r) => r.id === 'master'), 'terracotta');
    h.setFloor(h.rooms.find((r) => r.id === 'master'), 'carpetBeige');
    h.paintRoom(h.rooms.find((r) => r.id === 'kids'), 'mint');
    game.ui.swatch.paint = 'terracotta'; game.ui.renderBuild();
    game.ui.setWalls('cutaway');
    T.cam(2.5, -3, { dist: 13, pitch: 0.9, yaw: -0.6 }); T.step(4);
  });
  await shot('06-build-paint');
  // The other two houses.
  await page.evaluate(() => { game.ui.setMode('live'); game.moveTo('A'); T.step(30 * 4); T.cam(-28, 1, { dist: 20, pitch: 0.8, yaw: Math.PI / 4 }); T.step(4); });
  await shot('07-cottage');
  await page.evaluate(() => { game.moveTo('C'); T.step(30 * 4); T.cam(28, 0, { dist: 23, pitch: 0.85, yaw: Math.PI / 4 }); T.step(4); });
  await shot('08-bungalow');
  // Evening on the lane, roofs on.
  await page.evaluate(() => { game.day.setHours(16.9); game.home.house.setRoof(true); T.step(3); T.cam(8, 6, { dist: 44, pitch: 0.33, yaw: 0.2 }); T.step(6); });
  await shot('09-street');
  await page.evaluate(() => { game.home.house.setRoof(false); game.day.setHours(21.2); T.step(20); T.cam(28, 1, { dist: 20, pitch: 0.8, yaw: Math.PI / 4 }); T.step(10); });
  await shot('10-night');
};

const t0 = Date.now();
const q = `homes.html?test&${process.env.Q || ''}`;
await withPage(q, async (page, logs) => {
  try { await waitReady(page, 300000); } catch (e) { console.log(logs.join('\n')); throw e; }
  const shot = async (n) => { await page.screenshot({ path: `${outDir}/${name}-${n}.png`, timeout: 180000 }); };
  const log = (...a) => console.log(...a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)));
  try { await scenarios[name](page, shot, log); } finally {
    const errs = logs.filter((l) => /error|warn/i.test(l) && !/Canvas2D|THREE.Clock|favicon/.test(l));
    if (errs.length) console.log('--- console ---\n' + errs.slice(0, 30).join('\n'));
  }
}, { width: mobile ? 390 : 1280, height: mobile ? 844 : 720, entries: ['main', 'homes'], mobile });
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${outDir}`);
