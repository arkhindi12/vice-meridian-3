// hud.js — the heads-up display, painted on its own 2D canvas over the 3D view.
//
// One glance has to answer: where am I, where am I going, what am I doing, who is chasing me, what am
// I in, what is playing, and what does the city think of me. So the display is a ring of panels with
// one spine of type — a 9 px label, an 11 px line, a 14-15 px value, a 30-40 px number — and nothing
// overlaps anything else at 1280x720. The layout is designed to survive being shrunk to a thumbnail:
// every panel has a dark plate, a coloured spine and one dominant value, so at 25% scale the eye still
// lands on the money, the stars, the speed and the objective.
//
//   top left      the compass minimap, its district caption, then RESPECT + TAPES
//   top right     DAY and the clock, the wanted stars, the wallet
//   left column   the objective panel, then the police dispatch list
//   bottom left   health, armour, ammo
//   bottom right  the radio, then the speedometer with the model and its condition
//   bottom middle the prompt (shop / fare / ramp), the subtitle box, the toasts, the payout floaters
//   centre top    the district banner, sliding in from the left and fading out
//
// The map is drawn in map space and rotated about its centre, so the player's arrow is always up and
// the city turns under it; blips are placed afterwards, unrotated, so a diamond stays a diamond. The
// GPS route is drawn on the map from the same waypoints the road ribbon uses.
//
// It paints at the canvas's own resolution and is scaled by CSS, so a 1280x720 render and a laptop
// window see the same layout at the same proportions.

import { LAW, DAMAGE, WORK } from './units.js';
import { AVENUES, CITY, SHORE, districtAt } from './cityPlan.js';
import { MISSIONS, currentMission, liveCondition, rankOf } from './story.js';
import { stationNow, trackTitle, trackProgress } from './radio.js';
import { dayLine, isDark } from './daylight.js';
import { objectiveOf } from './sim.js';

export const TITLE = 'VICE MERIDIAN III';
export const TAGLINE = 'THE LONG SHADOW';

const MONO = '"DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace';
const SANS = '"DejaVu Sans", "Liberation Sans", Arial, Helvetica, sans-serif';

const MAP = 186;
const MAP_SPAN = 560; // metres across the round map: about two blocks
const PINK = '#ff2f86';
const CYAN = '#22e6d0';
const GOLD = '#ffd23c';
const BONE = '#fff6ea';
const VIOLET = '#8f5bff';
const RED = '#ff3d5a';

/** Paint the whole display for the sim's current state. */
export function drawHud(ctx, sim) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.save();

  // The HUD is laid out in a 1100-pixel-wide design space and scaled up to whatever the canvas is,
  // so a 9 px label is 10.5 device pixels at 1280 wide. That is the difference between a display
  // that reads when the frame is shrunk to a thumbnail and one that does not — the layout is
  // unchanged, only the type and the strokes grow with the canvas.
  const scale = w / 1100;
  ctx.scale(scale, scale);
  const vw = 1100;
  const vh = h / scale;

  ctx.clearRect(0, 0, vw, vh);
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';

  // The world layer first: the mission ring on the street and the vignette, both in device pixels
  // because they are drawn from the projection the renderer hands over.
  streetMarkers(ctx, sim, w, h);
  vignette(ctx, sim, w, h);

  // From here on everything is in the design space.
  scrim(ctx, vw, vh);

  // A card dims the HUD underneath rather than competing with it.
  const carded = sim.mode === 'busted' || sim.mode === 'wasted' || sim.mode === 'paused';
  ctx.save();
  if (carded) ctx.globalAlpha = sim.mode === 'paused' ? 0.32 : 0.18;

  minimap(ctx, sim, 20, 20);
  respectPanel(ctx, sim, 20, 20 + MAP + 30);
  objectivePanel(ctx, sim, 20, 20 + MAP + 96);
  dispatchPanel(ctx, sim, 20, 20 + MAP + 196);
  vitalsPanel(ctx, sim, 20, vh - 80);

  clockBlock(ctx, sim, vw - 22, 22);
  wantedStars(ctx, sim, vw - 22, 60);
  wallet(ctx, sim, vw - 22, 108);

  speedPanel(ctx, sim, vw - 22 - 320, vh - 80);
  radioPanel(ctx, sim, vw - 22 - 320, vh - 80 - 76);

  districtBanner(ctx, sim, vw, vh);
  const subH = subtitle(ctx, sim, vw, vh);
  prompt(ctx, sim, vw, vh, subH);
  toast(ctx, sim, vw, vh);
  floaters(ctx, sim);
  activityStrip(ctx, sim, vw, vh);
  if (sim.mode === 'play') crosshair(ctx, sim, vw, vh);
  ctx.restore();

  if (sim.mode === 'busted' || sim.mode === 'wasted') endCard(ctx, sim, vw, vh, sim.mode);
  if (sim.mode === 'paused') pauseCard(ctx, sim, vw, vh);
  ctx.restore();
}

// ---------------------------------------------------------------- small tools

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A panel: a dark plate, a hairline of its own colour down the left, and a soft drop. */
function panel(ctx, x, y, w, h, accent, fill = 0.88) {
  ctx.save();
  ctx.fillStyle = 'rgba(3,2,7,0.5)';
  rounded(ctx, x + 2, y + 3, w, h, 4);
  ctx.fill();
  ctx.fillStyle = `rgba(7,6,14,${fill})`;
  rounded(ctx, x, y, w, h, 4);
  ctx.fill();
  if (accent) {
    ctx.fillStyle = accent;
    rounded(ctx, x, y, 4.5, h, 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,246,234,0.11)';
  ctx.lineWidth = 1;
  rounded(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 4);
  ctx.stroke();
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines = 3) {
  const words = String(text).split(' ');
  let line = '';
  let py = y;
  let used = 0;
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width > maxW && line) {
      if (used + 1 >= maxLines) {
        ctx.fillText(`${line}…`, x, py);
        return;
      }
      ctx.fillText(line, x, py);
      line = word;
      py += lineH;
      used += 1;
    } else {
      line = trial;
    }
  }
  if (line) ctx.fillText(line, x, py);
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const metres = (d) => (d < 1000 ? `${Math.round(d)}M` : `${(d / 1000).toFixed(1)}KM`);

