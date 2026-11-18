# Vice Meridian III

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/arkhindi12/vice-meridian-3/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/arkhindi12/vice-meridian-3/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game that is one canvas, one page and no build step. You are a courier on an island
city called Vice Meridian: nine avenues on a 300 m grid, four districts, a ten-mission arc about a
ledger that should not exist, and a police department that would rather it did not.

Everything is generated at load from a seed — the city, the traffic, the crowd, the cast's clothes — and
the only asset in the repository is three.js. There is no image file, no audio file and no network
request at runtime: tarmac, paving, windows, palm fronds, neon signs, the sun and the sea are painted
into canvases at start-up, and the music and the gunshots are synthesised on a WebAudio graph.

What is in it:

- **A city you can drive.** 2.4 km of boulevard, glass towers, parks, a beach, a marina and a pier. The
  streets are a lane system, so traffic holds a lane, brakes for the car in front and turns at corners.
- **A GPS route drawn on the road.** An A* search over the avenue grid from your car to the objective,
  stitched into a polyline that only ever runs along streets, offset into the right-hand lane, and
  extruded into a cyan ribbon lying on the asphalt with a soft edge and a pulse that travels toward the
  destination. It turns at intersections; it never cuts a block.
- **A day and night cycle that changes the light.** One directional sun, one hemisphere fill, a fog
  colour, a tone-mapping exposure and the emissive strength of the neon, the lit windows, the street
  lamps and the headlights — all interpolated from a keyframe table between 18:00 and 21:00 and back
  round the clock. Golden hour, dusk, night and morning each have their own palette.
- **Cars that take damage and explode.** Every car carries condition. Crashes and gunfire take it off;
  under 25% the engine smokes, under 15% it burns, at 0% it explodes with a flash, debris, a scorch mark
  on the road, and a black hull that stays where it died and keeps smoking. Fire spreads to a car within
  26 m, and if your own car goes up that is a wasted screen.
- **Side work.** A taxi rank that pays by distance driven, twelve collectible tapes counted on the HUD, a
  respray garage that clears your stars for $250, and a stunt ramp on the Strip that pays by the second
  of airtime. Each has a marker on the minimap and a prompt when you are close.
- **The rest of it.** Ten story missions with six kinds of objective, four named characters who speak in
  subtitles, five wanted stars with a helicopter from four, a dispatch list that prints each unit's
  distance and tactic, three radio stations, a speedometer with the model and the condition, RESPECT, a
  district banner, saved progress and a compass minimap.

## Controls

| key | on foot | in a car |
| --- | --- | --- |
| W A S D | walk (mapped through the camera) | throttle, brake/reverse, steer |
| Shift | run | — |
| mouse | aim; hold the left button to fire | fire where the nose points |
| E | take the nearest car, use a counter or start a side job | leave the car, or use a prompt |
| R | reload | reload |
| Tab | next radio station | next radio station |
| M | mute | mute |
| Esc / P | pause | pause |

A wasted or busted screen is dismissed with R.

## Serve it locally

```sh
node serve.ts          # serves game/ on http://localhost:8080
```

Then open <http://localhost:8080>. Any static file server will do — the game is plain ES modules and
loads nothing from the network. `node serve.ts --port 8093` picks another port.

Add `?shot=cover`, `?shot=foot`, `?shot=mission` or `?shot=driving` (with an optional `&seed=N`) to
stage one of the four screenshot scenes: the same city, posed from the same records, held still.

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

That copies `game/` and `screenshots/` into `out/`, builds `out/dossier.json` with the vendored
make.fun library, and prints what it wrote. It refuses — with the file name and the size — if a
screenshot is missing, over 256 KiB, or not a PNG or JPEG; if `game/index.html` or three.js is absent;
or if any tree would breach the caps. It exits non-zero on any refusal. Without `MAKEFUN_OUTPUT_DIR` it
writes to `/output`, where the bounty's container mounts it.

## The modules, one line each

`game/src/`, the front door first and then the systems, grouped by what they do.

