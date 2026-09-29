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

/**
 * Voice list loads asynchronously in most browsers; resolve once it is there.
 * Always resolves — with an empty list if nothing ever appears — because
 * speak() waits on it, and a promise that never settles is a dead button.
 */
let initPromise = null;
export function initVoices() {
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve) => {
    if (!isSupported()) {
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
    // Not {once}: the list changes when the learner installs a voice, and the
    // "no Chinese voice" warning should disappear without a reload.
    speechSynthesis.addEventListener?.('voiceschanged', grab);
    if (grab()) return;
    // Safari sometimes never fires the event; poll briefly as a fallback.
    let tries = 0;
    const t = setInterval(() => {
      if (grab()) clearInterval(t);
      else if (++tries > 20) {
        clearInterval(t);
        ready = true;
        resolve(voices);
      }
    }, 150);
  });
  return initPromise;
}

export const isSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

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
 *
 * With no Mandarin voice installed, handing Chinese to the default English
 * voice does not "sound a bit off" — it plays silence or noise, and the learner
 * concludes the app is broken. So we refuse, and announce `tts:novoice` so the
 * app can explain how to fix it at the exact moment the learner tapped play.
 *
 * @param {string} text
 * @param {object} opts { rate, pitch }
 * @returns {Promise<void>} resolves when speech finishes (or fails silently)
 */
let current = null;

export async function speak(text, opts = {}) {
  if (!isSupported()) { announceNoVoice('unsupported'); return; }
  if (!ready) await initVoices();
  const voice = pickVoice();
  if (!voice || !chineseVoices().includes(voice)) { announceNoVoice('novoice'); return; }

  // Chrome drops an utterance queued in the same tick as cancel().
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    await new Promise((r) => setTimeout(r, 60));
  }

  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = opts.rate ?? get().settings.speechRate ?? 0.85;
    u.pitch = opts.pitch ?? 1;
    // Chrome garbage-collects an unreferenced utterance mid-sentence, and then
    // `end` never fires. Hold it, and cap the wait so callers chaining speech
    // (speakTwice, dialogues) can never hang on a lost event.
    current = u;
    const cap = setTimeout(done, 1500 + text.length * 700 / u.rate);
    function done() {
      clearTimeout(cap);
      if (current === u) current = null;
      resolve();
    }
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
    // Chrome can sit in a paused state after a tab was backgrounded.
    if (speechSynthesis.paused) speechSynthesis.resume();
  });
}

export const hasChineseVoice = () => isSupported() && chineseVoices().length > 0;

function announceNoVoice(reason) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('tts:novoice', { detail: { reason } }));
  } catch { /* no CustomEvent in this environment — nothing to tell */ }
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