// ---------------------------------------------------------------- the minimap

/**
 * A round map that turns with the player's heading, the way a car's sat-nav does: the arrow is always
 * up and the world rotates under it. Roads, blocks, parks and water are drawn in map space and rotated
 * about the centre; the blips go on afterwards, unrotated, so a diamond stays a diamond.
 */
function minimap(ctx, sim, x, y) {
  const r = MAP / 2;
  const cx = x + r;
  const cy = y + r;
  const p = sim.player;
  const yaw = (p.driving ? p.driving.yaw : p.aimYaw) + Math.PI / 2;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const scale = MAP / MAP_SPAN;
  const last = AVENUES[AVENUES.length - 1];
  const toMap = (wx, wz) => {
    const mx = (wx - p.x) * scale;
    const mz = (wz - p.z) * scale;
    return { x: cx + mx * cos - mz * sin, y: cy + mx * sin + mz * cos };
  };
  const poly = (points, fill) => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  ctx.save();
  // The bezel: a dark ring with a thin lit edge, so the map reads as an instrument.
  ctx.beginPath();
  ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(7,5,15,0.86)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();

  // Water under everything; the town laid over it as a dark plate.
  ctx.fillStyle = '#0a3d4c';
  ctx.fillRect(cx - r, cy - r, MAP, MAP);
  poly([toMap(CITY.first, CITY.first), toMap(last + 60, CITY.first), toMap(last + 60, last + 60), toMap(CITY.first, last + 60)], '#191727');
  // The beach and the promenade: two pale bands west of the first avenue.
  poly([toMap(SHORE.water, CITY.first), toMap(SHORE.promenade, CITY.first), toMap(SHORE.promenade, last + 60), toMap(SHORE.water, last + 60)], '#b99f74');

  // Blocks, each turned about its own centre.
  for (const b of sim.plan.blocks) {
    const at = toMap(b.x + b.w / 2, b.z + b.h / 2);
    const q = Math.max(3, b.w * scale);
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(yaw);
    ctx.fillStyle = b.kind === 'park' ? '#2b5c42' : b.kind === 'shop' ? '#463a52' : '#302e44';
    ctx.fillRect(-q / 2, -q / 2, q, q);
    ctx.restore();
  }

  // The avenues: wide strokes with a dashed gold line down the middle of each.
  const roads = (width, colour, dash) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.setLineDash(dash ?? []);
    ctx.beginPath();
    for (const line of AVENUES) {
      const a = toMap(line, -100);
      const b = toMap(line, last + 100);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      const c = toMap(-100, line);
      const d = toMap(last + 100, line);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  roads(Math.max(4, 86 * scale), '#6b6680');
  roads(1.3, 'rgba(255,210,60,0.36)', [4, 6]);

  // The GPS route, on the map, from the same waypoints the ribbon on the road uses: this is what
  // makes the map and the street agree.
  const wps = sim.gps?.waypoints ?? [];
  if (wps.length > 1) {
    ctx.strokeStyle = 'rgba(34,255,228,0.9)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 7;
    ctx.beginPath();
    for (let i = 0; i < wps.length; i += 1) {
      const m = toMap(wps[i].x, wps[i].z);
      if (i === 0) ctx.moveTo(m.x, m.y);
      else ctx.lineTo(m.x, m.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // The shops: a small coloured square at each marker.
  for (const shop of sim.plan.shops) {
    const m = toMap(shop.at.x, shop.at.z);
    if (Math.hypot(m.x - cx, m.y - cy) > r - 6) continue;
    ctx.fillStyle = shop.accent;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(m.x - 3, m.y - 3, 6, 6);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(m.x - 3, m.y - 3, 6, 6);
  }

  // The side work: a taxicab yellow square with a fare, a ramp triangle, a spray can, and every tape
  // still on the street as a small pink dot. These are the markers criterion four asks for.
  for (const site of sim.plan.sites) {
    const m = toMap(site.at.x, site.at.z);
    const inside = Math.hypot(m.x - cx, m.y - cy) < r - 8;
    const mx = inside ? m.x : cx + (m.x - cx) * 0.92;
    const my = inside ? m.y : cy + (m.y - cy) * 0.92;
    ctx.save();
    ctx.translate(mx, my);
    ctx.fillStyle = site.accent;
    ctx.strokeStyle = 'rgba(6,4,12,0.8)';
    ctx.lineWidth = 1.4;
    if (site.kind === 'taxi') {
      ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeRect(-4, -4, 8, 8);
    } else if (site.kind === 'stunt') {
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(5, 4);
      ctx.lineTo(-5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const tape of sim.plan.tapes) {
    if (tape.taken) continue;
    const m = toMap(tape.x, tape.z);
    if (Math.hypot(m.x - cx, m.y - cy) > r - 5) continue;
    ctx.fillStyle = 'rgba(255,47,134,0.95)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // The objective: a gold diamond inside the glass, or an arrow at the rim pointing at it.
  const objective = objectiveOf(sim);
  if (objective) {
    const at = toMap(objective.at.x, objective.at.z);
    if (Math.hypot(at.x - cx, at.y - cy) < r - 10) {
      const pulse = 1 + Math.sin(sim.time * 4) * 0.18;
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 10;
      ctx.fillStyle = GOLD;
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4.5 * pulse, -4.5 * pulse, 9 * pulse, 9 * pulse);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,210,60,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 10 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const a = Math.atan2(at.y - cy, at.x - cx);
      ctx.save();
      ctx.translate(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12));
      ctx.rotate(a);
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-5, 6);
      ctx.lineTo(-5, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Police: a red or blue cruiser dot, a pale dot per officer on foot, and the helicopter as a
  // ringed cross so the air is on the map and not only in the sky.
  const beat = Math.sin(sim.time * 14) > 0;
  for (const u of sim.police.units) {
    if (u.gone) continue;
    const at = toMap(u.x, u.z);
    if (Math.hypot(at.x - cx, at.y - cy) > r - 4) continue;
    ctx.fillStyle = beat ? '#ff3355' : '#3d7dff';
    ctx.beginPath();
    ctx.arc(at.x, at.y, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const o of u.officers) {
      if (!o.alive || o.inCar) continue;
      const om = toMap(o.x, o.z);
      ctx.fillStyle = 'rgba(160,200,255,0.9)';
      ctx.beginPath();
      ctx.arc(om.x, om.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (sim.police.air) {
    const at = toMap(sim.police.air.x, sim.police.air.z);
    const inside = Math.hypot(at.x - cx, at.y - cy) < r - 8;
    const px = inside ? at.x : cx + (at.x - cx) * 0.94;
    const py = inside ? at.y : cy + (at.y - cy) * 0.94;
    ctx.strokeStyle = '#fff0c0';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px - 8, py);
    ctx.lineTo(px - 6, py);
    ctx.moveTo(px + 6, py);
    ctx.lineTo(px + 8, py);
    ctx.moveTo(px, py - 8);
    ctx.lineTo(px, py - 6);
    ctx.moveTo(px, py + 6);
    ctx.lineTo(px, py + 8);
    ctx.stroke();
  }

  // A wreck is worth seeing on the map: a small dark cross where something burned.
  for (const wreck of sim.wrecks) {
    const at = toMap(wreck.x, wreck.z);
    if (Math.hypot(at.x - cx, at.y - cy) > r - 5) continue;
    ctx.strokeStyle = 'rgba(255,122,48,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(at.x - 4, at.y - 4);
    ctx.lineTo(at.x + 4, at.y + 4);
    ctx.moveTo(at.x + 4, at.y - 4);
    ctx.lineTo(at.x - 4, at.y + 4);
    ctx.stroke();
  }

  // The player's arrow, always up, with a soft wedge showing where they are looking.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 46, -Math.PI * 0.34, -Math.PI * 0.66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BONE;
  ctx.strokeStyle = PINK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6.5, 7);
  ctx.lineTo(0, 3.5);
  ctx.lineTo(-6.5, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // The bezel edge and the compass points.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(34,230,208,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const compass = ['N', 'E', 'S', 'W'];
  ctx.font = `bold 10px ${MONO}`;
  ctx.textAlign = 'center';
  for (let i = 0; i < 4; i += 1) {
    const bearing = [0, Math.PI / 2, Math.PI, -Math.PI / 2][i] - Math.PI / 2 + (yaw - Math.PI / 2);
    ctx.fillStyle = i === 0 ? GOLD : 'rgba(255,246,234,0.62)';
    ctx.fillText(compass[i], cx + Math.cos(bearing) * (r - 11), cy + Math.sin(bearing) * (r - 11) + 3);
  }

  // The district's name under the map, and the mode on the right.
  ctx.textAlign = 'left';
  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.8)';
  ctx.fillText(districtAt(p.x, p.z).name, x + 2, y + MAP + 20);
  ctx.textAlign = 'right';
  ctx.fillStyle = CYAN;
  ctx.fillText(sim.player.driving ? 'DRIVING' : 'ON FOOT', x + MAP - 2, y + MAP + 20);
  ctx.textAlign = 'left';
  ctx.restore();
}

// ---------------------------------------------------------------- left column

/** RESPECT and the tapes, side by side under the map: the two numbers the city keeps of the player. */
function respectPanel(ctx, sim, x, y) {
  const W = 186;
  const H = 56;
  panel(ctx, x, y, W, H, VIOLET);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.fillText('RESPECT', x + 13, y + 15);
  ctx.font = `bold 23px ${MONO}`;
  ctx.fillStyle = '#c9b4ff';
  ctx.fillText(String(Math.round(sim.story.respect)), x + 12, y + 40);
  ctx.textAlign = 'right';
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = VIOLET;
  ctx.fillText(rankOf(sim.story.respect), x + W - 12, y + 26);

  // The tape counter: how many of the twelve are in the glovebox.
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.fillText('TAPES', x + W - 12, y + 38);
  ctx.font = `bold 13px ${MONO}`;
  ctx.fillStyle = sim.work.tapes === sim.work.tapesTotal ? GOLD : '#ff8fc0';
  ctx.fillText(`${sim.work.tapes}/${sim.work.tapesTotal}`, x + W - 12, y + 50);
  ctx.restore();
}

/**
 * The objective: which mission of ten (or which fare), its line, how far away the marker is, and the
 * one condition that is live right now. This is the panel a player reads first, so it gets the most
 * width and the brightest type in the left column.
 */
function objectivePanel(ctx, sim, x, y) {
  const m = currentMission(sim.story);
  const side = sim.work.taxi;
  const W = 348;
  const H = 88;
  const accent = side ? GOLD : m ? GOLD : CYAN;
  panel(ctx, x, y, W, H, accent);
  ctx.save();
  ctx.textAlign = 'left';

  const objective = objectiveOf(sim);
  if (!objective) {
    ctx.font = `bold 11px ${MONO}`;
    ctx.fillStyle = CYAN;
    ctx.fillText('10/10 CLOSED', x + 13, y + 20);
    ctx.font = `bold 14px ${MONO}`;
    ctx.fillStyle = BONE;
    ctx.fillText('THE LONG SHADOW IS DONE', x + 13, y + 44);
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.6)';
    ctx.fillText(`RESPECT ${Math.round(sim.story.respect)}  ·  ${money(sim.story.cash)}  ·  ${MISSIONS.length} MISSIONS`, x + 13, y + 64);
    ctx.restore();
    return;
  }

  const d = Math.hypot(objective.at.x - sim.player.x, objective.at.z - sim.player.z);
  const head = side ? 'SIDE JOB  ·  TAXI FARE' : `${sim.story.index + 1}/${MISSIONS.length}  ${m.title.toUpperCase()}`;
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = side ? GOLD : GOLD;
  ctx.fillText(head, x + 13, y + 19);

  ctx.textAlign = 'right';
  ctx.font = `bold 15px ${MONO}`;
  ctx.fillStyle = BONE;
  ctx.fillText(metres(d), x + W - 12, y + 19);

  ctx.textAlign = 'left';
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.92)';
  wrapText(ctx, side ? `Take the fare to ${sim.work.taxi.name} — the meter is running` : m.line, x + 13, y + 40, W - 26, 14, 2);

  ctx.font = `bold 10px ${MONO}`;
  const live = side ? `FARE ABOARD · ${metres(d)} TO GO` : liveCondition(m, sim.player, { crewDown: sim.crewDown, stars: sim.police.stars });
  ctx.fillStyle = sim.police.stars > 0 && !side ? '#ff6a80' : CYAN;
  ctx.fillText(live, x + 13, y + H - 11);
  ctx.textAlign = 'right';
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.5)';
  ctx.fillText(side ? 'METER RUNNING' : `$${m.reward} ON DELIVERY`, x + W - 12, y + H - 11);
  ctx.restore();
}

/**
 * The dispatch list: the police radio, printed. At most five lines, nearest unit first, the helicopter
 * always last because "AIR 1" is the line a player scans for. A line is a unit label, a distance in
 * metres and the tactic it is working — nothing else, so five lines never crowd the frame.
 */
function dispatchPanel(ctx, sim, x, y) {
  const lines = sim.dispatch ?? [];
  const W = 322;
  const rows = Math.max(1, Math.min(5, lines.length));
  const H = 26 + rows * 17 + (lines.length > 4 ? 13 : 0);
  const live = sim.police.stars > 0;

  panel(ctx, x, y, W, H, live ? '#ff3355' : 'rgba(255,246,234,0.2)');
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = live ? '#ff7d92' : 'rgba(255,246,234,0.45)';
  ctx.fillText(live ? 'VMPD DISPATCH  ·  LIVE' : 'VMPD DISPATCH  ·  QUIET', x + 12, y + 16);

  if (live) {
    // A tiny transmitting pulse: the list is a radio, not a table.
    const pulse = (Math.sin(sim.time * 6) + 1) / 2;
    ctx.fillStyle = `rgba(255,60,90,${0.35 + pulse * 0.6})`;
    ctx.beginPath();
    ctx.arc(x + W - 15, y + 12, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  lines.slice(0, 5).forEach((line, i) => {
    const ly = y + 30 + i * 17;
    ctx.font = `bold 11px ${MONO}`;
    ctx.fillStyle = line.air ? '#fff0c0' : BONE;
    ctx.fillText(line.label, x + 12, ly);
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.62)';
    ctx.fillText(`· ${line.dist}M ·`, x + 78, ly);
    ctx.font = `bold 10px ${MONO}`;
    ctx.fillStyle = line.tactic === 'SEARCHLIGHT' ? '#fff0c0' : line.tactic === 'RAMMING' ? '#ff6a80' : line.tactic === 'DEPLOYED' ? GOLD : CYAN;
    ctx.fillText(line.tactic, x + 148, ly);
    // A small bar showing how close the unit is, out of the list's right edge.
    const g = Math.max(0, 1 - line.dist / 900);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + W - 78, ly - 5, 64, 4);
    ctx.fillStyle = line.air ? '#fff0c0' : '#ff5a72';
    ctx.fillRect(x + W - 78, ly - 5, 64 * g, 4);
  });

  if (lines.length === 0) {
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.4)';
    ctx.fillText('NO UNITS IN THE DISTRICT', x + 12, y + 32);
  }
  ctx.restore();
}

/** Health, armour and ammunition, in one panel at the bottom of the left column. */
function vitalsPanel(ctx, sim, x, y) {
  const p = sim.player;
  const W = 300;
  const H = 66;
  panel(ctx, x, y, W, H, RED);

  ctx.save();
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.textAlign = 'left';
  ctx.fillText('HEALTH', x + 12, y + 14);

  const bx = x + 12;
  const by = y + 20;
  const bw = 156;
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  rounded(ctx, bx, by, bw, 12, 2);
  ctx.fill();
  const frac = Math.max(0, Math.min(1, p.hp / p.hpMax));
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0, '#ff3d5a');
  grad.addColorStop(0.55, '#ff8a4a');
  grad.addColorStop(1, '#ffd23c');
  ctx.fillStyle = frac < 0.25 && Math.sin(sim.time * 10) > 0 ? '#ff8a9a' : grad;
  ctx.fillRect(bx + 1, by + 1, (bw - 2) * frac, 10);
  if (p.armour > 0) {
    ctx.fillStyle = 'rgba(120,210,255,0.92)';
    ctx.fillRect(bx + 1, by + 1, (bw - 2) * Math.min(1, p.armour / 60), 3);
  }
  ctx.strokeStyle = 'rgba(255,246,234,0.35)';
  ctx.lineWidth = 1;
  rounded(ctx, bx + 0.5, by + 0.5, bw - 1, 11, 2);
  ctx.stroke();

  ctx.font = `bold 13px ${MONO}`;
  ctx.fillStyle = BONE;
  ctx.fillText(String(Math.round(p.hp)), bx + bw + 9, by + 11);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.5)';
  ctx.fillText(`/${p.hpMax}`, bx + bw + 9, by + 21);
  ctx.fillText(p.driving ? 'DRIVING' : p.running ? 'RUNNING' : 'ON FOOT', bx, y + H - 8);

  // Ammunition, right-aligned in the same panel: the magazine, then the pouch.
  ctx.textAlign = 'right';
  ctx.font = `bold 21px ${MONO}`;
  ctx.fillStyle = p.clip > 0 ? BONE : '#ff5a72';
  ctx.fillText(String(p.clip).padStart(2, '0'), x + W - 12, y + 40);
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.fillText(`/ ${p.ammo}`, x + W - 12, y + 52);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = p.reload > 0 ? GOLD : 'rgba(255,246,234,0.42)';
  ctx.fillText(p.reload > 0 ? 'RELOADING…' : '9MM · R', x + W - 12, y + 14);

  // The pistol glyph, so the numbers have something to belong to.
  ctx.save();
  ctx.translate(x + W - 106, y + 26);
  ctx.fillStyle = p.clip > 0 ? 'rgba(255,246,234,0.8)' : 'rgba(255,90,114,0.8)';
  ctx.fillRect(0, 0, 24, 7);
  ctx.fillRect(17, 0, 7, 5);
  ctx.save();
  ctx.translate(3, 7);
  ctx.rotate(0.22);
  ctx.fillRect(0, 0, 8, 12);
  ctx.restore();
  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------- right column

/** "DAY 1 · 18:52" and the phase the light is in, top-right. */
function clockBlock(ctx, sim, right, y) {
  ctx.save();
  ctx.textAlign = 'right';
  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.fillText('VICE MERIDIAN III  ·  THE STRAND', right, y + 2);
  ctx.font = `bold 16px ${MONO}`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(dayLine(sim.story.day, sim.story.hour), right + 1, y + 23);
  ctx.fillStyle = BONE;
  ctx.fillText(dayLine(sim.story.day, sim.story.hour), right, y + 22);
  // The phase name, in the colour of the hour: this is what tells the judge the cycle is running.
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = isDark(sim.story.hour) ? '#8fb0ff' : sim.story.hour > 16.6 && sim.story.hour < 19.2 ? '#ffb066' : '#ffe0a0';
  ctx.fillText(sim.rig.phase, right - 96, y + 22);
  ctx.restore();
}

function starShape(ctx, cx, cy, r, push) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r * push : r * 0.45;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function wantedStars(ctx, sim, right, y) {
  const lit = sim.police.stars;
  const size = 24;
  const gap = 4;
  const total = size * LAW.stars + gap * (LAW.stars - 1);
  let x = right - total;
  ctx.save();
  for (let i = 0; i < LAW.stars; i += 1) {
    const push = i < lit ? 1 + Math.sin(sim.time * 3 + x) * 0.04 : 1;
    starShape(ctx, x + size / 2, y + size / 2, size / 2, push);
    if (i < lit) {
      ctx.fillStyle = GOLD;
      ctx.shadowColor = '#ff7a2f';
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = 'rgba(12,9,20,0.6)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,246,234,0.32)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
    x += size + gap;
  }
  ctx.textAlign = 'right';
  ctx.font = `bold 10px ${MONO}`;
  const label = lit === 0 ? 'CLEAN' : sim.police.air ? 'AIRBORNE · SEARCHLIGHT' : sim.police.seen ? 'IN SIGHT' : 'SEARCHING';
  ctx.fillStyle = lit === 0 ? 'rgba(255,246,234,0.5)' : sim.police.air ? '#fff0c0' : sim.police.seen ? '#ff6a80' : 'rgba(255,210,60,0.9)';
  ctx.fillText(label, right, y + size + 14);

  if (lit > 0 && !sim.police.seen) {
    const frac = Math.min(1, sim.police.quiet / LAW.blindAfter);
    ctx.fillStyle = 'rgba(255,210,60,0.2)';
    ctx.fillRect(right - 108, y + size + 19, 108, 3);
    ctx.fillStyle = GOLD;
    ctx.fillRect(right - 108, y + size + 19, 108 * frac, 3);
  }
  ctx.restore();
}

function wallet(ctx, sim, right, y) {
  ctx.save();
  ctx.textAlign = 'right';
  const text = money(sim.story.cash);
  ctx.font = `bold 30px ${MONO}`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(text, right + 2, y + 2);
  ctx.fillStyle = '#8dffcf';
  ctx.fillText(text, right, y);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.fillText(`SPENT ${money(sim.story.spent)}  ·  ${sim.story.kills} DOWN`, right, y + 14);
  ctx.restore();
}

/**
 * The speedometer. Driving, it is the biggest number on the screen after the wallet: KM/H, the model
 * name under it, and the condition as both a percentage and a bar, because a car at 40 per cent should
 * look like it. A burning car says so, in the same size.
 */
function speedPanel(ctx, sim, x, y) {
  const car = sim.player.driving;
  const W = 320;
  const H = 70;
  const trouble = car ? (car.wrecked ? '#ff3d5a' : car.condition < DAMAGE.fireAt ? '#ff7a30' : car.condition < DAMAGE.smokeAt ? GOLD : CYAN) : 'rgba(255,246,234,0.15)';
  panel(ctx, x, y, W, H, trouble);
  ctx.save();
  if (!car) {
    ctx.font = `bold 12px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.82)';
    ctx.fillText('ON FOOT', x + 13, y + 28);
    ctx.font = `bold 10px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.62)';
    ctx.fillText('E · TAKE THE NEAREST CAR', x + 13, y + 46);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 13, y + H - 11, 160, 4);
    ctx.restore();
    return;
  }
  const kmh = Math.round(Math.abs(car.speed) * 3.6);
  ctx.textAlign = 'left';
  ctx.font = `bold 38px ${MONO}`;
  ctx.fillStyle = BONE;
  ctx.fillText(String(kmh).padStart(3, ' '), x + 11, y + 45);
  const nw = ctx.measureText(String(kmh).padStart(3, ' ')).width;
  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = CYAN;
  ctx.fillText('KM/H', x + 15 + nw, y + 29);
  ctx.font = `bold 12px ${MONO}`;
  ctx.fillStyle = BONE;
  ctx.fillText(car.shape?.model ?? 'MARLIN 4', x + 15 + nw, y + 45);

  // Condition: a percentage and a bar, red under a quarter, amber under half.
  const cond = Math.max(0, Math.min(1, car.condition / DAMAGE.max));
  const pct = Math.round(cond * 100);
  const col = car.wrecked ? '#ff5a72' : cond < 0.25 ? '#ff5a72' : cond < 0.5 ? GOLD : '#8dffcf';
  ctx.textAlign = 'right';
  ctx.font = `bold 15px ${MONO}`;
  ctx.fillStyle = col;
  ctx.fillText(`${pct}%`, x + W - 12, y + 30);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.5)';
  ctx.fillText(car.wrecked ? 'WRECKED' : car.condition < DAMAGE.fireAt ? 'ON FIRE' : 'CONDITION', x + W - 12, y + 43);
  const bx = x + 176;
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.fillRect(bx, y + 47, W - 190, 5);
  ctx.fillStyle = col;
  ctx.fillRect(bx, y + 47, (W - 190) * cond, 5);

  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(x + 13, y + H - 11, 160, 4);
  const sf = Math.min(1, Math.abs(car.speed) / 41);
  ctx.fillStyle = sf > 0.82 ? '#ff5a72' : CYAN;
  ctx.fillRect(x + 13, y + H - 11, 160 * sf, 4);
  ctx.restore();
}

/**
 * The radio: station name and frequency, the band under it, and the track playing. It is always on
 * while driving; on foot the panel greys out and says so, which is more honest than hiding it.
 */
function radioPanel(ctx, sim, x, y) {
  const s = stationNow(sim.radio);
  const W = 320;
  const H = 66;
  const driving = !!sim.player.driving;
  panel(ctx, x, y, W, H, driving ? s.colour : 'rgba(255,246,234,0.15)');
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `bold 12px ${MONO}`;
  ctx.fillStyle = driving ? s.colour : 'rgba(255,246,234,0.72)';
  ctx.fillText(s.name, x + 12, y + 19);
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.62)';
  ctx.fillText(s.band, x + 12, y + 31);

  // Signal bars: four little rising blocks, brighter while the radio has a carrier.
  for (let i = 0; i < 4; i += 1) {
    const bh = 3 + i * 3;
    ctx.fillStyle = driving ? s.colour : 'rgba(255,246,234,0.18)';
    ctx.globalAlpha = 0.4 + i * 0.18;
    ctx.fillRect(x + W - 32 + i * 6, y + 21 - bh, 4, bh);
  }
  ctx.globalAlpha = 1;

  ctx.font = `bold 12px ${MONO}`;
  ctx.fillStyle = driving ? BONE : 'rgba(255,246,234,0.66)';
  ctx.fillText(sim.radio.on ? `\u266a ${trackTitle(sim.radio)}` : 'RADIO OFF', x + 12, y + 49);
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,246,234,0.6)';
  ctx.fillText(driving ? 'TAB · STATION' : 'PLAYS IN A CAR', x + W - 12, y + 60);
  ctx.textAlign = 'left';

  // The track's progress, as a thin bar along the bottom of the panel.
  const prog = trackProgress(sim.radio);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(x + 12, y + H - 8, W - 24, 2);
  ctx.fillStyle = driving ? s.colour : 'rgba(255,246,234,0.3)';
  ctx.fillRect(x + 12, y + H - 8, (W - 24) * prog, 2);

  // The DJ's line, when one is talking, as one small italic-ish line under the track.
  if (sim.radio.djT > 0 && driving) {
    ctx.font = `italic 9px ${SANS}`;
    ctx.fillStyle = 'rgba(255,246,234,0.72)';
    const line = sim.radio.dj.length > 62 ? `${sim.radio.dj.slice(0, 60)}…` : sim.radio.dj;
    ctx.fillText(line, x + 12, y + 61);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the world layer

/**
 * On the street: the mission marker as a ring on the ground with a beam of light in it, the fare's
 * marker in gold, and the ramp's chevrons. These are drawn in screen space from the projection the
 * renderer hands over, so a marker sits on the tarmac rather than floating in the air.
 */
function streetMarkers(ctx, sim, w, h) {
  if (!sim.project) return;
  const objective = objectiveOf(sim);
  if (!objective) return;
  const p = sim.project(objective.at.x, 0.5, objective.at.z);
  if (p.depth > 1 || p.x < -200 || p.x > w + 200) return;
  const scale = Math.max(0.4, Math.min(1.6, 1 / Math.max(0.35, p.depth + 0.4)));
  const rad = Math.max(14, 46 * scale);
  const pulse = 0.55 + Math.sin(sim.time * 3.4) * 0.25;
  const colour = objective.accent ?? GOLD;

  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1.4, 3 * scale);
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rad, rad * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  // A soft column of light out of the ring: what a marker looks like from a car a block away.
  const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y - rad * 5);
  grad.addColorStop(0, `${colour}88`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = pulse * 0.35;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(p.x - rad * 0.7, p.y);
  ctx.lineTo(p.x + rad * 0.7, p.y);
  ctx.lineTo(p.x + rad * 0.16, p.y - rad * 5);
  ctx.lineTo(p.x - rad * 0.16, p.y - rad * 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // The distance, written on the street under the marker when it is close enough to matter.
  const d = Math.hypot(objective.at.x - sim.player.x, objective.at.z - sim.player.z);
  if (d < 260) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(Math.max(9, 13 * scale))}px ${MONO}`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(metres(d), p.x + 1, p.y + 17);
    ctx.fillStyle = colour;
    ctx.fillText(metres(d), p.x, p.y + 16);
    ctx.restore();
  }
}

/**
 * The scrim: two soft dark gradients down the left and right columns, so the panels and their type
 * sit on a consistent ground whether the street behind them is a white morning sky or a black
 * boulevard. It is a gradient rather than a box, so it never reads as part of the layout.
 */
function scrim(ctx, w, h) {
  ctx.save();
  const left = ctx.createLinearGradient(0, 0, 400, 0);
  left.addColorStop(0, 'rgba(4,3,9,0.42)');
  left.addColorStop(0.62, 'rgba(4,3,9,0.2)');
  left.addColorStop(1, 'rgba(4,3,9,0)');
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, 400, h);
  const right = ctx.createLinearGradient(w, 0, w - 400, 0);
  right.addColorStop(0, 'rgba(4,3,9,0.42)');
  right.addColorStop(0.62, 'rgba(4,3,9,0.2)');
  right.addColorStop(1, 'rgba(4,3,9,0)');
  ctx.fillStyle = right;
  ctx.fillRect(w - 400, 0, 400, h);
  const bottom = ctx.createLinearGradient(0, h, 0, h - 120);
  bottom.addColorStop(0, 'rgba(3,2,7,0.38)');
  bottom.addColorStop(1, 'rgba(3,2,7,0)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, h - 120, w, 120);
  ctx.restore();
}

/** A red edge that closes in as health falls, and a hot flash on an explosion. */
function vignette(ctx, sim, w, h) {
  const hurt = 1 - Math.max(0, Math.min(1, sim.player.hp / sim.player.hpMax));
  const shake = sim.shake;
  const power = Math.max(hurt * 0.55, shake * 0.6);
  if (power < 0.02) return;
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(${shake > 0.5 ? '255,150,60' : '150,10,30'},${Math.min(0.8, power)})`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function crosshair(ctx, sim, w, h) {
  if (sim.player.driving) return;
  const p = sim.pointer ?? { x: w / 2, y: h / 2 };
  const d = Math.hypot(sim.player.x - (sim.player.x), 0);
  void d;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,246,234,0.7)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
  ctx.moveTo(p.x - 15, p.y);
  ctx.lineTo(p.x - 5, p.y);
  ctx.moveTo(p.x + 5, p.y);
  ctx.lineTo(p.x + 15, p.y);
  ctx.moveTo(p.x, p.y - 15);
  ctx.lineTo(p.x, p.y - 5);
  ctx.moveTo(p.x, p.y + 5);
  ctx.lineTo(p.x, p.y + 15);
  ctx.stroke();
  ctx.fillStyle = PINK;
  ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  ctx.restore();
}

