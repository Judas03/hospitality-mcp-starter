import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../booking/useBookingAgent';

export const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Reads each new assistant reply aloud while enabled; returns whether it is speaking. */
export function useSpeech(messages: ChatMessage[], enabled: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);
  // Start after the greeting, so nothing is read out on page load.
  const spokenId = useRef(messages[messages.length - 1]?.id ?? -1);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.id <= spokenId.current) return;
    spokenId.current = last.id;
    if (!enabled || !speechAvailable) return;
    const utterance = new SpeechSynthesisUtterance(last.text);
    utterance.lang = 'en-US';
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [messages, enabled]);

  useEffect(() => {
    if (enabled || !speechAvailable) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [enabled]);

  return speaking;
}
