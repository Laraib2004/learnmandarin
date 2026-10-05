import { h, pinyinEl, keys, spokenNote } from '../ui.js';
import { speakableSentences } from '../deck.js';
import { speak, speakTwice } from '../tts.js';
import * as asr from '../asr.js';
import { get, update, bumpDaily } from '../store.js';
import { signal, cue, unlockAudio } from '../feedback.js';

/**
 * Speak — production practice with objective feedback.
 *
 * Two modes, in the order a learner should use them:
 *   Shadow  — hear it, say it along, no judgement. Builds the motor pattern.
 *   Produce — see the English only, say it in Mandarin from memory, get scored.
 *
 * The scoring is honest in a specific way: a Mandarin ASR engine either
 * understood you or it did not. That is the same bar a person in Beijing
 * applies, and it is a bar no tap-the-tiles app ever makes you clear.
 */
export default function speakView(root) {
  const pool = speakableSentences();
  let mode = 'shadow';
  let i = 0;
  let listening = false;
  let last = null;

  const pane = h('div', { class: 'stack' });
  root.append(pane);

  const current = () => pool[i % pool.length];

  const next = () => { i++; last = null; paint(); if (mode === 'shadow') speakTwice(current().hanzi); };
  const prev = () => { i = (i - 1 + pool.length) % pool.length; last = null; paint(); };

  async function attempt() {
    if (listening) return;
    const s = current();

    if (!asr.isSupported()) return;
    unlockAudio();
    listening = true;
    cue('listening');
    paint();
    try {
      const result = await asr.listen({ timeoutMs: 8000 });
      const scored = asr.score(s.hanzi, result);
      last = scored;

      update((st) => {
        const rec = st.speech[s.id] || { attempts: 0, best: 0 };
        rec.attempts++;
        rec.best = Math.max(rec.best, scored.score);
        rec.lastAt = Date.now();
        st.speech[s.id] = rec;
      });
      bumpDaily('speak');
      signal(scored.score >= 90 ? 'correct' : scored.score >= 60 ? 'partial' : 'wrong',
        scored.score >= 90 ? 'Clear — they would understand you'
          : scored.score >= 60 ? 'Close — check the marked syllables'
          : 'Not understood — copy the audio again');
    } catch (err) {
      last = { error: err.message };
    } finally {
      listening = false;
      paint();
    }
  }

  function paint() {
    const s = current();
    const rec = get().speech[s.id];
    const showHanzi = get().settings.showHanzi;

    pane.replaceChildren(
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', { class: 'row' },
          modeBtn('shadow', 'Shadow'),
          modeBtn('produce', 'Produce')),
        h('span', { class: 'muted small' }, `${(i % pool.length) + 1} / ${pool.length}`)),

      h('p', { class: 'muted small', style: 'margin:0' },
        mode === 'shadow'
          ? 'Play it, then say it out loud at the same time. Copy the melody, not just the sounds. Do this five times before you move on.'
          : 'Read the English. Say it in Mandarin from memory, out loud, then check yourself.'),

      h('section', { class: 'card study' },
        mode === 'shadow'
          ? h('div', { class: 'stack' },
              showHanzi ? h('div', { class: 'zh zh-xl' }, s.hanzi) : null,
              pinyinEl(s.pinyin),
              h('div', { class: 'muted' }, s.en))
          : h('div', { class: 'stack' },
              h('div', { class: 'en', style: 'font-size:1.5rem;font-weight:600' }, s.en),
              last
                ? h('div', { class: 'stack' },
                    showHanzi ? h('div', { class: 'zh zh-lg' }, s.hanzi) : null,
                    pinyinEl(s.pinyin))
                : h('div', { class: 'muted small' }, 'Say it before you look.')),

        spokenNote(s.pinyin, s.spoken),

        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn', onclick: () => speak(s.hanzi) }, '🔊 Native speed'),
          h('button', { class: 'btn btn-ghost', onclick: () => speak(s.hanzi, { rate: 0.5 }) }, 'Slow'),
          h('button', { class: 'btn btn-ghost', onclick: () => speakTwice(s.hanzi) }, 'Slow → fast')),

        asr.isSupported()
          ? h('div', { class: 'stack', style: 'margin-top:.4rem' },
              h('button', {
                class: `mic ${listening ? 'live' : ''}`,
                onclick: attempt,
                'aria-label': listening ? 'Listening' : 'Record your attempt',
                disabled: listening,
              }, listening ? '●' : '🎤'),
              h('div', { class: 'muted small' },
                listening ? 'Listening — say it now' : 'Tap and say it in Mandarin'))
          : h('div', { class: 'notice warn' },
              h('b', {}, 'Scoring needs Chrome, Edge, or Safari. '),
              'Your browser does not expose speech recognition, so this page cannot grade you. ' +
              'Everything else still works — use Shadow mode and judge yourself against the audio.'),

        last ? feedback(last, s) : null,

        rec?.attempts
          ? h('div', { class: 'muted small' }, `${rec.attempts} attempt${rec.attempts === 1 ? '' : 's'} · best ${rec.best}%`)
          : null),

      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('button', { class: 'btn', onclick: prev }, '← Previous'),
        h('button', { class: 'btn btn-primary', onclick: next }, 'Next →')),

      h('p', { class: 'muted small center' },
        h('kbd', {}, 'Space'), ' record · ', h('kbd', {}, 'P'), ' play · ', h('kbd', {}, '→'), ' next'),
    );
  }

  function modeBtn(id, label) {
    return h('button', {
      class: `btn ${mode === id ? 'btn-primary' : ''}`,
      onclick: () => { mode = id; last = null; paint(); },
    }, label);
  }

  const off = keys({
    ' ': attempt,
    p: () => speak(current().hanzi), P: () => speak(current().hanzi),
    ArrowRight: next,
    ArrowLeft: prev,
  });

  paint();
  return off;
}

/** Per-character verdict plus a plain-language read on what to fix. */
function feedback(result, s) {
  if (result.error) {
    return h('div', { class: 'notice warn' }, asr.errorText(result.error));
  }

  const { score, marks, heard, exact } = result;
  const colour = score >= 90 ? 'var(--good)' : score >= 60 ? 'var(--warn)' : 'var(--bad)';
  const verdict = exact
    ? 'Understood exactly. That is what a native listener would have heard.'
    : score >= 80
      ? 'Close — a person would understand you, but the marked syllables drifted.'
      : score >= 40
        ? 'Partly understood. Slow down and exaggerate the tones on the red syllables.'
        : 'Not understood. Play the audio again and copy the melody before retrying.';

  return h('div', { class: 'stack', style: 'margin-top:.6rem' },
    h('div', { class: 'score', style: `color:${colour}` }, `${score}%`),
    h('div', { class: 'marks' },
      ...marks.map((m) => h('span', { class: `mark ${m.ok ? 'ok' : 'bad'}`, title: m.ok ? 'understood' : m.heard ? `heard ${m.heard}` : 'not heard at all' }, m.char))),
    h('div', { class: 'muted small' }, verdict),
    heard && !exact ? h('div', { class: 'muted small' }, 'It heard: ', h('span', { class: 'zh' }, heard)) : null,
    !exact ? h('div', { class: 'row', style: 'justify-content:center' },
      h('button', { class: 'btn btn-ghost', onclick: () => speak(s.hanzi, { rate: 0.5 }) }, 'Hear it slowly again')) : null);
}
