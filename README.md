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
| `/?demo` | Autopilot runs the whole course: method off the kicker, speed-checks the step-down, drops the cliff |
| `/?demo=indy` · `stalefish` · `japan` | Same, with a different grab |
| `/?demo=flip` / `badflip` | Backflip method / an under-rotated one (watch it get hurt) |
| `/?demo=rail` | Takes the rail first |
| `/?demo=chute` | Takes the chute instead of the cliff |
| `/?demo=late` | Holds the grab into the landing |
| `/?pose=methodTweak` | Turntable of a rider pose (`ride`, `tuck`, `air`, `flipTuck`, `slide`, `crash`, or a grab name — `method`, `indy`, `stalefish`, `japan` — to animate it) |

## The course

Rail (right side of the run-in) → big table-top kicker → step-down
(**max 60 km/h**) → choose your line: **cliff** ledge on the left (**max 30
km/h**, ~9 m rock face) or the **chute** on the right. Signs and the HUD tell
you what's next and how fast you can hit it; your speed flashes red when
you're too hot.

## Controls

| Key | On snow | In the air | On the rail |
|---|---|---|---|
| ← → | Carve | Spin | Balance |
| ↑ | Drop in / tuck | Frontflip | |
| ↓ | Brake | Backflip | |
| Space | Hold to load, release to ollie | | Release to pop off |
| J / K / L / I | | Method / indy / stalefish / japan. Hold to tweak, switch keys to combo — **let go before you land** | |
| R / C / V | Restart / photo cam / retro pixels | | |
| G | Switch stance (start screen): goofy is default | | |

## How getting hurt works

- Every landing is scored by how hard you hit *into* the slope (m/s), whether the
  board is lined up with where you're going, and whether you're still grabbing.
- Clean under ~10.5 m/s, heavy over 12 (legs may give out), crash over 15.5.
  Landing sideways (>58°), still holding the grab, more than 65° off on a
  flip, casing the table, losing it on the rail, riding into the rail, or
  hitting a tree are crashes too.
- Every slam gets a slow-mo replay, then an X-ray of what you hurt.
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
- `src/xray.js` — the X-ray film.
- `src/main.js` — renderer, cameras (chase + photo cam), HUD, replay, demo autopilot.
