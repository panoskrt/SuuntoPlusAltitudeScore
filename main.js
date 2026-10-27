// SuuntoPlus Sports App: altitude acclimatization score
//
// The score (0-100) answers "how acclimatized am I to the altitude I'm at
// right now". It is built around one quantity, the acclimatized altitude A:
// the altitude the body is currently adapted to. Everyone is treated as
// adapted up to THRESHOLD (1500 m), and the score is the share of the climb
// from THRESHOLD to the current altitude that A already covers (scaled
// against at least MIN_SPAN, so mild altitudes just above 1500 m don't
// swing between 0 and 100).
//
// Data. The resources documented for sports apps carry no wellness history,
// but the watch's resource tree exposes the nightly sleep summaries the
// firmware widgets use: /Daily/Sleep/{0..-6}/Data gives, per night, the
// sleeping altitude, minimum HR, highest SpO2, average HRV and a sleep
// quality score, and Daily/Spo2 holds the latest spot SpO2 reading. These
// are read with $.get rather than listed in the manifest: a missing manifest
// path stops the app from loading, whereas a missing $.get path just never
// calls back, so watches without them fall back to the app-observed stay
// below. The last MAX_NIGHTS nights are kept in localStorage, so trips
// longer than the watch's 7-night window still work, and nights below
// LOW_ALTITUDE build a personal sea-level baseline.
//
// 1. Exposure model (the prior). Sleeping altitude drives acclimatization.
//    Each night, A moves toward that night's altitude with first-order
//    kinetics (TAU_UP), capped at MAX_GAIN_PER_DAY to mirror the 500 m/day
//    sleeping-ascent guideline; above a lower sleeping altitude A decays
//    back (TAU_DOWN, about a one-week half-life). Time since the last night
//    is credited at the altitude the app has seen since then.
// 2. Physiology (the evidence). The latest nights at the current sleeping
//    altitude are compared with the baseline, each marker giving a 0-1
//    fraction from "first night at this altitude" to "adapted":
//    - SpO2 between the expected first-night and acclimatized values for
//      that altitude, corrected by the user's own low-altitude readings;
//    - sleeping HR rise over baseline against the rise expected there;
//    - HRV drop below baseline against the drop expected there;
//    - sleep quality drop below baseline (small weight).
//    Their weighted mean maps to an estimate of A. A fresh spot SpO2 reading
//    adds a smaller-weight estimate for the current altitude.
// 3. A is the weighted blend of both, but physiology may lift A by at most
//    MAX_PHYS_LEAD of the gap above the exposure model, so one good night
//    can't claim full adaptation on day one; it can lower A without limit.
//
// Warning signs override the status: SpO2 well below even first-night
// levels, a large sleeping HR rise, or sleeping more than 500 m higher than
// the night before above 3000 m. All constants are approximations from
// field data and guidelines, an indicator rather than a medical assessment.

var STATE_KEY = 'altiaccli_state_v2';
var DAY = 86400;
var THRESHOLD = 1500;          // m; everyone counts as adapted up to here
var MIN_SPAN = 1000;           // m; deficit scale near THRESHOLD, so 1600 m never reads as 0%
var LOW_ALTITUDE = 1000;       // m; nights below this build the personal baseline
var CAUTION_ALTITUDE = 2500;   // m; warnings only above this
var SAME_ALTITUDE = 300;       // m; nights and readings this close count as the same altitude
var MAX_NIGHTS = 28;           // nightly records kept in localStorage
var WATCH_NIGHTS = 7;          // the watch exposes /Daily/Sleep/0/Data .. /Daily/Sleep/-6/Data
var EVIDENCE_NIGHTS = 2;       // latest nights at the current sleeping altitude used as evidence
var BASELINE_NIGHTS = 10;      // baseline is a running mean, then a ~10-night moving average
var MIN_SLEEP = 3 * 3600;      // s; shorter sleeps are naps or tracking gaps
var STALE_NIGHT = 1.5 * DAY;   // s; an older last night says nothing about today
var SPOT_MAX_AGE = 2 * 3600;   // s; older spot SpO2 readings are ignored
var REFRESH = 900;             // s; re-read the watch history this often

