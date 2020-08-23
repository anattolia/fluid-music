import { FluidPlugin, PluginType } from './plugin';
import { FluidTrack } from './FluidTrack';
import { ClipEventContext } from './ts-types';

const cybr = require('./fluid/index');
const tab  = require('./tab');

/**
 * Create a `FluidMessage` from a `TracksObject`
 *
 * ```javascript
 * const session = fluid.score.parse(myScore, myConfig);
 * const message = fluid.score.tracksToFluidMessage(session.tracks);
 * const client = new cybr.Client();
 * client.send(message);
 * ```
 *
 * @param {TracksObject} tracksObject A tracks object generated by score.parse
 * @returns {FluidMessage}
 */
export function tracksToFluidMessage(tracks : FluidTrack[]) {
  const sessionMessages : any[] = [];
  let i = 0;

  // // example tracks object
  // const tracks = {
  //   bass: { clips: [ clip1, clip2... ] },
  //   kick: { clips: [ clip1, clip2... ] },
  // };
  for (const track of tracks) {
    if (tab.reservedKeys.hasOwnProperty(track.name)) {
      continue;
    }

    // Charles: This was buggy, and probably undesirable. After the typescript
    // refactor remove it altogether.
    // if (!track.clips || !track.clips.length) {
    //   if (!tracksObject.plugins.length) {
    //     console.log(`tracksToFluidMessage: skipping ${trackName}, because it has no .clips and no .plugins`);
    //     continue;
    //   }
    // }

    // Create a sub-message for each track
    let trackMessages : any[] = [];
    trackMessages.push(cybr.audiotrack.select(track.name));
    sessionMessages.push(trackMessages);

    track.clips.forEach((clip, clipIndex) => {

      // Create a sub-message for each clip. Note that the naming convention
      // gets a little confusing, because we do not yet know if "clip" contains
      // a single "Midi Clip", a collection of audio file events, or both.
      const clipMessages : any[] = [];
      trackMessages.push(clipMessages);

      // Create one EventContext object for each clip.
      const context : ClipEventContext = {
        track,
        clip,
        clipIndex,
        messages: clipMessages,
        data: {},
      };

      if (clip.midiEvents && clip.midiEvents.length) {
        clipMessages.push(midiEventsToFluidMessage(clip.midiEvents, context));
      }

      if (clip.fileEvents && clip.fileEvents.length) {
        clipMessages.push(fileEventsToFluidMessage(clip.fileEvents, context));
      }

    }); // track.clips.forEach

    // Handle track specific automation.
    for (const [name, automation] of Object.entries(track.automation)) {
      let trackAutoMsg : any[] = [];
      trackMessages.push(trackAutoMsg);
      if (name === 'gain' || name === 'pan') {
        // cybr.audiotrack.gain should always adjust the last volume plugin on
        // the track. That means that we want to apply automation on an earlier
        // volume plugin. First, ensure that we have at least two volume plugins
        trackAutoMsg.push(cybr.plugin.select('volume', 'tracktion', 1));
        // ...then select the first volume plugin which will be automated
        trackAutoMsg.push(cybr.plugin.select('volume', 'tracktion', 0));

        // Iterate over the automation points. If we are just dealing with
        // volume and pan, then the autoPoint should usable unedited. When
        // dealing with sends, this might need to be more complicated.
        for (const autoPoint of automation.points) {
          // Charles: ADD THIS. 
        }

      } else {
        throw new Error(`Fluid Track Automation found unsupported parameter: "${name}"`);
      }
    } // for [name, automation] of track.automation

    // Handle plugins/plugin automation
    const count : any = {};
    const nth = (plugin : FluidPlugin) => {
      const str = plugin.pluginName + '|' + plugin.pluginType;
      if (!count.hasOwnProperty(str)) count[str] = 0;
      return count[str]++;
    }
    for (const plugin of track.plugins) {
      const cybrType = (plugin.pluginType === PluginType.unknown) ? undefined : plugin.pluginType;
      const pluginName = plugin.pluginName;
      trackMessages.push(cybr.plugin.select(pluginName, cybrType, nth(plugin)));

      // Automation
      for (const [paramKey, automation] of Object.entries(plugin.automation)) {
        const paramName = plugin.getParameterName(paramKey); // JUCE style name
        // iterate over points. Ex { startTime: 0, value: 0.5, curve: 0 }
        for (const autoPoint of automation.points) {
          if (typeof autoPoint.value === 'number') {
            // - paramName is the JUCE style parameter name we need
            // - value is an explicit value. look for a normalizer
            const explicitValue   = autoPoint.value;
            const normalizedValue = plugin.getNormalizedValue(paramKey, explicitValue);

            if (typeof normalizedValue === 'number') {
              trackMessages.push(cybr.plugin.setParamNormalizedAt(
                paramName,
                Math.max(Math.min(normalizedValue, 1), 0),
                autoPoint.startTime,
                autoPoint.curve));
            } else {
              trackMessages.push(cybr.plugin.setParamExplicitAt(
                paramName,
                explicitValue,
                autoPoint.startTime,
                autoPoint.curve));
            }
          }
        } // for (autoPoint of automation.points)
      }   // for (paramName, automation of plugin.automation)
    }     // for (plugin of track.plugins)
  }       // for (track of tracks)

  return sessionMessages;
};


