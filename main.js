// SuuntoPlus Sports App reference model
//
// Self-calibrating acclimatization score: instead of asserting an absolute
// physiological state, each altitude "band" (500m buckets) gets its own
// arrival baseline, and the score reports how far HR has recovered from
// that baseline plus how many days have been spent at this band, blended
// against a rule-of-thumb expected-adaptation-time curve. Comparing against
// the user's own arrival reading sidesteps individual variability, and the
// days term anchors the estimate so a single lucky HR reading can't
// over-report early adaptation.
//
// The original design (see project notes) also blends in SpO2 recovery,
// but no SpO2/pulse-ox resource is exposed to SuuntoPlus sports apps (there
// is no such entry anywhere in the SDK's resource reference, and the only
// "spo2" symbols in the simulator are unused firmware-settings leftovers,
// not a real subscribable resource). So this only blends HR recovery and
// days-at-band, reweighted to 0.4 / 0.6 as suggested for that fallback.
//
// There is no documented "resting HR" resource either, so the lowest HR
// seen since arriving at the current band is used as the baseline/current
// comparison reading, refined for a couple of minutes after arrival to
// avoid locking onto a single noisy instantaneous sample.
//
// Real elapsed wall-clock time (Dev/Time, epoch seconds) is used for the
// days-at-band calculation rather than workout Duration, since Duration
// resets every session and can't express multi-day gaps between separate
// workouts. main.js only executes while a SuuntoPlus sports app screen is
// active, so exposure between sessions (e.g. sleeping at altitude) is
// invisible to this model. State persists across sessions via localStorage.

var STATE_KEY = 'altiaccli_state';
var THRESHOLD = 1500;            // meters; negligible acclimatization need below this
var BAND_SIZE = 500;             // meters; re-baseline whenever altitude moves to a new band
var ARRIVAL_WINDOW_SECONDS = 120; // keep refining the arrival HR baseline for this long
var EXPECTED_HR_RECOVERY = 12;   // bpm; resting HR drop expected once well adapted
var METERS_PER_DAY = 300;        // rule of thumb: ~1 extra day needed per 300m above threshold

var state;

function evaluate(input, output) {
  var altitude = Number(input.Altitude || 0);
  var now = Number(input.Time || 0);
  var isExercising = Number(input.ExerciseState || 0) === 1;
  // HeartRate resources report Hz; convert to bpm.
  var currentHrBpm = Number(input.MinHR || 0) * 60;

  var band = Math.round(altitude / BAND_SIZE) * BAND_SIZE;

  if (isExercising) {
    if (state.lastBand === null || band !== state.lastBand) {
      state.lastBand = band;
      state.arrivalHR = currentHrBpm > 0 ? currentHrBpm : null;
      state.arrivalTime = now;
    } else if (now > 0 && state.arrivalTime > 0 && now - state.arrivalTime < ARRIVAL_WINDOW_SECONDS && currentHrBpm > 0) {
      state.arrivalHR = state.arrivalHR === null ? currentHrBpm : Math.min(state.arrivalHR, currentHrBpm);
    }
  }

  var score = 0;
  var status = 0; // 0 = not at a qualifying altitude band, 1 = Adapting, 2 = Getting there, 3 = Adapted
  var daysAtBand = 0;

  if (band > THRESHOLD && state.arrivalTime > 0) {
    daysAtBand = Math.max(0, (now - state.arrivalTime) / 86400);

    var expectedDays = Math.max(1, 1 + (band - THRESHOLD) / METERS_PER_DAY);
    var daysScore = Math.max(0, Math.min(1, daysAtBand / expectedDays)) * 100;

    var hrScore = 0;
    if (state.arrivalHR !== null && currentHrBpm > 0) {
      var hrDrop = state.arrivalHR - currentHrBpm;
      hrScore = Math.max(0, Math.min(1, hrDrop / EXPECTED_HR_RECOVERY)) * 100;
    }

    score = 0.4 * hrScore + 0.6 * daysScore;
    status = score < 33 ? 1 : (score < 70 ? 2 : 3);
  }

  output.counter = Number(output.counter || 0) + 1;
  output.acclimatization = Math.round(score);
  output.altitude = Math.round(altitude);
  output.daysAtAltitude = Math.max(0, Math.round(daysAtBand));
  output.status = status;

  try {
    localStorage.setObject(STATE_KEY, state);
  } catch (e) {
    // Ignore storage boundaries if present.
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
    lastBand: (saved && typeof saved.lastBand === 'number') ? saved.lastBand : null,
    arrivalHR: (saved && typeof saved.arrivalHR === 'number') ? saved.arrivalHR : null,
    arrivalTime: Number((saved && saved.arrivalTime) || 0)
  };

  output.counter = 0;
  output.acclimatization = 0;
  output.altitude = 0;
  output.daysAtAltitude = 0;
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
}