var TAU_UP = 3;                // days; acclimatization time constant (~90% in a week at 3000 m)
var MAX_GAIN_PER_DAY = 500;    // m; the 500 m/day sleeping-ascent guideline above 3000 m
var TAU_DOWN = 10;             // days; de-acclimatization time constant

var W_TIME = 1;                // blend weights: exposure model, then markers by how specific
var W_SPO2 = 0.6;              // they are to altitude (SpO2 most, sleep quality least)
var W_HR = 0.35;
var W_HRV = 0.25;
var W_SLEEP = 0.1;
var W_SPOT = 0.25;
var MAX_PHYS_LEAD = 0.5;       // share of the gap above the exposure model physiology may close

// Expected sleeping SpO2 (%) of a lowlander on the first night at an altitude
// and once acclimatized to it (approximate, compiled from field data, e.g.
// Luks & Swenson 2011, "Pulse oximetry at high altitude").
var SPO2_ALT = [0, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000];
var SPO2_ACUTE = [97.5, 97, 96, 94, 92, 90, 87.5, 85, 82.5, 80, 77, 74];
var SPO2_ADAPTED = [97.5, 97.3, 96.5, 95.5, 94, 93, 91, 89.5, 88, 86, 84, 81];
var SPO2_LOW = 4;              // %; this far below the first-night value is a warning sign
var HR_RISE_PER_KM = 0.08;     // acute sleeping HR rise, share of baseline per km above LOW_ALTITUDE
var HRV_DROP_PER_KM = 0.12;    // acute sleeping HRV drop, share of baseline per km above LOW_ALTITUDE
var RESIDUAL = 0.3;            // share of the acute HR rise / HRV drop that remains once adapted

// status: 0 = below THRESHOLD, 1 = not acclimatized, 2 = acclimatizing, 3 = acclimatized,
// 4 = caution: low SpO2, 5 = caution: high sleeping HR, 6 = caution: ascent too fast
var CAUTION_SPO2 = 4;
var CAUTION_HR = 5;
var CAUTION_ASCENT = 6;

var state;                     // persisted: nights, baseline, app-observed stay
var model;                     // derived from the nights, rebuilt when they change
var spot = null;               // latest spot SpO2 reading
var lastRequest = 0;
var nightsChanged = true;
var stateChanged = false;

var clamp01 = function (x) {
  return x < 0 ? 0 : (x > 1 ? 1 : x);
};

var inRange = function (x, min, max) {
  return typeof x === 'number' && x >= min && x <= max ? x : null;
};

var interpolate = function (xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (var i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1];
};

