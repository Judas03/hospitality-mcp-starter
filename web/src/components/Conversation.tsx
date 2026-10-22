import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Task } from '../booking/flow';
import type { ChatMessage } from '../booking/useBookingAgent';
import { useVoiceInput, type VoiceInput, type VoiceState } from '../hooks/useVoiceInput';
import type { PlanTask } from '../itinerary/useOccasionConcierge';
import { IconMic, IconSend } from './icons';

export type RingState = 'idle' | 'thinking' | 'speaking';
/** The step running in either the single-booking flow or a plan. */
export type BusyTask = Task | PlanTask;

const BUSY_LABELS: Record<BusyTask, string> = {
  search: 'Searching',
  hold: 'Placing a hold',
  confirm: 'Confirming',
  modify: 'Changing the booking',
  cancel: 'Cancelling',
  details: 'Looking it up',
  plan_search: 'Searching every part of the plan',
  plan_hold: 'Holding the plan',
  plan_confirm: 'Confirming the plan',
  plan_release: 'Releasing the plan',
  plan_check: 'Checking the holds',
};
const RING_LABELS: Record<RingState, string> = { idle: 'Ready', thinking: 'Working on it', speaking: 'Replying' };

interface ConversationPanelProps {
  messages: ChatMessage[];
  busy: BusyTask | null;
  speaking: boolean;
  suggestions: string[];
  onSend(text: string): void;
  /** What a suggestion chip does; sends its text when not given. */
  onPick?(text: string): void;
  disabled: boolean;
  /** Holds the chips back without blocking typing. */
  chipsDisabled?: boolean;
  /** Push-to-talk started or finished, so read-aloud can pause while listening. */
  onListeningChange?(listening: boolean): void;
}

export function ConversationPanel({
  messages,
  busy,
  speaking,
  suggestions,
  onSend,
  onPick,
  disabled,
  chipsDisabled = false,
  onListeningChange,
}: ConversationPanelProps) {
  const replied = useRecentReply(messages);
  const ring: RingState = busy ? 'thinking' : speaking || replied ? 'speaking' : 'idle';
  return (
    <section className="panel conversation" aria-labelledby="conversation-title">
      <div className="panel-head">
        <AssistantRing state={ring} />
        <div>
          <h2 id="conversation-title">Conversation</h2>
          <p className="panel-sub">{RING_LABELS[ring]}</p>
        </div>
      </div>
      <MessageList messages={messages} busy={busy} />
      <div className="composer-area">
        <SuggestionChips
          suggestions={suggestions}
          onPick={onPick ?? onSend}
          disabled={disabled || chipsDisabled || busy !== null}
        />
        <Composer onSend={onSend} disabled={disabled} busy={busy !== null} onListeningChange={onListeningChange} />
      </div>
    </section>
  );
}

/** True for a moment after each new assistant reply, so the ring reacts even when not reading aloud. */
function useRecentReply(messages: ChatMessage[]): boolean {
  const [recent, setRecent] = useState(false);
  const last = messages[messages.length - 1];
  const firstId = useRef(last?.id);
  useEffect(() => {
    if (!last || last.role !== 'assistant' || last.id === firstId.current) return;
    setRecent(true);
    const timer = window.setTimeout(() => setRecent(false), 1400);
    return () => window.clearTimeout(timer);
  }, [last]);
  return recent;
}

export function AssistantRing({ state }: { state: RingState }) {
  return <span className="ring" data-state={state} aria-hidden="true" />;
}

export function MessageList({ messages, busy }: { messages: ChatMessage[]; busy: BusyTask | null }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy]);
  return (
    <div className="messages" ref={listRef} role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {busy && (
        <div className="bubble assistant typing">
          <span className="sr-only">{BUSY_LABELS[busy]}</span>
          <span aria-hidden="true">
            {BUSY_LABELS[busy]}
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`bubble ${message.role}`}>
      <span className="sr-only">{message.role === 'user' ? 'You: ' : 'Assistant: '}</span>
      {message.text}
    </div>
  );
}

