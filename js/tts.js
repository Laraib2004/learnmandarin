/**
 * Mandarin text-to-speech via the browser's built-in speech synthesis.
 *
 * Every modern OS ships a Chinese voice (Windows: Huihui/Yaoyao, macOS/iOS:
 * Tingting, Android: Google zh-CN). Using them means unlimited native-speed
 * audio for every sentence at zero cost and zero API keys — the thing that
 * normally forces a language app to charge money.
 */

import { get, update } from './store.js';

let voices = [];
let ready = false;

/** Voice list loads asynchronously in most browsers; resolve once it is there. */
export function initVoices() {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      ready = true;
      return resolve([]);
    }
    const grab = () => {
      voices = speechSynthesis.getVoices();
      if (voices.length) {
        ready = true;
        resolve(voices);
        return true;
      }
      return false;
    };
    if (grab()) return;
    speechSynthesis.addEventListener('voiceschanged', grab, { once: true });
    // Safari sometimes never fires the event; poll briefly as a fallback.
    let tries = 0;
    const t = setInterval(() => {
      if (grab() || ++tries > 20) clearInterval(t);
    }, 150);
  });
}

export const isSupported = () => 'speechSynthesis' in window;

/** All installed Mandarin voices, best-guess ranked. */
export function chineseVoices() {
  return voices.filter((v) => /^zh([-_]|$)/i.test(v.lang) || /chinese|mandarin/i.test(v.name));
}

function pickVoice() {
  const saved = get().settings.voiceURI;
  const zh = chineseVoices();
  if (saved) {
    const match = zh.find((v) => v.voiceURI === saved) || voices.find((v) => v.voiceURI === saved);
    if (match) return match;
  }
  // Prefer mainland Mandarin over Taiwan/HK variants for a beginner course.
  return zh.find((v) => /zh[-_]CN/i.test(v.lang)) || zh[0] || null;
}

export function setVoice(voiceURI) {
  update((s) => { s.settings.voiceURI = voiceURI; });
}

/**
 * Speak Mandarin text.
 * @param {string} text
 * @param {object} opts { rate, onend }
 * @returns {Promise<void>} resolves when speech finishes (or fails silently)
 */
export function speak(text, opts = {}) {
  if (!isSupported()) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'zh-CN';
    u.rate = opts.rate ?? get().settings.speechRate ?? 0.85;
    u.pitch = opts.pitch ?? 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stop() {
  if (isSupported()) speechSynthesis.cancel();
}

/** Speak a sentence slowly, then at natural speed — the shadowing pattern. */
export async function speakTwice(text) {
  await speak(text, { rate: 0.6 });
  await new Promise((r) => setTimeout(r, 400));
  await speak(text, { rate: 1.0 });
}

export const voicesReady = () => ready;
