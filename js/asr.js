/**
 * Speech recognition + scoring: the feature that separates this from flashcards.
 *
 * The browser's SpeechRecognition engine is trained on native Mandarin. If it
 * transcribes what you said as the sentence you were aiming for, a native
 * listener would very likely have understood you too. If it hears something
 * else, that mismatch is real, specific, actionable feedback — the thing no
 * tapping-based app ever gives you.
 *
 * Availability: Chrome, Edge, and Safari 14.1+. Firefox does not implement it,
 * so the Speak view degrades to record-and-compare instead of refusing to work.
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const isSupported = () => Boolean(SR);

/**
 * Listen once and resolve with what the engine heard.
 * @returns {Promise<{transcript: string, confidence: number, alternatives: string[]}>}
 */
export function listen({ lang = 'zh-CN', timeoutMs = 8000 } = {}) {
  if (!SR) return Promise.reject(new Error('unsupported'));

  return new Promise((resolve, reject) => {
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    rec.continuous = false;

    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { rec.stop(); } catch { /* already stopped */ }
      fn(arg);
    };

    const timer = setTimeout(() => done(reject, new Error('timeout')), timeoutMs);

    rec.onresult = (e) => {
      const result = e.results[0];
      const alts = Array.from(result).map((a) => a.transcript);
      done(resolve, {
        transcript: result[0].transcript,
        confidence: result[0].confidence,
        alternatives: alts,
      });
    };
    rec.onerror = (e) => done(reject, new Error(e.error || 'speech-error'));
    rec.onend = () => done(reject, new Error('no-speech'));

    rec.start();
  });
}

/**
 * One plain sentence per recogniser failure, shared by every view.
 *
 * 'network' matters most: Chrome sends audio to a server to recognise it, so
 * offline the mic "fails" for a reason that has nothing to do with the learner.
 * Say so, and tell them the speaking still counts — never imply they did it wrong.
 */
export function errorText(code) {
  return {
    'no-speech': 'Did not catch anything. Check the mic is allowed and speak a little louder.',
    timeout: 'Timed out waiting for speech. Tap the mic and try again.',
    'not-allowed': 'Microphone permission was denied. Allow it in your browser’s site settings.',
    'audio-capture': 'No microphone found.',
    network: 'Scoring your speech needs an internet connection on this device. Everything else works offline — say it out loud anyway, the speaking still counts.',
    unsupported: 'This browser cannot score speech. Say it out loud anyway — the speaking still counts.',
  }[code] || `Could not score that (${code}). Carry on regardless.`;
}

/** Strip punctuation/whitespace so scoring compares only the spoken content. */
export function normalize(text) {
  return (text || '')
    .replace(/[\s，。？！、；：,.?!;:"'“”‘’()（）]/g, '')
    .trim();
}

/**
 * Character-level alignment between target and heard text.
 * Returns per-character marks so the UI can show exactly which syllable missed.
 */
export function align(target, heard) {
  const a = [...normalize(target)];
  const b = [...normalize(heard)];
  const n = a.length;
  const m = b.length;

  // Levenshtein DP table with backtrace.
  const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }

  const marks = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      marks.push({ char: a[i - 1], ok: a[i - 1] === b[j - 1], heard: b[j - 1] });
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      marks.push({ char: a[i - 1], ok: false, heard: null }); // you left it out
      i--;
    } else {
      j--; // engine heard an extra character; not attributable to a target char
    }
  }
  marks.reverse();

  const distance = d[n][m];
  const score = n === 0 ? 0 : Math.max(0, Math.round((1 - distance / Math.max(n, m)) * 100));
  return { marks, distance, score, exact: distance === 0 && n > 0 };
}

/**
 * Score an attempt, checking every alternative the engine offered and keeping
 * the best. Recognition is noisy; penalising a learner for the engine's first
 * guess when its second guess was exact would be feedback about the wrong thing.
 */
export function score(target, result) {
  const candidates = result.alternatives?.length ? result.alternatives : [result.transcript];
  let best = null;
  for (const c of candidates) {
    const a = align(target, c);
    if (!best || a.score > best.score) best = { ...a, heard: c };
  }
  return best;
}

/** Ask for microphone permission up front so the first attempt is not eaten. */
export async function primeMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}
