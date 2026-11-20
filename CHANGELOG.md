# Changelog

## 2026-11-20

### Added
- **Score bar** on the score screen, filled to the score and coloured by status (red <40,
  orange 40–74, green 75+).
- **Time at altitude**: continuous time above 1500 m on the score screen (`2d 5h` / `3h 20m`)
  and in the workout summary (*Time above 1500 m*). It counts from the first night of the current
  run of nights above 1500 m, or from the app-observed arrival.
- **Fast-ascent alert**: a tone/vibration plus an "Ascent too fast" popup (`a.html`) in two cases:
  - you sleep more than 500 m higher than the night before, above 3000 m;
  - you're above 2500 m and at least 1000 m above your acclimatized altitude.

  It repeats at most every 6 hours and re-arms after the gap closes.
- The *Caution: ascent too fast* status now also covers being 1000 m or more above the
  acclimatized altitude, not just the sleeping-altitude jump.
- Sleep start times are stored with each night.
- `CHANGELOG.md`.

### Changed
- Smaller title arch (17% of the screen instead of 25%) on the score and graph screens, with
  larger altitude/score digits and taller graph bars.
- *Nights at altitude* now counts only an unbroken run of tracked nights: a gap of more than
  1.5 days starts a new count.
- The Altitude field reads `Fusion/Altitude` directly. The `altitude` output was removed to stay
  within the build tool's limit of 20 outputs.
- README rewritten to cover all screens, the alert, the algorithm, data sources, tuning and
  building.

## 2026-11-15

### Changed
- Manifest: author set to Panagiotis Kritikakos, version back to `1.0`, compact formatting.

## 2026-11-09

### Fixed
Found by running the app in the SuuntoPlus simulator:
- Status line showed `--`: the status formatter used `[x]` indexing, which the format-string
  translation step rewrites as a token. It now uses a ternary chain.
- Graph scores were invisible (drawn in `cm-fgc`, black in the dark theme). They now use
  `cm-bgc`.
- Units (m/ft) never showed. Each eval and its `<postfix />` are now sibling spans in a
  `sp-vertical-center` row, which also fixes misaligned and clipped text.

### Changed
- The score screen shows "Adapted to …" only. Nights at altitude moved to the workout summary
  and the graph.

## 2026-10-27

### Added
- **Last 7 nights graph** (`g.html`), opened with the lower button: per-night sleeping altitude
  bars with the morning-after acclimatization as a coloured fill and a score label.
- Per-night scoring: each stored night is replayed through the model.
- Workout summary outputs: *Acclimatization*, *Acclimatized to*, *Nights at altitude*.

### Changed
- **Acclimatization model rewritten.** The score is now built around an acclimatized altitude
  that combines:
  - an exposure model driven by sleeping altitude (3-day time constant, 500 m/day cap, 10-day
    decay);
  - physiological evidence from the watch's nightly sleep summaries (`/Daily/Sleep/{0..-6}/Data`:
    sleeping altitude, minimum HR, highest SpO2, average HRV, sleep quality) and the latest spot
    SpO2 (`Daily/Spo2`), compared with a personal low-altitude baseline.
- New statuses: *Not acclimatized*, *Acclimatizing*, *Acclimatized*, plus cautions for low
  SpO2, high sleeping HR and too-fast ascent.
- The last 28 nights are kept in `localStorage` (`altiaccli_state_v2`), which is now written
  only when something changes instead of every second.
- Manifest inputs reduced to `Dev/Time` and `Fusion/Altitude`. The undocumented resources are
  read via `$.get` so watches without them still load the app.

### Removed
- `counter` output, the workout-minimum-HR input and the exercise-state input.
- `pre-q.c64.png` preview image.

## 2026-09-13

### Added
- Initial version: score from heart-rate recovery since arriving at a 500 m altitude band,
  blended with days spent at that band. Score, altitude, days at altitude and status shown on
  a single screen.
