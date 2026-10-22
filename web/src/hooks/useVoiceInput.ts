import { useEffect, useRef, useState } from 'react';

// Push-to-talk: hold the button to listen, let go to stop. The browser's own speech recognition
// turns speech into text; the page never records, stores or uploads audio itself. The final text
// only fills the message box, so sending it, and any booking step, stays the guest's own action.

export type VoiceState = 'unsupported' | 'idle' | 'listening' | 'processing' | 'denied' | 'no-speech' | 'error';

/** The part of the Web Speech API's SpeechRecognition the page uses. */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

export type RecognitionConstructor = new () => RecognitionLike;

/** SpeechRecognition, or Chrome's and Safari's prefixed one, or null when the browser has neither. */
export function findRecognition(scope: object = globalThis): RecognitionConstructor | null {
  const browser = scope as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

/** How long to wait for the browser to finish after the button is let go. */
export const FINISH_TIMEOUT_MS = 5000;

const ERROR_STATES: Record<string, VoiceState> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'no-speech': 'no-speech',
};

export interface PushToTalkOptions {
  Recognition: RecognitionConstructor | null;
  /** Every state change, with the browser's error code or "not-started" where it explains the state. */
  onState(state: VoiceState, detail: string | null): void;
  /** Words heard so far, for the status line; empty when listening ends. */
  onInterim(text: string): void;
  /** The final text, once per press. */
  onTranscript(text: string): void;
  /** Stops reading replies aloud, so the page never transcribes itself. */
  stopSpeech(): void;
  lang?: string;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

/**
 * One recognition per press. Pressing again while listening or finishing does nothing, and letting
 * go twice is harmless, so pointer, key and click events can all fire without starting twice.
 */
export class PushToTalk {
  private recognition: RecognitionLike | null = null;
  private status: VoiceState;
  private finalText = '';
  private interimText = '';
  private started = false;
  private failed = false;
  private timer: unknown = null;

  constructor(private readonly options: PushToTalkOptions) {
    this.status = options.Recognition ? 'idle' : 'unsupported';
  }

  get state(): VoiceState {
    return this.status;
  }

  press() {
    const { Recognition } = this.options;
    if (!Recognition || this.recognition) return;
    this.options.stopSpeech();
    const recognition = new Recognition();
    recognition.lang = this.options.lang ?? 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      this.started = true;
    };
    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) this.finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      this.interimText = interim;
      this.options.onInterim(`${this.finalText}${interim}`.trim());
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      this.failed = true;
      this.set(ERROR_STATES[event.error] ?? 'error', event.error);
    };
    recognition.onend = () => this.finish();
    this.recognition = recognition;
    this.finalText = '';
    this.interimText = '';
    this.started = false;
    this.failed = false;
    this.set('listening');
    try {
      recognition.start();
    } catch (error) {
      this.detach();
      this.set('error', error instanceof Error ? error.message : 'start-failed');
    }
  }

  release() {
    if (!this.recognition || this.status !== 'listening') return;
    this.set('processing');
    this.recognition.stop();
    const setTimer = this.options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
    this.timer = setTimer(() => {
      const recognition = this.recognition;
      if (!recognition) return;
      this.detach();
      recognition.abort();
      this.set('error', 'timeout');
    }, FINISH_TIMEOUT_MS);
  }

  /** Escape: stop and throw away what was heard. */
  cancel() {
    const recognition = this.recognition;
    if (!recognition) return;
    this.detach();
    recognition.abort();
    this.set('idle');
  }

  dispose() {
    const recognition = this.recognition;
    this.detach();
    recognition?.abort();
  }

  private finish() {
    const text = (this.finalText || this.interimText).trim();
    const { failed, started } = this;
    this.detach();
    if (failed) return;
    if (text) {
      this.options.onTranscript(text);
      this.set('idle');
    } else {
      this.set('no-speech', started ? null : 'not-started');
    }
  }

  /** Drops the recognition, its handlers and the finish timer together. */
  private detach() {
    if (this.timer !== null) (this.options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as number)))(this.timer);
    this.timer = null;
    if (this.recognition) {
      this.recognition.onstart = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
    }
    this.recognition = null;
    this.options.onInterim('');
  }

  private set(state: VoiceState, detail: string | null = null) {
    this.status = state;
    this.options.onState(state, detail);
  }
}

const stopSpeech = () => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
};

export interface VoiceInput {
  state: VoiceState;
  detail: string | null;
  /** Words heard so far while listening. */
  interim: string;
  press(): void;
  release(): void;
  cancel(): void;
}

/** Push-to-talk for the message box; `onTranscript` receives the final text of each press. */
export function useVoiceInput(onTranscript: (text: string) => void): VoiceInput {
  const deliver = useRef(onTranscript);
  deliver.current = onTranscript;
  const [state, setState] = useState<VoiceState>(() => (findRecognition() ? 'idle' : 'unsupported'));
  const [detail, setDetail] = useState<string | null>(null);
  const [interim, setInterim] = useState('');
  const [controller] = useState(
    () =>
      new PushToTalk({
        Recognition: findRecognition(),
        onState: (next, why) => {
          setState(next);
          setDetail(why);
        },
        onInterim: setInterim,
        onTranscript: (text) => deliver.current(text),
        stopSpeech,
      }),
  );

  useEffect(() => {
    // Leaving the window or the tab counts as letting go of the button.
    const letGo = () => controller.release();
    const onVisibility = () => {
      if (document.hidden) letGo();
    };
    window.addEventListener('blur', letGo);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', letGo);
      document.removeEventListener('visibilitychange', onVisibility);
      controller.dispose();
    };
  }, [controller]);

  return {
    state,
    detail,
    interim,
    press: () => controller.press(),
    release: () => controller.release(),
    cancel: () => controller.cancel(),
  };
}