var median = function (nights, key) {
  var v = [];
  for (var i = 0; i < nights.length; i++) {
    if (nights[i][key] !== null) v.push(nights[i][key]);
  }
  if (!v.length) return null;
  v.sort(function (a, b) { return a - b; });
  var m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// Moves acclimatized altitude a toward the altitude lived at for `days`.
var expose = function (a, altitude, days) {
  var target = Math.max(altitude, THRESHOLD);
  if (target > a) {
    return a + Math.min((target - a) * (1 - Math.exp(-days / TAU_UP)), MAX_GAIN_PER_DAY * days);
  }
  return target + (a - target) * Math.exp(-days / TAU_DOWN);
};

var parseNight = function (d) {
  if (!d || !(d.duration >= MIN_SLEEP) || typeof d.altitude !== 'number') return null;
  var end = d.endTimeUTC || d.endTime;
  if (!(end > 0)) return null;
  var hr = inRange(d.minimumHr, 0.3, 4); // Hz
  return {
    end: end,
    alt: d.altitude,
    hr: hr === null ? null : hr * 60,
    spo2: inRange(d.maximumSpO2, 50, 100),
    hrv: inRange(d.averageHrv, 1, 300),
    quality: inRange(d.quality, 1, 100)
  };
};

var sameNight = function (a, b) {
  for (var key in b) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

var learnBaseline = function (night) {
  var keys = ['alt', 'hr', 'spo2', 'hrv', 'quality'];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (night[key] === null) continue;
    var n = Math.min((state.baseN[key] || 0) + 1, BASELINE_NIGHTS);
    state.base[key] = n > 1 ? state.base[key] + (night[key] - state.base[key]) / n : night[key];
    state.baseN[key] = n;
  }
};

var storeNight = function (data) {
  var night = parseNight(data);
  if (!night) return;
  var nights = state.nights;
  var i = nights.length;
  while (i > 0 && nights[i - 1].end > night.end) i--;
  if (i > 0 && nights[i - 1].end === night.end) {
    if (sameNight(nights[i - 1], night)) return;
    nights[i - 1] = night;
  } else {
    if (night.alt < LOW_ALTITUDE) learnBaseline(night);
    nights.splice(i, 0, night);
    if (nights.length > MAX_NIGHTS) nights.shift();
  }
  nightsChanged = true;
  stateChanged = true;
};

var storeSpot = function (d) {
  var m = d && d.data;
  if (!m || !(m.timestamp > 0) || inRange(m.absolute, 50, 100) === null) return;
  if (typeof m.confidence === 'number' && m.confidence < 50) return;
  spot = { t: m.timestamp, spo2: m.absolute };
};

// Asks the watch for its nightly sleep summaries and latest spot SpO2.
var requestHistory = function () {
  if (typeof $ === 'undefined' || !$.get) return;
  try {
    for (var i = 0; i < WATCH_NIGHTS; i++) {
      $.get('/Daily/Sleep/' + (-i) + '/Data', storeNight);
    }
    $.get('/Daily/Spo2', storeSpot);
  } catch (e) {
    // Resources not available on this watch; the stay-based fallback applies.
  }
};

// The user's low-altitude SpO2 against the expected value there; corrects
// for sensor bias and for the "highest SpO2 of the night" metric reading high.
var spo2Offset = function () {
  if (!state.baseN.spo2) return 0;
  var offset = state.base.spo2 - interpolate(SPO2_ALT, SPO2_ADAPTED, state.base.alt);
  return Math.max(-3, Math.min(3, offset));
};

// Places an SpO2 reading taken at altitude h between the expected first-night
// value (0) and the acclimatized value (1). Null where the two are too close
// to stand out from sensor noise.
var spo2Evidence = function (spo2, h, weight) {
  var acute = interpolate(SPO2_ALT, SPO2_ACUTE, h);
  var gap = interpolate(SPO2_ALT, SPO2_ADAPTED, h) - acute;
  if (spo2 === null || gap < 0.5) return null;
  var calibrated = spo2 - spo2Offset();
  return {
    f: clamp01((calibrated - acute) / gap),
    w: weight * clamp01(gap / 3) * (state.baseN.spo2 ? 1 : 0.7),
    low: h >= CAUTION_ALTITUDE && calibrated < acute - SPO2_LOW
  };
};

// Turns the latest nights at sleeping altitude h into an estimate of A.
var physiology = function (nights, h) {
  var sum = 0;
  var weight = 0;
  var caution = 0;
  var km = (h - LOW_ALTITUDE) / 1000;
  var add = function (f, w) {
    sum += w * f;
    weight += w;
  };

  var s = spo2Evidence(median(nights, 'spo2'), h, W_SPO2);
  if (s) {
    add(s.f, s.w);
    if (s.low) caution = CAUTION_SPO2;
  }

  var hr = median(nights, 'hr');
  if (hr !== null && state.baseN.hr) {
    var rise = state.base.hr * HR_RISE_PER_KM * km;
    var hrRise = hr - state.base.hr;
    add(1 - clamp01((hrRise - RESIDUAL * rise) / ((1 - RESIDUAL) * rise)), W_HR * clamp01(rise / 5));
    if (!caution && h >= CAUTION_ALTITUDE && hrRise > Math.max(10, 1.5 * rise)) caution = CAUTION_HR;
  }

  var hrv = median(nights, 'hrv');
  if (hrv !== null && state.baseN.hrv) {
    var drop = Math.min(0.6, HRV_DROP_PER_KM * km);
    var hrvDrop = 1 - hrv / state.base.hrv;
    add(1 - clamp01((hrvDrop - RESIDUAL * drop) / ((1 - RESIDUAL) * drop)), W_HRV * clamp01(drop / 0.2));
  }

  var quality = median(nights, 'quality');
  if (quality !== null && state.baseN.quality) {
    add(1 - clamp01((state.base.quality - quality) / 20), W_SLEEP);
  }

  if (!weight) return null;
  return { a: THRESHOLD + (h - THRESHOLD) * sum / weight, w: weight, alt: h, caution: caution };
};

// Replays the stored nights through the exposure model and collects the
// physiological evidence from the latest ones.
var rebuildModel = function () {
  var nights = state.nights;
  var a = THRESHOLD;
  var i;
  for (i = 0; i < nights.length; i++) {
    var days = i ? (nights[i].end - nights[i - 1].end) / DAY : 1;
    if (days > 1.5) {
      // Untracked nights: assume the lower of the neighbouring altitudes.
      a = expose(a, Math.min(nights[i - 1].alt, nights[i].alt), days - 1);
      days = 1;
    }
    a = expose(a, nights[i].alt, days);
  }

  var last = nights.length ? nights[nights.length - 1] : null;
  model = { a: a, last: last, nightsAt: 0, evidence: null, fastAscent: false };
  if (!last) return;

  for (i = nights.length - 1; i >= 0 && nights[i].alt > THRESHOLD; i--) model.nightsAt++;

  var recent = [];
  for (i = nights.length - 1; i >= 0 && recent.length < EVIDENCE_NIGHTS; i--) {
    if (Math.abs(nights[i].alt - last.alt) > SAME_ALTITUDE) break;
    recent.push(nights[i]);
  }
  if (last.alt > THRESHOLD) model.evidence = physiology(recent, last.alt);

  var prev = nights.length > 1 ? nights[nights.length - 2] : null;
  model.fastAscent = !!prev && last.end - prev.end < STALE_NIGHT && last.alt > 3000 &&
    last.alt - prev.alt > MAX_GAIN_PER_DAY;
};

// The app only sees altitude while it runs: a stay starts when it first sees
// the current altitude and lasts until it sees one SAME_ALTITUDE away.
var trackStay = function (altitude, now) {
  if (state.stayStart > 0 && Math.abs(altitude - state.stayAlt) <= SAME_ALTITUDE) return;
  state.stayAlt = altitude;
  state.stayStart = now;
  stateChanged = true;
};

// Acclimatized altitude right now, plus any caution status.
var estimate = function (now, altitude) {
  var last = model.last;
  var a = model.a;
  if (last) {
    var t = last.end;
    if (state.stayStart > t) {
      a = expose(a, Math.min(last.alt, state.stayAlt), (state.stayStart - t) / DAY);
      t = state.stayStart;
    }
    if (now > t) a = expose(a, state.stayStart > 0 ? state.stayAlt : last.alt, (now - t) / DAY);
  } else if (state.stayStart > 0 && now > state.stayStart) {
    a = expose(a, state.stayAlt, (now - state.stayStart) / DAY);
  }

  var exposure = a;
  var sum = W_TIME * a;
  var weight = W_TIME;
  var evidenceAlt = 0;
  var caution = 0;
  var fresh = last && now - last.end < STALE_NIGHT;

  if (fresh && model.evidence) {
    sum += model.evidence.w * model.evidence.a;
    weight += model.evidence.w;
    evidenceAlt = model.evidence.alt;
    caution = model.evidence.caution;
  }
  if (spot && altitude > THRESHOLD && now - spot.t < SPOT_MAX_AGE) {
    var s = spo2Evidence(spot.spo2, altitude, W_SPOT);
    if (s) {
      sum += s.w * (THRESHOLD + s.f * (altitude - THRESHOLD));
      weight += s.w;
      evidenceAlt = Math.max(evidenceAlt, altitude);
      if (s.low) caution = CAUTION_SPO2;
    }
  }
  if (!caution && fresh && model.fastAscent) caution = CAUTION_ASCENT;

  a = Math.min(sum / weight, exposure + MAX_PHYS_LEAD * Math.max(0, evidenceAlt - exposure));
  return { a: Math.max(THRESHOLD, a), caution: caution };
};

function evaluate(input, output) {
  var now = Number(input.Time || 0);
  var altitude = typeof input.Altitude === 'number' ? input.Altitude : null;

  if (now > 0 && now - lastRequest >= REFRESH) {
    lastRequest = now;
    requestHistory();
  }
  if (now > 0 && altitude !== null) trackStay(altitude, now);
  if (nightsChanged) {
    rebuildModel();
    nightsChanged = false;
  }

  if (now > 0 && altitude !== null) {
    var est = estimate(now, altitude);
    var score = 100;
    var status = 0;
    if (altitude > THRESHOLD) {
      score = Math.round(100 * clamp01(1 - (altitude - est.a) / Math.max(altitude - THRESHOLD, MIN_SPAN)));
      status = est.caution || (score < 40 ? 1 : (score < 75 ? 2 : 3));
    }
    output.acclimatization = score;
    output.altitude = Math.round(altitude);
    output.acclimatizedAltitude = Math.round(est.a);
    output.nightsAtAltitude = model.nightsAt;
    output.status = status;
  }

  if (stateChanged) {
    stateChanged = false;
    try {
      localStorage.setObject(STATE_KEY, state);
    } catch (e) {
      // Ignore storage boundaries if present.
    }
  }
}

// main.js loaded and system starts calling evaluate()
function onLoad(input, output) {
  var saved = null;
  try {
    saved = localStorage.getObject(STATE_KEY);
  } catch (e) {
    saved = null;
  }

  state = {
    nights: (saved && saved.nights && typeof saved.nights.length === 'number') ? saved.nights : [],
    base: (saved && saved.base) || {},
    baseN: (saved && saved.baseN) || {},
    stayAlt: (saved && typeof saved.stayAlt === 'number') ? saved.stayAlt : 0,
    stayStart: Number((saved && saved.stayStart) || 0)
  };
  nightsChanged = true;

  output.acclimatization = 0;
  output.altitude = 0;
  output.acclimatizedAltitude = 0;
  output.nightsAtAltitude = 0;
  output.status = 0;
}

/* Other available callbacks:
function onExerciseStart() {}    // Is evaluated on exercise start
function onExercisePause() {}    // Is evaluated on exercise pause
function onExerciseContinue() {} // Is evaluated when continuing exercise after pause
function onLap() {}              // Is evaluated on every lap change
function onAutoLap() {}          // Is evaluated on every autolap change
function onInterval() {}         // Is evaluated on interval
function onPoolLength() {}       // Is evaluated after each pool length (swimming)
*/

// Is evaluated when a user enters the SuuntoPlus sports app screen the first
// time and when the screen is reloaded. Essentially defines what is shown on
// the screen by returning the wanted HTML template.
function getUserInterface() {
  return {
    template: 't'
  };
}

// Defines the info shown at the bottom of the exercise summary info shown after the exercise.
// These values are also provided to SuuntoApp.
// This is called when exercise ends and also when user backs from exercise start panel
// without starting the exercise.
function getSummaryOutputs(input, output) {
  return [
    { id: 's', name: 'Acclimatization', format: 'Count_Fourdigits', value: output.acclimatization, postfix: '%' },
    { id: 'a', name: 'Acclimatized to', format: 'Altitude_Fourdigits', value: output.acclimatizedAltitude },
    { id: 'n', name: 'Nights at altitude', format: 'Count_Fourdigits', value: output.nightsAtAltitude }
  ];
}
