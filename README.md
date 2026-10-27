# SuuntoPlusAltitudeScore
A rough indicator on altitude acclimatization by providing a basic score.

## What the watch shows

- **Score (0–100)**: how acclimatized you are to the altitude you're at right now.
- **Status**: No altitude stimulus (below 1500 m), Not acclimatized (<40), Acclimatizing (40–74),
  Acclimatized (75+), or a caution: low SpO2, high sleeping HR, or ascent too fast.
- **Adapted to … , N nights**: your estimated acclimatized altitude and the number of
  consecutive nights slept above 1500 m.

## Data used

The resources documented for sports apps carry no wellness history, but the watch exposes the
nightly sleep summaries its own widgets use. They are read with `$.get` from `main.js` (not
listed in the manifest, where a missing path would stop the app from loading):

| Resource | Used fields |
| --- | --- |
| `/Daily/Sleep/{0..-6}/Data` | `altitude` (sleeping altitude), `minimumHr`, `maximumSpO2`, `averageHrv`, `quality`, `duration`, `endTimeUTC` |
| `Daily/Spo2` | latest spot reading: `data.absolute`, `data.timestamp`, `data.confidence` |
| `Fusion/Altitude`, `Dev/Time` (manifest) | current altitude and time |

The last 28 nights are kept in `localStorage`, so trips longer than the watch's 7-night window
keep their history. Nights below 1000 m build a personal baseline (sleeping HR, HRV, SpO2,
sleep quality).

## Algorithm

Everything is expressed as an **acclimatized altitude A**, the altitude the body is currently
adapted to. Everyone counts as adapted up to 1500 m.

1. **Exposure model (prior).** Sleeping altitude drives acclimatization. Each night A moves
   toward that night's altitude with first-order kinetics (time constant 3 days, about 90% in a
   week at 3000 m), capped at 500 m/day to match the sleeping-ascent guideline above 3000 m.
   When sleeping lower, A decays back with a 10-day time constant (about a one-week half-life).
   Time since the last night is credited at the altitude the app has seen since then.
2. **Physiology (evidence).** The last two nights at the current sleeping altitude are compared
   with the baseline. Each marker becomes a fraction from 0 ("like a first night here") to 1
   ("adapted"):
   - **SpO2** between the expected first-night and acclimatized values for that altitude,
     shifted by the user's own low-altitude readings to cancel sensor bias;
   - **sleeping HR** rise above baseline, against the rise expected at that altitude (8% of
     baseline per km above 1000 m), allowing 30% of it to persist once adapted;
   - **HRV** drop below baseline, against the expected drop (12% per km), same 30% residual;
   - **sleep quality** drop below baseline (small weight).

   Weights follow how specific each marker is to altitude: SpO2 0.6, HR 0.35, HRV 0.25,
   sleep 0.1. A spot SpO2 reading from the last 2 hours adds a 0.25-weight estimate at the
   current altitude. Each weight shrinks at low altitudes, where the expected change is within
   sensor noise.
3. **Blend.** A is the weighted mean of the exposure model (weight 1) and the physiological
   estimate. Physiology can lift A by at most half of the remaining gap above the exposure
   model, so one good night can't claim full adaptation on day one. It can lower A without
   limit.
4. **Score** = `1 − (current altitude − A) / max(current altitude − 1500 m, 1000 m)`, clamped to
   0–100. The 1000 m floor keeps mild altitudes just above 1500 m from swinging between 0 and 100.

**Cautions** (only above 2500 m): calibrated SpO2 more than 4 points below the expected
first-night value, sleeping HR more than max(10 bpm, 1.5× the expected rise) above baseline, or
sleeping more than 500 m higher than the previous night above 3000 m.

**Fallbacks.** Without sleep history (resources missing, sleep tracking off) the score runs on
the exposure model, using the time since the app first saw the current altitude. Markers that
are missing (no SpO2 sensor, no low-altitude baseline yet) simply drop out of the blend.

Expected sleeping SpO2 (%) used for the SpO2 marker (approximate, compiled from field data, e.g.
Luks & Swenson 2011, *Pulse oximetry at high altitude*):

| Altitude (m) | 1500 | 2000 | 2500 | 3000 | 3500 | 4000 | 4500 | 5000 | 5500 | 6000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| First night | 96 | 94 | 92 | 90 | 87.5 | 85 | 82.5 | 80 | 77 | 74 |
| Acclimatized | 96.5 | 95.5 | 94 | 93 | 91 | 89.5 | 88 | 86 | 84 | 81 |

All constants are at the top of `main.js`. They are approximations from field data and
mountaineering guidelines, so treat the result as an indicator, not a medical assessment.
