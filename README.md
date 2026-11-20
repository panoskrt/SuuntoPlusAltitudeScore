# SuuntoPlusAltitudeScore (AltiAccli)

A SuuntoPlus sports app for Suunto watches that estimates how well you are acclimatized to the
altitude you are at right now. It combines the time you have spent sleeping at altitude with
the watch's own overnight measurements (sleeping altitude, heart rate, blood oxygen, HRV and sleep
quality) into a 0–100 score. It also shows how long you have been at altitude, graphs the last 7
nights, and alerts you when you ascend faster than your acclimatization allows.

> **Not a medical device.** The score is an indicator built from field-data approximations and
> mountaineering guidelines. It cannot diagnose or rule out altitude sickness. Always follow
> established ascent guidelines and descend if you have symptoms.

## Contents

- [Screens](#screens)
- [Fast-ascent alert](#fast-ascent-alert)
- [Workout summary](#workout-summary)
- [How it works](#how-it-works)
- [Data sources](#data-sources)
- [Tuning](#tuning)
- [Project structure](#project-structure)
- [Building and installing](#building-and-installing)
- [Supported watches](#supported-watches)
- [Limitations](#limitations)
- [License](#license)

## Screens

### Score screen (`t.html`)

The default view when you scroll to the app during a workout.

| Element | Meaning |
| --- | --- |
| **Altitude** | Current altitude from the watch (shown in your unit system). |
| **Score** | 0–100: how acclimatized you are to the current altitude. 100 below 1500 m. |
| **Score bar** | Fills to the score; red below 40, orange 40–74, green 75 and up. |
| **Status** | *No altitude stimulus* (below 1500 m), *Not acclimatized* (<40), *Acclimatizing* (40–74), *Acclimatized* (75+), or a caution: *low SpO2*, *high sleep HR* or *ascent too fast*. |
| **Adapted to** | Your estimated acclimatized altitude: the altitude your body is currently adapted to. |
| **At altitude** | How long you have been continuously above 1500 m, e.g. `2d 5h`, or `3h 20m` under a day. |

Press the **lower button** to open the graph.

### Last 7 nights (`g.html`)

One bar per calendar night, oldest on the left:

- **Bar height:** that night's sleeping altitude above 1500 m. The label below gives the
  altitude at the top of the scale.
- **Coloured fill:** the share of that altitude you were adapted to the morning after, with the
  same colours as the score bar.
- **Number:** that night's score.
- Untracked nights are left empty. Nights below 1500 m show as a flat stub.

Press the **lower button** again to return to the score screen.

### Fast-ascent popup (`a.html`)

See [Fast-ascent alert](#fast-ascent-alert). The lower button (or a tap on *Dismiss*) closes it.

## Fast-ascent alert

The app plays a tone/vibration and opens an **"Ascent too fast"** popup when either of these
happens:

1. **Sleeping-altitude jump:** you slept more than 500 m higher than the night before, above
   3000 m (the common sleeping-ascent guideline).
2. **Far above your acclimatization:** you are above 2500 m and at least 1000 m higher than your
   acclimatized altitude, for example after driving or taking a lift straight up from low
   altitude.

While the fast ascent lasts, the status reads *Caution: ascent too fast* and the alert repeats at
most every 6 hours. It re-arms once you are back within 700 m of your acclimatized altitude (and
the sleeping-altitude jump no longer applies), so the next fast ascent alerts straight away.

## Workout summary

At the end of a workout the app adds these values to the summary (watch and Suunto app):

| Field | Value |
| --- | --- |
| Acclimatization | Score at the end of the workout (%). |
| Acclimatized to | Acclimatized altitude. |
| Nights at altitude | Consecutive tracked nights slept above 1500 m. |
| Time above 1500 m | Continuous time at altitude. |

## How it works

Everything is expressed as an **acclimatized altitude A**: the altitude the body is currently
adapted to. Everyone counts as adapted up to 1500 m.

### 1. Exposure model (the prior)

Sleeping altitude drives acclimatization. Each night, A moves toward that night's sleeping
altitude with first-order kinetics:

- **Time constant:** 3 days, so about 90% within a week at 3000 m.
- **Rate cap:** 500 m per day, mirroring the sleeping-ascent guideline above 3000 m.
- **Decay:** when you sleep lower, A decays back with a 10-day time constant (roughly a one-week
  half-life). A week at home after two weeks at 3000 m leaves about 2,150 m of adaptation.
- **Untracked nights:** assumed to be at the lower of the neighbouring nights' altitudes.
- **Since the last night:** time is credited at the altitude the app has seen since then.

### 2. Physiology (the evidence)

The last two nights at the current sleeping altitude are compared with your personal sea-level
baseline, built from nights below 1000 m. Each marker becomes a fraction from 0 ("like a first
night at this altitude") to 1 ("adapted"):

| Marker | Compared with | Weight |
| --- | --- | --- |
| **Blood oxygen (SpO2)**, highest of the night | Expected first-night and acclimatized values for that altitude (table below), shifted by your own low-altitude readings to cancel sensor bias | 0.6 |
| **Minimum sleeping HR** | Rise over baseline vs. the rise expected at that altitude (8% of baseline per km above 1000 m); 30% of it may remain once adapted | 0.35 |
| **Average sleeping HRV** | Drop below baseline vs. the expected drop (12% per km, up to 60%); same 30% residual | 0.25 |
| **Sleep quality** | Drop below baseline | 0.1 |

Weights follow how specific each marker is to altitude, and shrink at low altitudes where the
expected change is within sensor noise. A **spot SpO2** measurement from the last 2 hours adds a
smaller estimate (weight 0.25) for the current altitude.

Expected sleeping SpO2 (%), approximate, compiled from field data (e.g. Luks & Swenson 2011,
*Pulse oximetry at high altitude*):

| Altitude (m) | 1500 | 2000 | 2500 | 3000 | 3500 | 4000 | 4500 | 5000 | 5500 | 6000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| First night | 96 | 94 | 92 | 90 | 87.5 | 85 | 82.5 | 80 | 77 | 74 |
| Acclimatized | 96.5 | 95.5 | 94 | 93 | 91 | 89.5 | 88 | 86 | 84 | 81 |

### 3. Blend

A is the weighted mean of the exposure model (weight 1) and the physiological estimate.
Physiology can lift A by at most half of the remaining gap above the exposure model, so one good
night cannot claim full adaptation on day one. It can lower A without limit.

### 4. Score

```
score = 100 × clamp(1 − (current altitude − A) / max(current altitude − 1500 m, 1000 m), 0, 1)
```

The 1000 m floor keeps mild altitudes just above 1500 m from swinging between 0 and 100.

### Cautions

Shown only above 2500 m. They replace the normal status, in this order of priority:

1. **Low SpO2:** calibrated SpO2 (sleep or recent spot reading) more than 4 points below the
   expected first-night value.
2. **High sleep HR:** minimum sleeping HR more than max(10 bpm, 1.5× the expected rise) above
   baseline.
3. **Ascent too fast:** see [Fast-ascent alert](#fast-ascent-alert).

### Time at altitude

Continuous time above 1500 m. It counts from bedtime on the first night of the current run of
nights above 1500 m. A gap of more than 1.5 days between tracked nights starts a new run. If the
app saw you arrive at your current altitude earlier, or there is no recent sleep data, it counts
from that arrival instead. It reads 0 below 1500 m.

### Fallbacks

- **No sleep history** (resource unavailable, sleep tracking off): the score runs on the
  exposure model using the time since the app first saw the current altitude.
- **Missing markers** (no SpO2 sensor, no low-altitude baseline yet): they simply drop out of
  the blend. Without a baseline, only SpO2 contributes, at reduced weight.

## Data sources

The resources documented for SuuntoPlus sports apps carry no wellness history. However, the watch
exposes the nightly sleep summaries its own widgets use. They are read with `$.get` from
`main.js` rather than listed in the manifest: a missing manifest path stops an app from loading,
whereas a missing `$.get` path just never answers, so the app falls back gracefully.

| Resource | Used for | Fields |
| --- | --- | --- |
| `Fusion/Altitude` (manifest) | Current altitude | — |
| `Dev/Time` (manifest) | Current time (UTC) | — |
| `/Daily/Sleep/{0..-6}/Data` | Last 7 nights | `altitude`, `minimumHr`, `maximumSpO2`, `averageHrv`, `quality`, `duration`, `startTimeUTC`, `endTimeUTC` |
| `Daily/Spo2` | Latest spot SpO2 | `data.absolute`, `data.timestamp`, `data.confidence` |

The history is re-read every 15 minutes while the app runs. The last 28 nights, the personal
baseline (a ~10-night moving average) and the fast-ascent alert state are kept in the app's
`localStorage` (`altiaccli_state_v2`). That way trips longer than the watch's 7-night window keep
their history, and storage is only written when something changes.

## Tuning

All model constants are at the top of [`main.js`](main.js) with comments. The most relevant:

| Constant | Default | Meaning |
| --- | --- | --- |
| `THRESHOLD` | 1500 m | Altitude everyone counts as adapted to. |
| `LOW_ALTITUDE` | 1000 m | Nights below this build the personal baseline. |
| `CAUTION_ALTITUDE` | 2500 m | Cautions and alerts only above this. |
| `TAU_UP` / `TAU_DOWN` | 3 / 10 days | Acclimatization and de-acclimatization time constants. |
| `MAX_GAIN_PER_DAY` | 500 m | Daily cap on acclimatization gain; also the sleeping-jump alert. |
| `RAPID_GAP` | 1000 m | Gap above acclimatized altitude that triggers the alert. |
| `ALERT_REPEAT` | 6 h | Minimum time between repeated alerts. |
| `W_SPO2`, `W_HR`, `W_HRV`, `W_SLEEP`, `W_SPOT` | 0.6, 0.35, 0.25, 0.1, 0.25 | Marker weights. |
| `MAX_PHYS_LEAD` | 0.5 | Share of the gap physiology may close above the exposure model. |
| `SPO2_ACUTE`, `SPO2_ADAPTED` | table above | Expected sleeping SpO2 by altitude. |

## Project structure

| File | Purpose |
| --- | --- |
| [`manifest.json`](manifest.json) | App metadata, 2 inputs, 20 outputs, 3 templates. |
| [`main.js`](main.js) | Model, history handling, alert logic and view switching (ES5, no `Date`). |
| [`t.html`](t.html) | Score screen. |
| [`g.html`](g.html) | Last 7 nights graph (canvas). |
| [`a.html`](a.html) | Fast-ascent popup. |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history. |

The 20 outputs are the build tool's maximum (the docs say 25, but the tools enforce 20):

- `acclimatization`, `acclimatizedAltitude`, `nightsAtAltitude`, `timeAtAltitude`, `status`;
- `nightAlt0..6` and `nightScore0..6` (index 0 = last recorded night) and `graphTop` for the
  graph.

The current altitude is read directly from `Fusion/Altitude` in the template.

## Building and installing

You need [Visual Studio Code](https://code.visualstudio.com/) with the **SuuntoPlus Editor**
extension.

1. Open this folder in VS Code.
2. Run **SuuntoPlus: Build SuuntoPlus App** to build, or **SuuntoPlus: Open SuuntoPlus
   Simulator** to try it. In the simulator, load a workout file at altitude to see a non-trivial
   score, because the simulator's mock sleep data reuses the workout altitude.
3. Run **SuuntoPlus: Deploy Default App To Watch** with the watch connected.
4. On the watch, add **AltiAccli** to a sport mode's SuuntoPlus slot and start a workout.

Builds produce `*.fea` files (one per display, git-ignored). The build tool can also be run
headless:

```bash
node ~/.vscode/extensions/suunto.suuntoplus-editor-<version>/node_modules/@suunto-internal/suuntoplus-tools/bin/build-app.js --appID <id> --input "$PWD" --output /path/to/out
```

Pass an absolute `--input` path: a relative one crashes the HTML converter. Check that the output
folder actually contains `.fea` files, because the tool prints "Build successful" even when
validation fails.

For the watch to have sleep data, sleep tracking (and ideally SpO2 and HRV measurement during
sleep) must be enabled.

## Supported watches

Builds are produced for every SuuntoPlus display: s, m, l (UI1) and n, o, q (UI2). It has been
checked in the simulator on the Suunto 9 Peak Pro (240 px) and Suunto Race / Vertical 2 / Ocean
(466 px), in both light and dark themes. Physiological markers depend on the watch's sensors and
firmware; watches without SpO2 or overnight HRV use the remaining markers.

## Limitations

- The sleep and SpO2 resources are not documented for sports apps. They are confirmed in the
  simulator and in the firmware's own widgets, but not yet on a physical watch. Without them,
  the app falls back to the exposure model.
- The app only runs during a workout with the SuuntoPlus app active. Exposure between workouts
  is inferred from sleep data, or assumed to continue at the last altitude seen.
- Daytime exposure ("climb high, sleep low") is only credited until the next night is recorded.
- The fast-ascent popup uses a custom layout because the SDK's `:dialog` macro did not render
  its button labels in the simulator. Popups and indications are documented for UI2 watches.
- All thresholds are population approximations. Individual responses to altitude vary widely.

## License

[GNU General Public License v3.0](LICENSE).
