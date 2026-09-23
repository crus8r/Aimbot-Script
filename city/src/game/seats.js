// Seats and beds as interactables. A seat is a pelvis position on the floor
// plan, a facing, and a height; everything else (where to stand first, which
// clip, what the prompt says) derives from that.
import * as THREE from 'three';
import { STAND_AT_SEAT } from '../core/clips.js';
import { approach } from './interact.js';

// kind: chair | stool | sofa | bench | bed | lounger | desk | piano | toilet | ground
export function makeSeat({ x, y = 0, z, heading, h = 0.46, kind = 'chair', loop, opts, label }) {
  const seat = {
    pos: new THREE.Vector3(x, y, z),
    floorY: y,
    heading, h, kind, loop, opts,
    bed: kind === 'bed' || kind === 'lounger',
    lieLoop: kind === 'lounger' ? 'lie' : 'lie',
    occupant: null,
  };
  seat.standPoint = new THREE.Vector3(x + Math.sin(heading) * STAND_AT_SEAT, y, z + Math.cos(heading) * STAND_AT_SEAT);
  seat.label = label || { chair: 'Sit', stool: 'Sit', sofa: 'Sit', bench: 'Sit', bed: 'Sit on bed', lounger: 'Sit', desk: 'Sit at desk', piano: 'Play piano', toilet: 'Sit', ground: 'Sit' }[kind] || 'Sit';
  return seat;
}

export function seatInteraction(seat, game) {
  return {
    kind: 'seat',
    seat,
    pos: seat.standPoint.clone().setY(seat.floorY),
    radius: 1.5,
    label: (actor) => {
      if (actor.state === 'seated' && actor.seat === seat) return seat.bed ? 'Lie down' : null;
      if (actor.state === 'lying' && actor.seat === seat) return 'Get up';
      if (actor.state !== 'free' || seat.occupant) return null;
      return seat.label;
    },
    act: (actor) => sitActor(actor, seat, game),
  };
}

export function sitActor(actor, seat, game, then) {
  if (actor.state === 'seated' && actor.seat === seat && seat.bed) return actor.lieDown(then);
  if (actor.state === 'lying' && actor.seat === seat) return actor.getUp(then);
  if (actor.state !== 'free' || seat.occupant) return false;
  seat.occupant = actor;
  approach(actor, seat.standPoint, seat.heading, () => {
    const ok = actor.sit(seat, () => {
      seat.onSit?.(actor, game);
      then?.();
    });
    if (!ok) seat.occupant = null;
  });
  return true;
}
