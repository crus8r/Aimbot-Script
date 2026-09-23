// Scripted runs of the real game in a headless browser. Each scenario drives
// inputs frame by frame (the loop is stepped manually under ?test, so runs
// are deterministic) and saves screenshots for inspection.
//
// node tools/scenarios.mjs <name> [outdir]
import { withPage, waitReady } from './harness.mjs';
import fs from 'node:fs';

const name = process.argv[2] || 'yard';
const outDir = process.argv[3] || process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(outDir, { recursive: true });

const helpers = `
  window.T = {
    // Only the last frame renders: software GL is slow, and a backlog of
    // queued frames makes the screenshot time out.
    step(n, dt = 1/30) { for (let i = 0; i < n; i++) game.step(dt, i === n - 1); },
    hold(keys) { for (const k of keys) { game.input.keys.add(k); game.input.pressed.add(k); } },
    release(keys) { for (const k of keys) game.input.keys.delete(k); },
    tap(k) { game.input.keys.add(k); game.input.pressed.add(k); game.step(1/30, false); game.input.keys.delete(k); },
    look(yaw, pitch) { game.follow.yaw = yaw; if (pitch !== undefined) game.follow.pitch = pitch; },
    state() { const p = game.player; return { pos: p.object.position.toArray().map(v => +v.toFixed(3)), heading: +p.heading.toFixed(3), state: p.state, busy: p.busy, speed: +p.speed.toFixed(2), grounded: p.grounded, full: p.fullName, layer: p.layer && p.layer.name, prompt: game.prompt && game.prompt.label(p) }; },
  };
`;

