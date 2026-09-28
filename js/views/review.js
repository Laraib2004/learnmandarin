import { h, pinyinEl, keys } from '../ui.js';
import { buildQueue, cardFor } from '../deck.js';
import { review as grade, previewIntervals, formatInterval } from '../fsrs.js';
import { get, update, bumpDaily } from '../store.js';
import { speak, speakTwice } from '../tts.js';
import { refreshBadge } from '../main.js';

/**
 * The review session.
 *
 * Card direction is deliberately audio-first: you hear Mandarin and recall the
 * meaning, which is the direction real listening comprehension requires. The
 * English-to-Mandarin direction is handled by the Speak view, where you have to
 * actually produce it rather than recognise it.
 */
export default function review(root, { navigate }) {
  const { queue, due, fresh } = buildQueue();

  if (!queue.length) {
    root.append(
      h('section', { class: 'card stack center' },
        h('h1', {}, 'Nothing due'),
        h('p', { class: 'muted' },
          'You are caught up. Adding more new cards now would only inflate tomorrow’s workload — ' +
          'the schedule is doing its job.'),
        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn btn-primary', onclick: () => navigate('speak') }, 'Practise speaking instead'),
          h('button', { class: 'btn', onclick: () => navigate('settings') }, 'Raise my daily new limit'))));
    return null;
  }

  let i = 0;
  let revealed = false;
  let done = 0;
  const startedNew = new Set();
  const pane = h('div', { class: 'stack' });
  root.append(pane);

  const current = () => queue[i];

  function advance() {
    i++;
    revealed = false;
    if (i >= queue.length) return finish();
    paint();
    autoplay();
  }

  function autoplay() {
    const s = current();
    if (isNew(s)) speakTwice(s.hanzi);
    else speak(s.hanzi);
  }

  const isNew = (s) => !(get().cards[s.id]?.reps > 0);

  function answer(g) {
    if (!revealed) return;
    const s = current();
    const wasNew = isNew(s);
    const card = cardFor(s.id);
    const next = grade(card, g, { requestRetention: get().settings.requestRetention });

    update((st) => {
      st.cards[s.id] = next;
      st.log.push({ t: Date.now(), id: s.id, grade: g });
      if (st.log.length > 5000) st.log.splice(0, st.log.length - 5000);
    });
    bumpDaily(wasNew ? 'new' : 'reviews');
    if (wasNew) startedNew.add(s.id);

    // "Again" puts the card back near the end of this session rather than
    // burying it a minute away where the session might already be over.
    if (g === 1) queue.push(s);

    done++;
    refreshBadge();
    advance();
  }

  function finish() {
    pane.replaceChildren(
      h('section', { class: 'card stack center' },
        h('h1', {}, '完成 — session done'),
        h('p', { class: 'muted' },
          `${done} card${done === 1 ? '' : 's'} reviewed, ${startedNew.size} new sentence${startedNew.size === 1 ? '' : 's'} learned.`),
        h('p', { class: 'muted small' },
          'The best thing you can do right now is say today’s sentences out loud. Recognition is not production.'),
        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn btn-primary', onclick: () => navigate('speak') }, 'Say them out loud →'),
          h('button', { class: 'btn', onclick: () => navigate('') }, 'Back to today'))));
  }

  function paint() {
    const s = current();
    const fresh = isNew(s);
    const card = cardFor(s.id);
    const ivls = previewIntervals(card, { requestRetention: get().settings.requestRetention });
    const showHanzi = get().settings.showHanzi;

    pane.replaceChildren(
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('span', { class: 'muted small' }, `${i + 1} / ${queue.length}`),
        h('span', { class: `pill ${fresh ? 'new' : 'review'}` }, fresh ? 'new' : 'review')),

      h('section', { class: 'card study' },
        fresh && !revealed
          ? h('div', { class: 'stack' },
              h('div', { class: 'muted small' }, 'New sentence — listen first'),
              showHanzi ? h('div', { class: 'zh zh-xl' }, s.hanzi) : null,
              pinyinEl(s.pinyin),
              h('div', { class: 'en' }, s.en))
          : h('div', { class: 'stack' },
              showHanzi
                ? h('div', { class: 'zh zh-xl' }, s.hanzi)
                : h('div', { class: 'muted', style: 'font-size:2rem' }, '🔊'),
              revealed ? pinyinEl(s.pinyin) : h('div', { class: 'muted small' }, 'What does this mean?'),
              revealed ? h('div', { class: 'en' }, s.en) : null),

        revealed && s.spoken
          ? h('div', { class: 'muted small' }, `said as: ${s.spoken} (tone change)`)
          : null,

        revealed ? h('div', { class: 'words' }, ...s.words.map(wordChip)) : null,

        h('div', { class: 'row', style: 'justify-content:center;margin-top:.5rem' },
          h('button', { class: 'btn', onclick: () => speak(s.hanzi) }, '🔊 Play'),
          h('button', { class: 'btn btn-ghost', onclick: () => speak(s.hanzi, { rate: 0.5 }) }, 'Slow'))),

      revealed
        ? h('div', { class: 'stack' },
            h('div', { class: 'grades' },
              gradeBtn(1, 'Again', ivls[1]),
              gradeBtn(2, 'Hard', ivls[2]),
              gradeBtn(3, 'Good', ivls[3]),
              gradeBtn(4, 'Easy', ivls[4])),
            h('p', { class: 'muted small center', style: 'margin:0' },
              'Answer honestly. The scheduler is only as good as your grading — “Good” means you recalled it without a struggle.'))
        : h('div', { class: 'center' },
            h('button', { class: 'btn btn-primary btn-lg', onclick: reveal },
              fresh ? 'Got it — start learning' : 'Show answer')),

      h('p', { class: 'muted small center' },
        h('kbd', {}, 'Space'), ' reveal · ', h('kbd', {}, '1–4'), ' grade · ', h('kbd', {}, 'R'), ' replay'),
    );
  }

  function reveal() {
    revealed = true;
    paint();
  }

  function gradeBtn(g, label, ms) {
    return h('button', { class: 'btn grade', dataset: { g: String(g) }, onclick: () => answer(g) },
      h('b', {}, label),
      h('small', {}, formatInterval(ms)));
  }

  const off = keys({
    ' ': () => (revealed ? null : reveal()),
    Enter: () => (revealed ? answer(3) : reveal()),
    1: () => answer(1), 2: () => answer(2), 3: () => answer(3), 4: () => answer(4),
    r: () => speak(current().hanzi), R: () => speak(current().hanzi),
  });

  paint();
  autoplay();
  return off;
}

function wordChip(w) {
  return h('div', { class: 'word' },
    h('b', {}, w.h),
    h('i', {}, w.p),
    h('u', { class: 'muted' }, w.e));
}