export function SuggestionChips({
  suggestions,
  onPick,
  disabled,
}: {
  suggestions: string[];
  onPick(text: string): void;
  disabled: boolean;
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul className="chips" aria-label="Suggestions">
      {suggestions.map((suggestion) => (
        <li key={suggestion}>
          <button type="button" className="chip" disabled={disabled} onClick={() => onPick(suggestion)}>
            {suggestion}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Composer({
  onSend,
  disabled,
  busy,
  onListeningChange,
}: {
  onSend(text: string): void;
  disabled: boolean;
  busy: boolean;
  onListeningChange?(listening: boolean): void;
}) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // What was said goes into the box for the guest to read, change and send; it is never sent by itself.
  const voice = useVoiceInput((transcript) => {
    setText((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript));
    inputRef.current?.focus();
  });
  const listening = voice.state === 'listening' || voice.state === 'processing';
  useEffect(() => onListeningChange?.(listening), [listening, onListeningChange]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled || busy) return;
    onSend(trimmed);
    setText('');
  };
  return (
    <>
      <form className="composer" onSubmit={submit}>
        <label htmlFor="composer-input" className="sr-only">
          Your request
        </label>
        <input
          id="composer-input"
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ask for a table, an appointment or a room…"
          autoComplete="off"
          disabled={disabled}
        />
        <MicButton voice={voice} disabled={disabled} />
        <button type="submit" className="btn primary icon-only" disabled={disabled || busy || !text.trim()} aria-label="Send">
          <IconSend />
        </button>
      </form>
      <VoiceStatus voice={voice} />
    </>
  );
}

const isTalkKey = (key: string) => key === ' ' || key === 'Enter';

/** Hold to talk, with the pointer or with Space or Enter; Escape throws away what was heard. */
function MicButton({ voice, disabled }: { voice: VoiceInput; disabled: boolean }) {
  const unsupported = voice.state === 'unsupported';
  return (
    <button
      type="button"
      className="btn secondary icon-only mic"
      data-state={voice.state}
      aria-label="Hold to talk"
      aria-pressed={voice.state === 'listening'}
      aria-describedby="voice-status"
      title={unsupported ? VOICE_TEXT.unsupported : 'Hold to talk, let go to stop'}
      disabled={disabled || unsupported}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        voice.press();
      }}
      onPointerUp={voice.release}
      onPointerCancel={voice.release}
      onLostPointerCapture={voice.release}
      onKeyDown={(event) => {
        if (isTalkKey(event.key)) {
          event.preventDefault();
          if (!event.repeat) voice.press();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          voice.cancel();
        }
      }}
      onKeyUp={(event) => {
        if (!isTalkKey(event.key)) return;
        event.preventDefault();
        voice.release();
      }}
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      onBlur={voice.release}
    >
      <IconMic />
    </button>
  );
}

const VOICE_TEXT: Record<VoiceState, string> = {
  unsupported: 'Voice input isn’t available in this browser. Type your request instead.',
  idle: '',
  listening: 'Listening… let go to stop.',
  processing: 'Finishing…',
  denied: 'The microphone is blocked. Allow it in the browser’s site settings, or type instead.',
  'no-speech': 'I didn’t hear anything. Hold the button while you speak, or type instead.',
  error: 'Voice input stopped working. You can type instead.',
};

function voiceText(voice: VoiceInput): string {
  if (voice.state === 'no-speech' && voice.detail === 'not-started') {
    return 'If the browser asked for the microphone, allow it, then hold the button again.';
  }
  if (voice.state === 'error' && voice.detail === 'network') {
    return 'The browser’s speech service couldn’t be reached. You can type instead.';
  }
  return VOICE_TEXT[voice.state];
}

function VoiceStatus({ voice }: { voice: VoiceInput }) {
  const text = voiceText(voice);
  return (
    <p id="voice-status" className="voice-status" data-state={voice.state} role="status" aria-live="polite">
      {text}
      {voice.state === 'listening' && voice.interim && <span className="interim"> “{voice.interim}”</span>}
    </p>
  );
}
