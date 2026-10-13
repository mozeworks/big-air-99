# Big Air '99

A late-90s style 3D snowboard game in the browser (Three.js, no build step).
One SSX-sized table-top kicker. Go big, stomp it — and if you don't, you get hurt.
Injuries stick around between runs and change how the rider handles.

## Run it

```bash
python3 -m http.server 8090
```

Then open http://localhost:8090.

| URL | What it does |
|---|---|
| `/` | Play |
| `/?demo` | Autopilot pops the lip, holds a method, lets go before landing |
| `/?demo=late` | Autopilot holds the grab into the landing (watch it get hurt) |
| `/?pose=methodTweak` | Turntable of a rider pose (`ride`, `tuck`, `air`, `methodGrab`, `methodTweak`, `crash`, or `method` to animate) |

## Controls

| Key | On snow | In the air |
|---|---|---|
| ← → | Carve | Spin |
| ↑ | Drop in / tuck | |
| ↓ | Brake | |
| Space | Hold to load, release to ollie (pop it on the lip) | |
| Shift / J | | Hold for a method, keep holding to tweak — **let go before you land** |
| R / C / V | Restart / photo cam / retro pixels | |

## How getting hurt works

- Every landing is scored by how hard you hit *into* the slope (m/s), whether the
  board is lined up with where you're going, and whether you're still grabbing.
- Clean under ~10.5 m/s, heavy over 12 (legs may give out), crash over 15.5.
  Landing sideways (>58°), still holding the grab, casing the table, or hitting
  a tree are crashes too.
- Each crash type hurts different body parts (`src/injury.js`). Injuries
  have real effects: a bad knee kills your pop, a hurt wrist slows your grab,
  a bad back limits the tweak, a concussion blurs your vision.
- Injuries persist in the browser's local storage. **H** rests a week; anything
  serious (fracture, torn ACL…) means an ambulance and rehab.

## Code map

- `src/profile.js` — the course profile (grade curve → elevation). Tuned with a
  physics sim so cruising off the lip lands clean on the landing, tucking +
  ollieing overshoots into injury territory.
- `src/course.js` — terrain mesh, trees, flags, backdrop, collision.
- `src/rider.js` — articulated rider; poses + two-bone IK for arms and legs.
- `src/player.js` — physics, carving, ollie, spins, grabs, landing evaluation.
- `src/injury.js` — injury model and persistence.
- `src/main.js` — renderer, cameras (chase + photo cam), HUD, demo autopilot.
