import { FluidPlugin, PluginType } from './plugin';
import { FluidTrack } from './FluidTrack';
import { ClipEventContext } from './ts-types';
import { FluidSession } from './FluidSession';

import * as cybr from './cybr/index';

const tab  = require('./tab');

// This amplification conversion is hard-coded in Tracktion
const normalizeTracktionGain = (db) => {
  const normalized = Math.exp((db-6) * (1/20));
  return Math.max(Math.min(normalized, 1), 0);
}

/**
 * Create a fluid message that constructs the template of the project without
 * any content. This includes Tracks (with pan and gain) plugins (with state)
 * but no clips or automation.
 * @param session
 */
export function sessionToTemplateFluidMessage(session : FluidSession) {
  const sessionMessages : any[] = [
    cybr.tempo.set(session.bpm),
  ];

  for (const track of session.tracks) {
    if (tab.reservedKeys.hasOwnProperty(track.name)) {
      continue;
    }

    // Create a sub-message for each track
    let trackMessages : any[] = [
      cybr.audiotrack.select(track.name),
      cybr.audiotrack.gain(track.gain), // normalization not needed with .gain
      cybr.audiotrack.pan(track.pan),
    ];
    sessionMessages.push(trackMessages);

    // Handle plugins. This deals with plugin state (not automation)
    const count : any = {};
    const nth = (plugin : FluidPlugin) => {
      const str = plugin.pluginName + '|' + plugin.pluginType;
      if (!count.hasOwnProperty(str)) count[str] = 0;
      return count[str]++;
    }
    const pluginMessages : any[] = [];
    trackMessages.push(pluginMessages)
    for (const plugin of track.plugins) {
      const cybrType = plugin.pluginType === PluginType.unknown ? null : plugin.pluginType;
      pluginMessages.push(cybr.plugin.select(plugin.pluginName, cybrType, nth(plugin)));

      for (const [paramKey, explicitValue] of Object.entries(plugin.parameters)) {
        const paramName = plugin.getParameterName(paramKey);
        if (typeof explicitValue === 'number') {
          const normalizedValue = plugin.getNormalizedValue(paramKey, explicitValue);
          if (typeof normalizedValue === 'number') {
            pluginMessages.push(cybr.plugin.setParamNormalized(paramName, normalizedValue));
          } else {
            pluginMessages.push(cybr.plugin.setParamExplicit(paramName, explicitValue));
          }
        } else {
          console.warn(`found non-number parameter value in ${plugin.pluginName} - ${paramKey}: ${explicitValue}`);
        }
      }
    }
  }

  return sessionMessages;
}

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

  for (const track of tracks) {
    if (tab.reservedKeys.hasOwnProperty(track.name)) {
      continue;
    }

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

      for (const autoPoint of automation.points) {
        if (typeof autoPoint.value === 'number') {
          let msg : any = null;
          if      (name === 'pan')   msg = cybr.audiotrack.pan(autoPoint.value, autoPoint.startTime, autoPoint.curve);
          else if (name === 'gain')  msg = cybr.audiotrack.gain(autoPoint.value, autoPoint.startTime, autoPoint.curve);
          else if (name === 'width') msg = cybr.audiotrack.width(autoPoint.value, autoPoint.startTime, autoPoint.curve);
          else throw new Error(`Fluid Track Automation found unsupported parameter: "${name}"`);
          trackAutoMsg.push(msg);
        }
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

      // Plugin Parameters
      for (const [paramKey, explicitValue] of Object.entries(plugin.parameters)) {
        if (typeof explicitValue === 'number') {
          const paramName = plugin.getParameterName(paramKey)
          const normalizedValue = plugin.getNormalizedValue(paramKey, explicitValue)
          if (typeof normalizedValue === 'number') {
            trackMessages.push(cybr.plugin.setParamNormalized(paramName, normalizedValue))
          } else {
            trackMessages.push(cybr.plugin.setParamExplicit(paramName, explicitValue))
          }
        }
      }

      // Plugin Parameter Automation
      for (const [paramKey, automation] of Object.entries(plugin.automation)) {
        const paramName = plugin.getParameterName(paramKey); // JUCE style name
        // iterate over points. Ex { startTime: 0, value: 0.5, curve: 0 }
        for (const autoPoint of automation.points) {
          if (typeof autoPoint.value === 'number') {
            // - paramName is the JUCE style parameter name we need
            // - value is an explicit value. look for a normalizer
            // Notice how paramKey and paramName are used in the code below, and
            // be careful not to mix them up. They may (or may not) be identical
            // so mixing them up could lead to hard-to-find bugs.
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