const scenarios = {
  async drive(page, shot, log) {
    await page.evaluate(helpers);
    log('traffic', await page.evaluate(() => ({ cars: game.traffic.cars.length, ai: game.traffic.cars.filter((c) => c.mode === 'ai').length, parked: game.traffic.parkedCount, hero: !!game.traffic.hero, lanes: game.traffic.lanes.length })));
    await page.evaluate(() => { T.step(60); });
    log('ai moved', await page.evaluate(() => game.traffic.cars.filter((c) => c.mode === 'ai').slice(0, 5).map((c) => [c.speed.toFixed(1), c.seg && c.seg.kind, c.object.position.x.toFixed(0), c.object.position.z.toFixed(0)])));
    // A street view with traffic.
    await page.evaluate(() => { game.player.place(186, 0.15, 30, Math.PI); T.look(0.3, 0.1); T.step(10); });
    await shot('00-street');
    // Walk to the Ferrari and get in.
    await page.evaluate(() => { const h = game.traffic.hero; const d = h.doorPoint(h.object.position.clone()); game.player.place(d.x + 0.8, 0.15, d.z + 1.0, h.heading); T.look(h.heading + Math.PI + 0.6, 0.2); T.step(5); });
    log('prompt near car', await page.evaluate(() => T.state().prompt));
    await shot('01-by-car');
    await page.evaluate(() => { game.traffic.toggleVehicle(); T.step(60); });
    log('after F', await page.evaluate(() => ({ ...T.state(), veh: !!game.player.vehicle })));
    await shot('02-in-car');
    await page.evaluate(() => { T.hold(['KeyW']); T.step(90); });
    log('driving', await page.evaluate(() => ({ speed: game.player.vehicle && game.player.vehicle.speed.toFixed(1), pos: game.player.object.position.toArray().map((v) => v.toFixed(1)) })));
    await shot('03-driving');
    await page.evaluate(() => { T.hold(['KeyA']); T.step(40); T.release(['KeyA']); T.step(30); });
    log('turned', await page.evaluate(() => ({ speed: game.player.vehicle && game.player.vehicle.speed.toFixed(1), heading: game.player.vehicle && game.player.vehicle.heading.toFixed(2), pos: game.player.object.position.toArray().map((v) => v.toFixed(1)) })));
    await shot('04-turned');
    await page.evaluate(() => { T.release(['KeyW']); T.hold(['KeyS']); T.step(40); T.release(['KeyS']); T.step(20); game.traffic.toggleVehicle(); T.step(20); });
    log('exited', await page.evaluate(() => T.state()));
    await shot('05-exited');
  },
  async people(page, shot, log) {
    await page.evaluate(helpers);
    await page.evaluate(() => { T.step(40); });
    log('counts', await page.evaluate(() => {
      const c = { actors: game.actors.length, visibleActors: game.actors.filter((a) => a.object.visible).length, meshes: 0, inst: 0, skinned: 0, casters: 0 };
      game.scene.traverseVisible((o) => { if (o.isInstancedMesh) c.inst++; else if (o.isSkinnedMesh) c.skinned++; else if (o.isMesh) c.meshes++; if (o.isMesh && o.castShadow) c.casters++; });
      c.calls = game.renderer.info.render.calls; c.tris = game.renderer.info.render.triangles;
      c.npcStates = {}; for (const n of game.crowd.npcs) c.npcStates[n.state] = (c.npcStates[n.state] || 0) + 1;
      return c;
    }));
    await shot('00-start');
    // Walk to a walker and look at them.
    const near = await page.evaluate(() => {
      const p = game.player.object.position;
      const n = game.crowd.npcs.filter((n) => n.role === 'walker').sort((a, b) => a.actor.object.position.distanceTo(p) - b.actor.object.position.distanceTo(p))[0];
      const q = n.actor.object.position;
      game.player.place(q.x - 1.8 * Math.sin(n.actor.heading) , q.y, q.z - 1.8 * Math.cos(n.actor.heading), n.actor.heading);
      n.state = 'hang'; n.timer = 100; n.actor.intent.speed = 0;
      T.look(n.actor.heading + Math.PI + 0.4, 0.15); game.follow.distTarget = 3; T.step(20);
      return { name: n.actor.name, model: n.actor.modelKey };
    });
    log('near', near);
    await page.evaluate(() => {
      // Face them and talk.
      const n = game.crowd.npcs.find((x) => x.state === 'hang' && x.timer > 90);
      const p = game.player.object.position, q = n.actor.object.position;
      game.player.heading = Math.atan2(q.x - p.x, q.z - p.z);
      T.step(2);
    });
    log('prompt', await page.evaluate(() => T.state().prompt));
    await page.evaluate(() => { T.tap('KeyE'); T.step(20); });
    await shot('01-talk');
    await page.evaluate(() => { game.hud.say('Hello! Where can I get a drink around here?'); T.step(45); });
    log('bubbles', await page.evaluate(() => [...document.querySelectorAll('.bubble')].map((b) => b.textContent)));
    await shot('02-said');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 3500)));
    await page.evaluate(() => { T.step(20); });
    log('bubbles later', await page.evaluate(() => [...document.querySelectorAll('.bubble')].map((b) => b.textContent)));
    await shot('03-reply');
    await page.evaluate(() => { game.hud.emote('wave'); T.step(20); });
    await shot('04-wave');
  },
  async rooms(page, shot, log) {
    await page.evaluate(helpers);
    const rooms = await page.evaluate(() => game.world.rooms.map((r) => ({ kind: r.kind, yaw: r.yaw, inside: r.inside1.toArray(), entrance: r.entrance.toArray(), W: r.W, D: r.D, c: [r.cx, r.cz] })));
    log(rooms.map((r) => `${r.kind} at ${r.c.map((v) => v.toFixed(1))} yaw ${r.yaw.toFixed(2)} ${r.W}x${r.D}`).join('\n'));
    for (const r of rooms) {
      // Walk in from the street to prove the door opens and nothing blocks.
      await page.evaluate((r) => {
        const h = r.yaw + Math.PI;
        game.player.place(r.entrance[0], r.entrance[1], r.entrance[2], h);
        T.look(r.yaw, 0.2);
        T.step(4);
        game.player.intent.dir.set(Math.sin(h), 0, Math.cos(h));
        game.input.keys.add('KeyW');
        T.step(75);
        game.input.keys.delete('KeyW');
        T.step(10);
      }, r);
      log(r.kind, 'walked in to', await page.evaluate(() => T.state()));
      await shot(`${r.kind}-a`);
      // A wide view from a back corner toward the street.
      await page.evaluate((r) => {
        const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
        const lx = r.W / 2 - 1.2, lz = -r.D / 2 + 1.4;
        game.player.place(r.c[0] + lx * c + lz * s, 0.15, r.c[1] - lx * s + lz * c, r.yaw);
        T.look(r.yaw + Math.PI + 0.5, 0.35);
        game.follow.distTarget = 3.5;
        T.step(12);
      }, r);
      await shot(`${r.kind}-b`);
    }
  },
  async tour(page, shot, log) {
    await page.evaluate(helpers);
    const t0 = Date.now();
    await page.evaluate(() => { T.step(3); });
    log('first frames ms', Date.now() - t0, await page.evaluate(() => ({ calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles, geos: game.renderer.info.memory.geometries, tex: game.renderer.info.memory.textures })));
    await shot('00-spawn');
    const views = (typeof process !== 'undefined' && process.env && process.env.VIEWS) || null;
    const cams = [
      ['01-ocean-drive', [196, 0.15, -30], 0.4, 0.12],
      ['02-main-street', [150, 0.15, 3], -1.3, 0.1],
      ['03-park', [0, 0.15, -28], 0.3, 0.3],
      ['04-downtown', [-76, 0.15, -2], -0.6, -0.05],
      ['05-beach', [226, 0, -40], 2.6, 0.12],
      ['06-pier', [240, 1.35, 0], -1.57, 0.15],
    ];
    for (const [n, p, yaw, pitch] of cams) {
      await page.evaluate(([p, yaw, pitch]) => { game.player.place(p[0], p[1], p[2], yaw + Math.PI); T.look(yaw, pitch); T.step(8); }, [p, yaw, pitch]);
      await shot(n);
    }
    // Aerial.
    await page.evaluate(() => { game.player.place(60, 0.15, 0, 0); T.step(2); game.follow.update = () => {}; game.camera.position.set(330, 160, 210); game.camera.lookAt(20, 0, -10); game.camera.fov = 55; game.camera.updateProjectionMatrix(); T.step(2); });
    await shot('07-aerial');
    await page.evaluate(() => { game.day.setHours(21.5); T.step(3); });
    await shot('08-aerial-night');
  },
  async bed(page, shot, log) {
    await page.evaluate(helpers);
    await page.evaluate(() => { const s = game.testSeats.bed; game.player.place(s.standPoint.x + 0.8, 0, s.standPoint.z, -Math.PI / 2); T.step(5); T.tap('KeyE'); T.step(80); });
    log('on bed edge', await page.evaluate(() => T.state()));
    await shot('a-edge');
    await page.evaluate(() => { T.tap('KeyE'); T.step(20); });
    log('lying down', await page.evaluate(() => T.state()));
    await shot('b-lyingdown');
    await page.evaluate(() => { T.step(60); });
    log('lying', await page.evaluate(() => T.state()));
    const cam = await page.evaluate(() => ({ cam: game.camera.position.toArray(), lost: game.renderer.getContext().isContextLost(), info: game.renderer.info.render }));
    log(cam);
    await shot('c-lying');
  },
  // Walk forward, run, jump, climb the stairs, sit on the chair, lie on the bed.
  async yard(page, shot, log) {
    await page.evaluate(helpers);
    await page.evaluate(() => { T.look(Math.PI, 0.25); T.step(10); });
    await shot('00-start');
    await page.evaluate(() => { T.hold(['KeyW']); T.step(45); });
    log('after walk 1.5s', await page.evaluate(() => T.state()));
    await shot('01-walking');
    await page.evaluate(() => { T.hold(['ShiftLeft']); T.step(30); });
    log('after run 1s', await page.evaluate(() => T.state()));
    await shot('02-running');
    await page.evaluate(() => { T.release(['KeyW', 'ShiftLeft']); T.step(30); });
    log('stopped', await page.evaluate(() => T.state()));
    // Go to the chair's stand point and sit.
    await page.evaluate(() => { const s = game.testSeats.chair; game.player.place(s.standPoint.x + 0.6, 0, s.standPoint.z + 1.2, Math.PI); T.step(5); });
    log('near chair', await page.evaluate(() => T.state()));
    await page.evaluate(() => { T.tap('KeyE'); T.step(20); });
    log('approaching', await page.evaluate(() => T.state()));
    await shot('03-sitting-down');
    await page.evaluate(() => { T.step(60); T.look(0.6, 0.3); T.step(5); });
    log('seated', await page.evaluate(() => T.state()));
    await shot('04-seated');
    await page.evaluate(() => { T.hold(['KeyW']); T.step(3); T.release(['KeyW']); T.step(40); });
    log('stood', await page.evaluate(() => T.state()));
    await shot('05-stood');
    // Bed.
    await page.evaluate(() => { const s = game.testSeats.bed; game.player.place(s.standPoint.x + 0.8, 0, s.standPoint.z, -Math.PI / 2); T.step(5); T.tap('KeyE'); T.step(80); });
    log('on bed edge', await page.evaluate(() => T.state()));
    await page.evaluate(() => { T.tap('KeyE'); T.step(80); T.look(1.2, 0.5); T.step(5); });
    log('lying', await page.evaluate(() => T.state()));
    await shot('06-lying');
    await page.evaluate(() => { T.tap('KeyE'); T.step(70); });
    log('got up (seated)', await page.evaluate(() => T.state()));
    await page.evaluate(() => { T.hold(['KeyW']); T.step(3); T.release(['KeyW']); T.step(40); });
    log('stood from bed', await page.evaluate(() => T.state()));
    // Stairs + jump.
    await page.evaluate(() => { game.player.place(-6, 0, 0, 0); T.look(Math.PI, 0.3); T.hold(['KeyW']); T.step(60); });
    log('climbed stairs', await page.evaluate(() => T.state()));
    await page.evaluate(() => { T.release(['KeyW']); T.tap('Space'); T.step(8); });
    log('mid jump', await page.evaluate(() => T.state()));
    await shot('07-jump');
    await page.evaluate(() => { T.step(40); });
    log('landed', await page.evaluate(() => T.state()));
    for (const e of ['wave', 'point', 'dance', 'phone']) {
      await page.evaluate((e) => { game.player.emote(e); T.step(25); }, e);
      await shot(`08-emote-${e}`);
      await page.evaluate(() => { game.player.cancel(); game.player.stopLayer(0.01); T.step(15); });
    }
  },
};

const t0 = Date.now();
await withPage(`index.html?test&world=${process.env.WORLD || (name === 'yard' ? 'test' : 'city')}&${process.env.Q || ''}`, async (page, logs) => {
  try { await waitReady(page, 300000); } catch (e) { console.log(logs.join('\n')); throw e; }
  const shot = async (n) => { await page.screenshot({ path: `${outDir}/${name}-${n}.png`, timeout: 180000 }); };
  const log = (...a) => console.log(...a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)));
  try { await scenarios[name](page, shot, log); } finally {
    const errs = logs.filter((l) => /error|warn/i.test(l) && !/404/.test(l));
    if (errs.length) console.log('--- console ---\n' + errs.slice(0, 20).join('\n'));
  }
}, { width: 1280, height: 720 });
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${outDir}`);
