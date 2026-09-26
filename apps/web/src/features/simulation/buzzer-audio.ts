/**
 * Озвучивание пьезоизлучателей в браузере (Web Audio). Только иллюстрация частоты,
 * измеренной симулятором: громкость и тембр не моделируются. Выключено по умолчанию,
 * включается пользователем (жест пользователя нужен браузеру для запуска звука).
 */

/** Громкость звука (доля полной шкалы) — условная, чтобы меандр не был резким. */
const GAIN = 0.04;

let context: AudioContext | null = null;
const voices = new Map<string, { oscillator: OscillatorNode; gain: GainNode }>();

function audioContext(): AudioContext | null {
  if (context !== null) return context;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (Ctor === undefined) return null;
  context = new Ctor();
  return context;
}

/** Разрешает звук после жеста пользователя. */
export function resumeAudio(): void {
  void audioContext()?.resume();
}

/** Запускает или перестраивает тон компонента. */
export function playTone(id: string, frequencyHz: number): void {
  const ctx = audioContext();
  if (ctx === null || !(frequencyHz > 0)) return;
  const voice = voices.get(id);
  if (voice !== undefined) {
    voice.oscillator.frequency.setValueAtTime(frequencyHz, ctx.currentTime);
    return;
  }
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequencyHz, ctx.currentTime);
  gain.gain.setValueAtTime(GAIN, ctx.currentTime);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  voices.set(id, { oscillator, gain });
}

export function stopTone(id: string): void {
  const voice = voices.get(id);
  if (voice === undefined) return;
  voices.delete(id);
  voice.oscillator.stop();
  voice.oscillator.disconnect();
  voice.gain.disconnect();
}