/**
 * @param {ClipEvent[]} midiEvents
 * @param {ClipEventContext} context This will not have a .eventIndex
 */
function midiEventsToFluidMessage(midiEvents, context) {
  if (typeof context.clip.startTime !== 'number')
    throw new Error('Clip is missing startTime');

  const msg : any[] = [];
  const clipName  = `${context.track.name} ${context.clipIndex}`
  const startTime = context.clip.startTime;
  const duration  = context.clip.duration;
  const clipMsg   = cybr.midiclip.select(clipName, startTime, duration)
  msg.push(clipMsg);

  for (const event of midiEvents) {
    if (event.type === 'midiNote') {
      let velocity = (event.d && typeof event.d.v === 'number')
        ? event.d.v
        : (typeof event.v === 'number')
          ? event.v
          : undefined;
      msg.push(cybr.midiclip.note(event.n, event.startTime, event.duration, velocity));
    }
  }

  return msg;
};

/**
 * @param {ClipEvent[]} fileEvents
 * @param {ClipEventContext} context This will not have a .eventIndex
 */
function fileEventsToFluidMessage(fileEvents, context) {
  if (typeof context.clip.startTime !== 'number')
    throw new Error('Clip is missing startTime');

  // exampleClipEvent = {
  //   type: 'file',
  //   path: 'media/kick.wav',
  //   startTime: 0.50,
  //   length: 0.25,
  //   d: { v: 70, dbfs: -10 }, // If .v is present here...
  // };

  return fileEvents.map((event, eventIndex) => {
    const startTime = context.clip.startTime + event.startTime;

    if (typeof event.path !== 'string') {
      console.error(event);
      throw new Error('tracksToFluidMessage: A file event found in the note library does not have a .path string');
    };

    const clipName = `s${context.clipIndex}.${eventIndex}`;
    const msg = [cybr.audiotrack.insertWav(clipName, startTime, event.path)];

    if (event.startInSourceSeconds)
      msg.push(cybr.clip.setSourceOffsetSeconds(event.startInSourceSeconds));

    // adjust the clip length, unless the event is a .oneShot
    if (!event.oneShot)
      msg.push(cybr.clip.length(event.duration));

    // apply fade in/out times (if specified)
    if (typeof event.fadeOutSeconds === 'number' || typeof event.fadeInSeconds === 'number')
      msg.push(cybr.audioclip.fadeInOutSeconds(event.fadeInSeconds, event.fadeOutSeconds));

    // If there is a dynamics object, look for a dbfs property and apply gain.
    if (event.d && typeof(event.d.dbfs) === 'number')
      msg.push(cybr.audioclip.gain(event.d.dbfs));

    return msg;
  });
}

