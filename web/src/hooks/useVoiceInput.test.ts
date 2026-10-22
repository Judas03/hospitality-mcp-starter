import { describe, expect, it } from 'vitest';
import { findRecognition, PushToTalk, type RecognitionLike, type VoiceState } from './useVoiceInput';

/** A stand-in for the browser's SpeechRecognition that the test drives by hand. */
class FakeRecognition implements RecognitionLike {
  static made: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: RecognitionLike['onstart'] = null;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  readonly calls: string[] = [];

  constructor() {
    FakeRecognition.made.push(this);
  }
  start() {
    this.calls.push('start');
  }
  stop() {
    this.calls.push('stop');
  }
  abort() {
    this.calls.push('abort');
  }

  began() {
    this.onstart?.();
  }
  hear(transcript: string, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript }], { isFinal })] });
  }
  fail(error: string) {
    this.onerror?.({ error });
  }
  end() {
    this.onend?.();
  }
}

function setup(Recognition: typeof FakeRecognition | null = FakeRecognition) {
  FakeRecognition.made = [];
  const states: Array<[VoiceState, string | null]> = [];
  const transcripts: string[] = [];
  const interims: string[] = [];
  const timers: Array<{ run: () => void; cleared: boolean }> = [];
  let speechStops = 0;
  const voice = new PushToTalk({
    Recognition,
    onState: (state, detail) => states.push([state, detail]),
    onInterim: (text) => interims.push(text),
    onTranscript: (text) => transcripts.push(text),
    stopSpeech: () => (speechStops += 1),
    setTimer: (run) => timers.push({ run, cleared: false }) - 1,
    clearTimer: (index) => {
      timers[index as number].cleared = true;
    },
  });
  const recognition = () => FakeRecognition.made[FakeRecognition.made.length - 1];
  return { voice, states, transcripts, interims, timers, recognition, speechStops: () => speechStops };
}

describe('PushToTalk', () => {
  it('is unsupported, and does nothing, when the browser has no speech recognition', () => {
    const { voice, states } = setup(null);
    expect(voice.state).toBe('unsupported');
    voice.press();
    voice.release();
    expect(states).toEqual([]);
    expect(findRecognition({})).toBeNull();
    expect(findRecognition({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
  });

  it('listens while pressed, stops reading aloud, and never starts twice', () => {
    const { voice, recognition, speechStops } = setup();
    voice.press();
    voice.press(); // the same press arriving as a pointer and a key
    expect(FakeRecognition.made).toHaveLength(1);
    expect(voice.state).toBe('listening');
    expect(speechStops()).toBe(1);
    expect(recognition()).toMatchObject({ lang: 'en-US', continuous: true, interimResults: true, maxAlternatives: 1 });
    expect(recognition().calls).toEqual(['start']);
  });

  it('puts the final text into the message box after letting go, and nothing else', () => {
    const { voice, states, transcripts, interims, recognition } = setup();
    voice.press();
    recognition().began();
    recognition().hear('plan my anniversary', false);
    expect(interims.at(-1)).toBe('plan my anniversary');
    recognition().hear('Plan my anniversary tomorrow');
    voice.release();
    voice.release();
    expect(voice.state).toBe('processing');
    expect(recognition().calls).toEqual(['start', 'stop']);
    recognition().end();
    expect(transcripts).toEqual(['Plan my anniversary tomorrow']);
    expect(states.map(([state]) => state)).toEqual(['listening', 'processing', 'idle']);
    expect(interims.at(-1)).toBe('');
  });

  it('says when it heard nothing, and when listening never started', () => {
    const heard = setup();
    heard.voice.press();
    heard.recognition().began();
    heard.voice.release();
    heard.recognition().end();
    expect(heard.states.at(-1)).toEqual(['no-speech', null]);

    // Let go before the browser started listening, e.g. while it asked for the microphone.
    const early = setup();
    early.voice.press();
    early.voice.release();
    early.recognition().end();
    expect(early.states.at(-1)).toEqual(['no-speech', 'not-started']);
    expect(early.transcripts).toEqual([]);
  });

  it('reports a blocked microphone and other errors, and tries again on the next press', () => {
    const { voice, states, recognition } = setup();
    voice.press();
    recognition().fail('not-allowed');
    recognition().end();
    expect(states.at(-1)).toEqual(['denied', 'not-allowed']);

    voice.press();
    expect(voice.state).toBe('listening');
    recognition().fail('network');
    recognition().end();
    expect(states.at(-1)).toEqual(['error', 'network']);
  });

  it('throws away what it heard on Escape', () => {
    const { voice, transcripts, recognition } = setup();
    voice.press();
    const listening = recognition();
    listening.hear('cancel my booking');
    voice.cancel();
    expect(voice.state).toBe('idle');
    expect(listening.calls).toEqual(['start', 'abort']);
    listening.end(); // a late event from the browser changes nothing
    expect(transcripts).toEqual([]);
  });

  it('gives up if the browser never finishes, and clears the timer when it does', () => {
    const stuck = setup();
    stuck.voice.press();
    stuck.voice.release();
    stuck.timers[0].run();
    expect(stuck.states.at(-1)).toEqual(['error', 'timeout']);
    expect(stuck.recognition().calls).toEqual(['start', 'stop', 'abort']);

    const fine = setup();
    fine.voice.press();
    fine.recognition().hear('hello');
    fine.voice.release();
    fine.recognition().end();
    expect(fine.timers[0].cleared).toBe(true);
  });

  it('stops listening and drops its handlers when disposed', () => {
    const { voice, recognition } = setup();
    voice.press();
    voice.dispose();
    expect(recognition().calls).toEqual(['start', 'abort']);
    expect(recognition().onresult).toBeNull();
    expect(recognition().onend).toBeNull();
  });
});