| module | what it does |
| --- | --- |
| `main.js` | The front door: the fixed 1/60 s clock, the two canvases, the chase camera, keyboard-to-input mapping, the render loop and the `?shot=` staging. |
| `sim.js` | The world record and the ten ordered stages of one step — clock, player, collisions, traffic, law, crowd, rounds, damage, side work, story. |
| `units.js` | Every measurement and colour the city is built from, and the damage, work and police constants all systems agree on. |
| `random.js` | One deterministic mulberry32 stream per caller, so a generated city is the same city on every load. |
| `mathKit.js` | Clamp, easing, angle wrapping and turning-toward without spinning the long way round. |
| `cityPlan.js` | The town as records — blocks, lots, shops, districts, tape spots, side-work sites — and the queries the rest of the game asks of it. |
| `meshkit.js` | Piles flat faces into one buffer per material, with metre-space UVs, so the city is ~30 draw calls. |
| `textures.js` | Every image in the game, painted into a canvas at load: tarmac, paving, facades with an emissive window map, neon boards, fronds, sea ripples. |
| `world.js` | The renderer, the light rig, the sky dome, the static city, the lamps, the ramp, and `applyRig` — the one place the hour is written into the scene. |
| `daylight.js` | The clock and its keyframe table: sun colour and elevation, fog, ambient, exposure and the four emissive multipliers for each hour. |
| `gps.js` | A* over the avenue lattice, lane-offset mitred polyline, and the additive ribbon shader with its travelling pulse. |
| `vehicle.js` | Car shapes as merged vertex-coloured buffers, the cruiser's light bar, the headlight pool, and the blackened wreck material. |
| `damage.js` | Condition, smoke, flame, the explosion, the debris, the scorch mark, the fire chain, and the pooling particles they are all drawn from. |
| `cast.js` | The moving cast in three.js: instanced bodies, the player's own rig, the helicopter with its searchlight cone, rounds and muzzle flashes. |
| `crowd.js` | Pedestrians on the pavement ring, steering back to the kerb, panicking away from a gunshot and picked up again after they fall. |
| `traffic.js` | The fleet's lane following, braking, junction turns and edge-of-town recycling. |
| `officers.js` | Stars, heat, cruisers, dismounting crews, their volleys, the air support and the dispatch list the HUD prints. |
| `player.js` | The body on foot and behind the wheel, health and armour, the pistol, reload, and taking or leaving a car. |
| `sidework.js` | Taxi fares, tapes, respray, airtime, the district banner, and the prompt record the HUD draws. |
| `story.js` | The ten missions, the four who speak, the subtitle clock, RESPECT and the rank it buys. |
| `radio.js` | Three stations as text state, and the four-bar WebAudio loop each one plays while you drive. |
| `audio.js` | Guns, engines, tyres, sirens, explosions and footfalls, synthesised; a no-op without an AudioContext. |
| `input.js` | Held and pressed keys, pointer position and motion, and the first-gesture hook audio waits for. |
| `save.js` | The run in one localStorage key, read defensively so a missing or stale record just starts fresh. |
| `hud.js` | The whole display in a 1100-wide design space scaled to the canvas: minimap, objectives, dispatch, vitals, clock, stars, wallet, speedometer, radio, prompt, subtitle, banner, tape counter. |
| `scenes.js` | The four staged frames, each assembled by calling the game's own placement functions and returning a camera. |

## The four screenshots

All four are 1280x720 JPEGs under 190 KiB, rendered by headless Chromium from the game's own `?shot=`
code — not mock-ups.

| file | hour | what it is |
| --- | --- | --- |
| `1-cover.jpg` | **19:05, DUSK** | Four-star chase on the Strip: the cyan route running ahead of the car, four cruisers (two in frame with their bars going), the helicopter overhead with its searchlight on the asphalt, a burning wreck, four filled stars, the dispatch list, the minimap, the radio, the speedometer, a mission objective and a line of dialogue. |
| `2-foot.jpg` | **22:21, NIGHT** | On foot in Neon Heights: neon blade signs, lamp pools, headlights on the road, pedestrians, traffic, the minimap, health and ammo, the objective, RESPECT, the tape counter, DAY and clock. |
| `3-mission.jpg` | **07:19, MORNING** | A side activity, not a story mission: the respray prompt with its $250 price and the two stars it would clear, the district banner mid-slide reading THE SUNGLASS STRIP, the GPS route, traffic and pedestrians, money and stars. |
| `4-driving.jpg` | **18:10, GOLDEN HOUR** | Driving north up the coast boulevard: speedometer with the model and the condition, the radio station and track, the route turning at the junction ahead, traffic in both lanes, the promenade palms and the sea on the left, the minimap. |

Each was checked without looking at it: the render is measured for the ink in every named HUD panel,
and every entity is proved by hiding it and diffing the frames — a nonzero changed-pixel count with a
bounding box is the evidence that the helicopter, the searchlight, the fire, the smoke, the route, the
crowd and the fleet are actually drawn, and where.

## What this is

Made for make.fun's **"Make GTA 6"** bounty — <https://make.fun/bounty/gta6-01>.

three.js is vendored under `game/vendor/three/` and is the only library; it is MIT licensed, and its
licence sits beside it. `serve.ts`, `shots.json` and `vendor/makefun-game.ts` are the kit's own files.
Everything else here — the game, its modules, `main.ts` and this README — was written for this entry.