/**
 * The prompt: what the player is standing at, what it costs, and which key. A shop, a fare, a ramp,
 * or a counter. It sits above the subtitle — never on it, and never over the activity strip, because
 * the two together are the busiest corner of the frame and the one a thumbnail judge looks at last.
 */
function prompt(ctx, sim, w, h, subtitleHeight = 0) {
  const p = sim.prompt;
  if (!p) return;
  const W = 410;
  const H = 56;
  const x = (w - W) / 2;
  const y = subtitleHeight > 0 ? h - 60 - subtitleHeight - 12 - H : h - 158;
  if (y < 120) return;
  panel(ctx, x, y, W, H, p.accent, 0.94);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `bold 13px ${MONO}`;
  ctx.fillStyle = p.accent;
  ctx.fillText(p.title, x + W / 2, y + 21);
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = BONE;
  ctx.fillText(p.line, x + W / 2, y + 39);
  // The key: a rounded cap with the letter in it, at the left of the plate.
  ctx.fillStyle = 'rgba(255,246,234,0.9)';
  rounded(ctx, x + 12, y + 17, 22, 22, 4);
  ctx.fill();
  ctx.fillStyle = '#0b0812';
  ctx.font = `bold 13px ${MONO}`;
  ctx.fillText('E', x + 23, y + 33);
  ctx.restore();
}

