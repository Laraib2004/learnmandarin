import { h, pinyinEl, keys, sample } from '../ui.js';
import { availablePatterns, fillPattern, getCorpus } from '../deck.js';
import { speak } from '../tts.js';
import * as asr from '../asr.js';
import { get, update, bumpDaily } from '../store.js';

/**
 * Pattern drills — the step from "knows Chinese" to "speaks Chinese".
 *
 * Reviewing sentences trains recall. Recall is not fluency: a fluent speaker
 * *generates* utterances they have never produced before, fast enough to hold a
 * conversation. So this view takes a frame (我想 ___) and fills the slot at
 * random, then asks you to produce the whole sentence from the English alone.
 *
 * The timer is the point, not decoration. Correct-but-slow is not fluent — the
 * target is under ~4 seconds from prompt to complete utterance, which is roughly
 * conversational latency. Accuracy without speed plateaus; this forces both.
 */

const TARGET_MS = 4000;

export default function drill(root) {
  const corpus = getCorpus();
  const patterns = availablePatterns();

  let pattern = null;     // null = pattern picker
  let item = null;        // current generated sentence
  let revealed = false;
  let startedAt = 0;
  let elapsed = 0;
  let last = null;
  let listening = false;
  let streak = 0;

  const pane = h('div', { class: 'stack' });
  root.append(pane);

  /* ---------- picking a pattern ---------- */

  function picker() {
    const byStage = new Map();
    for (const p of patterns) {
      if (!byStage.has(p.stage)) byStage.set(p.stage, []);
      byStage.get(p.stage).push(p);
    }
    const drills = get().drills || {};

    return h('div', { class: 'stack' },
      h('section', { class: 'card stack' },
        h('h1', {}, 'Pattern drills'),
        h('p', { class: 'muted small', style: 'margin:0' }, corpus.patternsMeta.why),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary btn-lg', onclick: () => start(null) }, 'Drill everything unlocked'),
          h('span', { class: 'muted small' }, `${patterns.length} patterns open`))),

      ...[...byStage.entries()].map(([stageId, list]) => {
        const st = corpus.stageById[stageId];
        return h('section', { class: 'card stack' },
          h('h2', {}, `${st.level} · ${st.title}`),
          h('div', { class: 'stack', style: 'gap:.4rem' },
            ...list.map((p) => {
              const rec = drills[p.id];
              return h('button', {
                class: 'btn', style: 'text-align:left;width:100%',
                onclick: () => start(p),
              },
                h('div', { class: 'row', style: 'justify-content:space-between;gap:.5rem' },
                  h('b', { class: 'zh' }, p.name),
                  h('span', { class: 'muted small' },
                    rec?.attempts ? `${rec.attempts} tries · best ${rec.best}%` : `${p.slots.length} variations`)),
                h('div', { class: 'muted small', style: 'font-family:var(--font)' }, p.note));
            })));
      }));
  }

  /* ---------- drilling ---------- */

  function start(p) {
    pattern = p;
    streak = 0;
    nextItem();
  }

  function nextItem() {
    const pool = pattern ? [pattern] : patterns;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const slot = chosen.slots[Math.floor(Math.random() * chosen.slots.length)];
    item = fillPattern(chosen, slot);
    revealed = false;
    last = null;
    elapsed = 0;
    startedAt = Date.now();
    paint();
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    elapsed = Date.now() - startedAt;
    paint();
    speak(item.hanzi);
  }

  async function attempt() {
    if (listening || !asr.isSupported()) return;
    listening = true;
    paint();
    try {
      const result = await asr.listen({ timeoutMs: 8000 });
      elapsed = Date.now() - startedAt;
      const scored = asr.score(item.hanzi, result);
      last = scored;
      revealed = true;

      update((st) => {
        st.drills = st.drills || {};
        const rec = st.drills[item.patternId] || { attempts: 0, best: 0, fast: 0 };
        rec.attempts++;
        rec.best = Math.max(rec.best, scored.score);
        if (scored.score >= 80 && elapsed <= TARGET_MS) rec.fast++;
        rec.lastAt = Date.now();
        st.drills[item.patternId] = rec;
      });
      bumpDaily('drill');
      streak = scored.score >= 80 ? streak + 1 : 0;
    } catch (err) {
      last = { error: err.message };
      revealed = true;
    } finally {
      listening = false;
      paint();
    }
  }

  function paint() {
    if (!item) { pane.replaceChildren(picker()); return; }

    const showHanzi = get().settings.showHanzi;
    const fast = elapsed > 0 && elapsed <= TARGET_MS;

    pane.replaceChildren(
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('button', { class: 'btn btn-ghost', onclick: () => { item = null; pattern = null; paint(); } }, '← All patterns'),
        h('span', { class: 'muted small' },
          pattern ? pattern.name : 'Mixed', streak > 1 ? ` · streak ${streak}` : '')),

      h('section', { class: 'card study' },
        h('div', { class: 'muted small' }, 'Say this in Mandarin — now, without pausing'),
        h('div', { class: 'en', style: 'font-size:1.6rem;font-weight:650' }, item.en),

        revealed
          ? h('div', { class: 'stack' },
              showHanzi ? h('div', { class: 'zh zh-lg' }, item.hanzi) : null,
              pinyinEl(item.pinyin),
              elapsed > 0
                ? h('div', { style: `font-weight:650;color:${fast ? 'var(--good)' : 'var(--warn)'}` },
                    `${(elapsed / 1000).toFixed(1)}s ${fast ? '— conversational speed' : `— aim for under ${TARGET_MS / 1000}s`}`)
                : null,
              h('div', { class: 'muted small' }, item.note))
          : h('div', { class: 'muted', style: 'font-size:2rem' }, '…'),

        asr.isSupported()
          ? h('div', { class: 'stack', style: 'margin-top:.3rem' },
              h('button', {
                class: `mic ${listening ? 'live' : ''}`, onclick: attempt, disabled: listening,
                'aria-label': listening ? 'Listening' : 'Record your attempt',
              }, listening ? '●' : '🎤'),
              h('div', { class: 'muted small' }, listening ? 'Listening…' : 'Tap, then say the whole sentence'))
          : h('div', { class: 'notice warn' },
              'Speech scoring needs Chrome, Edge, or Safari. You can still drill — say it aloud, then reveal and check yourself honestly.'),

        last ? verdict(last) : null,

        h('div', { class: 'row', style: 'justify-content:center;margin-top:.4rem' },
          !revealed ? h('button', { class: 'btn', onclick: reveal }, 'Show answer') : null,
          revealed ? h('button', { class: 'btn', onclick: () => speak(item.hanzi) }, '🔊 Play') : null,
          revealed ? h('button', { class: 'btn btn-ghost', onclick: () => speak(item.hanzi, { rate: 0.5 }) }, 'Slow') : null,
          h('button', { class: 'btn btn-primary', onclick: nextItem }, 'Next →'))),

      h('p', { class: 'muted small center' },
        h('kbd', {}, 'Space'), ' record · ', h('kbd', {}, 'Enter'), ' next · ', h('kbd', {}, 'S'), ' show'),
    );
  }

  function verdict(result) {
    if (result.error) {
      return h('div', { class: 'notice warn' },
        result.error === 'no-speech' ? 'Did not catch that — speak up and try again.'
          : result.error === 'not-allowed' ? 'Microphone blocked. Allow it in your browser settings.'
          : `Recognition failed: ${result.error}`);
    }
    const { score, marks, exact } = result;
    const colour = score >= 90 ? 'var(--good)' : score >= 60 ? 'var(--warn)' : 'var(--bad)';
    return h('div', { class: 'stack', style: 'margin-top:.4rem' },
      h('div', { class: 'score', style: `color:${colour}` }, `${score}%`),
      h('div', { class: 'marks' },
        ...marks.map((m) => h('span', { class: `mark ${m.ok ? 'ok' : 'bad'}` }, m.char))),
      h('div', { class: 'muted small' },
        exact ? 'Built it correctly from scratch. That is the skill.'
          : score >= 80 ? 'Understood — check the marked syllables.'
          : 'Not understood. Reveal it, say it along twice, then retry.'));
  }

  const off = keys({
    ' ': () => (item ? attempt() : null),
    s: reveal, S: reveal,
    Enter: () => (item ? nextItem() : null),
  });

  paint();
  return off;
}
