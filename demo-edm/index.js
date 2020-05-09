const R       = require('ramda');
const fluid   = require('fluid-music');
const recipes = require('fluid-recipes');

const vLibrary = { 0: 10, 1: 20, 2: 30, 3: 40, 4: 50, 5: 60, 6: 70, 7: 80, 8: 90, 9: 100, a: 110, b: 120, c: 127 };
const nLibrary = {  '0': 31,                                     // 'te'
  '1': 33, '2': 35, '3': 36, '4': 38, '5': 40, '6': 41, '7': 43, // C minor
  '8': 45, '9': 47, 'a': 48, 'b': 50, 'c': 52, 'd': 53, 'e': 55, // C minor 8va
  'f': 57,                                                       // 're'
  k: { type: 'file', path: 'SP 909 From Mars/WAV/02. Kits/01. 909 Standard Kit/BD D SP 909 09.wav' },
  h: { type: 'file', path: 'SP 909 From Mars/WAV/02. Kits/01. 909 Standard Kit/CH A SP 909 09.wav' },
  H: { type: 'file', path: 'SP 909 From Mars/WAV/02. Kits/01. 909 Standard Kit/OH A SP 909 09.wav' },
  s: { type: 'file', path: recipes.fromMars909.s3.path },
  c: { type: 'file', path: recipes.fromMars909.kit.crash.path },
};

let melody;
const score = [];
const config = {
  vLibrary,
  nLibrary,
  v:     '966855844655',
  r:     '1..2..3..4..'};
melody = '875a8'        ;
// melody = '875a864'      ;
// melody = '15426536876'  ;
// melody = '1342453-21'   ; // default;
// melody = R.reverse(melody);


melody = recipes.mutators.wiggle(melody, 8);
const intro = {
  name: 'intro',
  crash: {crash: 'c.', v: '6'},
  kick: [R.repeat('k..k..k..k..', 7), 'k........sss'],
  hat:   R.repeat('.hh.hh.hh.hh', 7),
  p: {
    r:              '1 2 3 4 ',
    v:              '89898989',
    // hat:   R.repeat(' h h h h', 6),
    // snare: R.repeat('  s   s ', 7),
  },
  mallet: melody,
  bass:  R.clone(melody),
};

// Transpose intro.mallet
if (intro.mallet) intro.mallet.nLibrary = recipes.library.transposeNoteLibrary(nLibrary, 36);
score.push(intro);

// Section A is a variation on the intro
const sectionA = R.clone(intro);
delete sectionA.kick;
delete sectionA.hat;
score.push(sectionA);

const session = fluid.score.parse(score, config);

/**
 * Insert two automation points that span of a given region. One point will be
 * inserted at the beginning, and one point at the end.
 *
 * Make sure that the desired track and plugin are both selected before pusing
 * this message onto the call stack.
 *
 * @param {Object} region Any object with a startTime and duration.
 *    {@link Session}, {@link Clip}, are appropriate. Also the `.regions[]`
 *    array that comes with `Session`s created from an array can use be used.
 * @param {number} region.startTime
 * @param {number} region.duration
 * @param {string} paramName The plugin parameter name to
 * @param {number} startValue Automation value to insert at `.startTime`
 * @param {number} endValue Automation vlaue to insert at `.startTime+.duration`
 * @param {number} [curve1] Automation curve for the span [-1,1]. Negative
 *    values begin fast, Positive values begin slow. defaults to 0 (linear)
 * @param {number} [curve2] Automation curve following the  region.
 */
function rampOverRegion(region, paramName, startValue, endValue, curve1, curve2) {
  if (typeof region.startTime !== 'number' || typeof region.duration !== 'number')
    throw new Error('rampOverRegion needs an object with a .startTime and .duration  number, got: '+ JSON.serialize(region));

  if (typeof paramName !== 'string')
    throw new Error('rampOverRegion requires a paramName string, got: ' + JSON.serialize(paramName));

  const startTime = region.startTime;
  const endTime = region.startTime + region.duration;
  return [
    fluid.plugin.setParamExplicitAt(paramName, startValue, startTime, curve1),
    fluid.plugin.setParamExplicitAt(paramName, endValue, endTime, curve2),
  ];
};

/**
 * Get the end time of clips, sessions, and regions
 * @param {Object} region Any object with a startTime and duration.
 *    {@link Session}, {@link Clip}, are appropriate. Also the `.regions[]`
 *    array that comes with `Session`s created from an array can use be used.
 * @param {number} region.startTime
 * @param {number} region.duration
 * @returns {number} The time that the region ends.
 */
function endTime(region) { return region.startTime + region.duration; }
function startTime(region) { return region.startTime; }

function linearAutomationSegments(region, paramName, values) {
  if (typeof region.startTime !== 'number' || typeof region.duration !== 'number')
    throw new Error('linearAutomationSegments needs an object with a .startTime and .duration  number, got: '+ JSON.serialize(region));

  if (typeof paramName !== 'string')
    throw new Error('linearAutomationSegments requires a paramName string, got: ' + JSON.serialize(paramName));

  const startTime = region.startTime;
  const duration = region.duration;
  const steps = values.length;
  const times = R.range(1, steps + 1).map(v => startTime + v / steps * duration);
  return R.zip(values, times).map(tuple => {
    const [value, time] = tuple;
    return fluid.plugin.setParamExplicitAt(paramName, value, time);
  });
}


const malletAutomation = [
  // fluid.audiotrack.select('mallet'),
  fluid.pluginZebra2Vst2.select(),
  fluid.pluginZebra2Vst2.setVCF1Cutoff   (0.01, 0),
  fluid.pluginZebra2Vst2.setVCF1Resonance(0.01, 0),
  linearAutomationSegments(session, 'VCF1: Cutoff',    [0.1,  0.2]),
  linearAutomationSegments(session, 'VCF1: Resonance', [0.01, 0.2]),
];

const msg = [
  // cleanup
  fluid.audiotrack.select('kick'),
  fluid.audiotrack.removeClips(),
  fluid.audiotrack.select('bass'),
  fluid.audiotrack.removeClips(),
  fluid.audiotrack.select('melody'),
  fluid.audiotrack.removeClips(),
  fluid.audiotrack.select('hat'),
  fluid.audiotrack.removeClips(),
  fluid.audiotrack.select('snare'),
  fluid.audiotrack.removeClips(),
  fluid.audiotrack.select('crash'),
  fluid.audiotrack.removeClips(),
  fluid.audiotrack.select('mallet'),
  fluid.audiotrack.removeClips(),
  // automation
  fluid.audiotrack.removeAutomation(),
  malletAutomation,
  fluid.score.tracksToFluidMessage(session.tracks),
  fluid.transport.loop(0, session.duration),
];

const client = new fluid.Client(9999);
client.send(msg);