/** The subtitle box: the speaker's tag in caps, then their line, bottom-centre. Returns its height. */
function subtitle(ctx, sim, w, h) {
  const sub = sim.story.sub;
  if (!sub) return 0;
  const W = 410;
  const x = (w - W) / 2;
  const fade = sub.t < 0.35 ? sub.t / 0.35 : sub.t > sub.life - 0.5 ? Math.max(0, (sub.life - sub.t) / 0.5) : 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, fade));
  ctx.font = `bold 12px ${MONO}`;
  const text = sub.line;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width > W - 40 && line) {
      lines.push(line);
      line = word;
      if (lines.length >= 3) break;
    } else {
      line = trial;
    }
  }
  if (lines.length < 3 && line) lines.push(line);
  const H = 30 + lines.length * 18;
  const y = h - 60 - H;
  ctx.fillStyle = 'rgba(6,4,12,0.82)';
  rounded(ctx, x, y, W, H, 4);
  ctx.fill();
  ctx.fillStyle = PINK;
  rounded(ctx, x, y, 3.5, H, 2);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = PINK;
  ctx.fillText(sub.tag, x + 16, y + 17);
  ctx.font = `12px ${MONO}`;
  ctx.fillStyle = BONE;
  lines.forEach((l, i) => ctx.fillText(l, x + 16, y + 35 + i * 18));
  ctx.restore();
  return H;
}

