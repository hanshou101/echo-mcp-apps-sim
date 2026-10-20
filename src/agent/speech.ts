/**
 * Speech output for agent replies: browser `speechSynthesis`,
 * preferring an en-US voice, with an on/off switch in the page.
 */

export interface SpeechLike {
  speak(utterance: unknown): void;
  cancel(): void;
  getVoices(): Array<{ lang?: string; name?: string }>;
}

export interface SpeechSynthesisTarget {
  speechSynthesis?: SpeechLike;
  SpeechSynthesisUtterance?: new (text: string) => { lang: string; voice: unknown; rate: number };
}

export interface Speaker {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  speak(text: string): void;
  stop(): void;
}

export function pickEnglishVoice(voices: Array<{ lang?: string; name?: string }>): unknown {
  return voices.find((voice) => (voice.lang ?? "").toLowerCase().startsWith("en-us")) ??
    voices.find((voice) => (voice.lang ?? "").toLowerCase().startsWith("en")) ??
    undefined;
}

export function createSpeaker(target: SpeechSynthesisTarget = window as SpeechSynthesisTarget): Speaker {
  let enabled = true;
  const synth = target.speechSynthesis;
  const Utterance = target.SpeechSynthesisUtterance;

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(next: boolean) {
      enabled = next;
      if (!enabled) synth?.cancel();
    },
    speak(text: string) {
      const value = text.trim();
      if (!enabled || !value || !synth || !Utterance) return;
      synth.cancel();
      const utterance = new Utterance(value);
      utterance.lang = "en-US";
      utterance.rate = 0.98;
      const voice = pickEnglishVoice(synth.getVoices());
      if (voice) utterance.voice = voice;
      synth.speak(utterance);
    },
    stop() {
      synth?.cancel();
    },
  };
}