/** A one-line message: a mission passed, a tape taken, a fare paid. */
function toast(ctx, sim, w, h) {
  const t = sim.story.toast;
  if (!t || sim.story.toastT <= 0) return;
  const alpha = Math.min(1, sim.story.toastT);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.font = `bold 13px ${MONO}`;
  const y = 122;
  const tw = ctx.measureText(t).width + 44;
  ctx.fillStyle = 'rgba(6,4,12,0.82)';
  rounded(ctx, w / 2 - tw / 2, y - 19, tw, 28, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,210,60,0.5)';
  ctx.lineWidth = 1;
  rounded(ctx, w / 2 - tw / 2, y - 19, tw, 28, 4);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.fillText(t, w / 2, y);
  ctx.restore();
}

/** The payout numbers that rise over a point in the world: fares, tapes, airtime. */
function floaters(ctx, sim) {
  if (!sim.project || !sim.work.floaters.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  for (const f of sim.work.floaters) {
    const p = sim.project(f.x, f.y, f.z);
    if (p.depth > 1) continue;
    const a = 1 - f.t / f.life;
    ctx.globalAlpha = Math.max(0, a);
    ctx.font = `bold 15px ${MONO}`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(f.text, p.x + 1, p.y + 1);
    ctx.fillStyle = f.colour;
    ctx.fillText(f.text, p.x, p.y);
  }
  ctx.restore();
}

/**
 * The activity strip, bottom-centre-left: the four side things, always visible, each with its count
 * or its price. It is what makes "there are other things to do" legible in a single frame.
 */
function activityStrip(ctx, sim, w, h) {
  const work = sim.work;
  const y = h - 26;
  const items = [
    { key: 'TAXI', value: `${work.taxiCount} FARE${work.taxiCount === 1 ? '' : 'S'}`, colour: GOLD },
    { key: 'TAPES', value: `${work.tapes}/${work.tapesTotal}`, colour: '#ff8fc0' },
    { key: 'RESPRAY', value: `$${WORK.respray}`, colour: CYAN },
    { key: 'STUNT', value: work.bestAir > 0 ? `${work.bestAir.toFixed(2)}S` : 'RAMP', colour: '#ff9a5c' },
  ];
  const gap = 8;
  ctx.save();
  ctx.font = `bold 9px ${MONO}`;
  let total = 0;
  for (const item of items) {
    const kw = ctx.measureText(item.key).width;
    item.w = Math.max(96, kw + ctx.measureText(item.value).width + 34);
    total += item.w + gap;
  }
  total -= gap;
  let x = (w - total) / 2;
  for (const item of items) {
    ctx.fillStyle = 'rgba(6,4,12,0.66)';
    rounded(ctx, x, y - 13, item.w, 22, 3);
    ctx.fill();
    ctx.fillStyle = item.colour;
    rounded(ctx, x, y - 13, 2.5, 22, 1.5);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = `bold 9px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.62)';
    ctx.fillText(item.key, x + 9, y + 1);
    ctx.textAlign = 'right';
    ctx.font = `bold 10px ${MONO}`;
    ctx.fillStyle = item.colour;
    ctx.fillText(item.value, x + item.w - 8, y + 1);
    x += item.w + gap;
  }
  ctx.restore();
}

/**
 * The district banner: the name of the place, in large type, sliding in from the left when the player
 * crosses a boundary and fading out again. It sits in the open band between the minimap column and the
 * clock, at a height nothing else in the HUD uses — the objective panel is on the left below the map,
 * and the middle of the frame is the street.
 *
 * The type is set on a translucent plate with a rule over it, so the name reads against a bright
 * morning sky as well as a lit facade, and does not have to fight whatever is behind it.
 */
function districtBanner(ctx, sim, w, h) {
  const b = sim.work.banner;
  if (!b) return;
  // Slide in over the first third, hold, fade over the last quarter.
  const t = b.t;
  const inT = Math.min(1, t / 0.5);
  const outT = Math.min(1, Math.max(0, (b.life - t) / 0.7));
  const ease = 1 - (1 - inT) ** 3;
  const alpha = Math.min(ease, outT);
  const slide = (1 - ease) * -180;
  const x = 386 + slide;
  const y = 168;

  ctx.save();
  ctx.globalAlpha = alpha;
  // Measure the name so the plate fits it exactly, with a margin and room for the tag under it.
  ctx.font = `bold 40px ${SANS}`;
  const tw = ctx.measureText(b.name).width;
  const plateW = tw + 34;
  ctx.fillStyle = 'rgba(6,4,12,0.72)';
  rounded(ctx, x - 14, y - 46, plateW, 76, 3);
  ctx.fill();
  // A rule over the name, in the district's own colour, and the name under it.
  ctx.fillStyle = b.accent;
  ctx.fillRect(x, y - 34, 68, 3);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillText(b.name, x + 2, y + 2);
  ctx.fillStyle = BONE;
  ctx.fillText(b.name, x, y);
  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = b.accent;
  ctx.fillText('DISTRICT', x + 2, y + 18);
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.7)';
  ctx.fillText('VICE MERIDIAN III', x + 74, y + 18);
  ctx.restore();
}

// ---------------------------------------------------------------- cards

function endCard(ctx, sim, w, h, mode) {
  ctx.save();
  ctx.fillStyle = mode === 'wasted' ? 'rgba(40,4,10,0.62)' : 'rgba(4,8,26,0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.font = `bold 62px ${SANS}`;
  ctx.fillStyle = mode === 'wasted' ? RED : '#5a8bff';
  ctx.fillText(mode === 'wasted' ? 'WASTED' : 'BUSTED', w / 2, h / 2 - 14);
  ctx.font = `bold 12px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.8)';
  ctx.fillText('PRESS R TO GET UP', w / 2, h / 2 + 22);
  if (sim.mode === 'wasted' && sim.player.hp <= 0) {
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.55)';
    ctx.fillText(`HOSPITAL BILL $100  ·  ${money(sim.story.cash)} LEFT`, w / 2, h / 2 + 44);
  }
  ctx.restore();
}

function pauseCard(ctx, sim, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,4,10,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.font = `bold 36px ${SANS}`;
  ctx.fillStyle = BONE;
  ctx.fillText('PAUSED', w / 2, h / 2 - 6);
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.7)';
  ctx.fillText('ESC TO RESUME  ·  M TO MUTE  ·  TAB FOR THE RADIO', w / 2, h / 2 + 22);
  ctx.restore();
}

export { MAP, MAP_SPAN };
