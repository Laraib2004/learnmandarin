import { h, pinyinEl, shuffle, sample, TONE_LEGEND } from '../ui.js';
import { getCorpus } from '../deck.js';
import { speak, isSupported as ttsOk } from '../tts.js';
import { update, get, bumpDaily } from '../store.js';
import { signal, unlockAudio } from '../feedback.js';

/**
 * Tone Lab — ear training before mouth training.
 *
 * The drill is forced-choice discrimination on minimal pairs: four words that
 * differ only in tone. You hear one, you pick it. This is how phonetic training
 * research actually moves perception, and it is precisely what a multiple-choice
 * translation app never does.
 */
export default function tones(root) {
  const { tones: data } = getCorpus();
  let mode = 'learn';
  const wrap = h('div', { class: 'stack' });
  root.append(wrap);

  const tabs = () => h('div', { class: 'row' },
    tab('learn', 'The five tones'),
    tab('drill', 'Ear drill'),
    tab('rules', 'When tones change'));

  const tab = (id, label) =>
    h('button', {
      class: `btn ${mode === id ? 'btn-primary' : ''}`,
      onclick: () => { mode = id; paint(); },
    }, label);

  function paint() {
    wrap.replaceChildren(tabs(), mode === 'learn' ? learnPane(data) : mode === 'drill' ? drillPane(data) : rulesPane(data));
  }
  paint();
  return null;
}

/* ---------- 1. Explain the tones ---------- */

function learnPane(data) {
  const pane = h('div', { class: 'stack' });
  pane.append(
    h('section', { class: 'card stack' },
      h('h2', {}, 'Why this comes first'),
      h('p', { class: 'muted small', style: 'margin:0' }, data.meta.note),
      !ttsOk() ? h('div', { class: 'notice warn' },
        'Your browser has no speech synthesis, so the audio buttons will be silent. ' +
        'Chrome, Edge, or Safari will give you Mandarin audio.') : null),

    h('section', { class: 'card stack' },
      h('h2', {}, 'The five tones'),
      ...data.tones.map((t) =>
        h('div', { class: 'row', style: 'justify-content:space-between;border-bottom:1px solid var(--line);padding:.5rem 0' },
          h('div', { style: 'flex:1;min-width:190px' },
            h('b', { class: `t${t.num}`, style: 'font-size:1.15rem' }, `${t.gesture}  ${t.mark}`),
            h('div', {}, t.name, ' ', h('span', { class: 'muted small' }, `(pitch ${t.contour})`)),
            h('div', { class: 'muted small' }, t.desc))))),

    h('section', { class: 'card stack' },
      h('h2', {}, 'Hear them side by side'),
      h('p', { class: 'muted small', style: 'margin:0' },
        'Same syllable, four meanings. Play each one until the difference is obvious to you — that is the whole goal of this page.'),
      ...data.pairs.map(pairRow)),
  );
  return pane;
}

function pairRow(pair) {
  return h('div', { class: 'row', style: 'gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--line)' },
    ...pair.items.map((it) =>
      h('button', {
        class: 'btn', style: 'flex:1;min-width:110px;text-align:center',
        onclick: () => speak(it.hanzi, { rate: 0.75 }),
        title: `Play ${it.pinyin}`,
      },
        h('div', { class: `zh t${it.tone}`, style: 'font-size:1.5rem;font-weight:600' }, it.hanzi),
        h('div', { class: `t${it.tone}`, style: 'font-weight:600' }, it.pinyin),
        h('div', { class: 'muted small' }, it.gloss))));
}

/* ---------- 2. The drill ---------- */

function drillPane(data) {
  const pane = h('div', { class: 'stack' });
  const pool = data.pairs.filter((p) => p.items.length >= 3);
  let current = null;
  let answered = false;
  let run = 0;
  let runBest = Number(localStorage.getItem('learnchinese.toneBest') || 0);

  const scoreEl = h('div', { class: 'muted small' });

  function nextQuestion() {
    const pair = pool[Math.floor(Math.random() * pool.length)];
    const choices = shuffle(sample(pair.items, Math.min(4, pair.items.length)));
    current = { pair, target: choices[Math.floor(Math.random() * choices.length)], choices };
    answered = false;
    paint();
    speak(current.target.hanzi, { rate: 0.7 });
  }

  function answer(item, btn) {
    if (answered) return;
    answered = true;
    const correct = item.pinyin === current.target.pinyin;

    update((s) => {
      const key = current.target.pinyin;
      s.tones[key] = s.tones[key] || { seen: 0, correct: 0 };
      s.tones[key].seen++;
      if (correct) s.tones[key].correct++;
    });
    bumpDaily('reviews');

    if (correct) {
      run++;
      if (run > runBest) { runBest = run; localStorage.setItem('learnchinese.toneBest', String(run)); }
    } else {
      run = 0;
    }

    for (const b of pane.querySelectorAll('.choice')) {
      const p = b.dataset.pinyin;
      if (p === current.target.pinyin) b.classList.add('correct');
      else if (b === btn) b.classList.add('wrong');
      b.disabled = true;
    }
    signal(correct ? 'correct' : 'wrong');
    scoreEl.replaceChildren(
      document.createTextNode(correct
        ? `Correct — ${current.target.pinyin} (${current.target.gloss}). Streak ${run}.`
        : `That was ${item.pinyin}. You heard ${current.target.pinyin} — ${current.target.gloss}.`));
    pane.querySelector('[data-next]').hidden = false;
  }

  function paint() {
    const acc = accuracy();
    pane.replaceChildren(
      h('section', { class: 'card stack' },
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('h2', { style: 'margin:0' }, 'Which one did you hear?'),
          h('span', { class: 'muted small' },
            acc === null ? 'no attempts yet' : `${acc}% lifetime · best streak ${runBest}`)),
        TONE_LEGEND(),

        !current
          ? h('div', { class: 'stack center', style: 'padding:1.5rem 0' },
              h('p', { class: 'muted' },
                'You will hear one syllable. Pick the tone you heard. Guessing is fine — the point is to train your ear, and it works even when it feels random at first.'),
              h('button', { class: 'btn btn-primary btn-lg tappable', onclick: () => { unlockAudio(); nextQuestion(); } }, 'Start drilling'))
          : h('div', { class: 'stack' },
              h('div', { class: 'center' },
                h('button', { class: 'btn btn-lg', onclick: () => speak(current.target.hanzi, { rate: 0.7 }) }, '🔊  Play again'),
                ' ',
                h('button', { class: 'btn btn-ghost', onclick: () => speak(current.target.hanzi, { rate: 0.45 }) }, 'slower')),
              h('div', { class: 'choices' },
                ...current.choices.map((it) =>
                  h('button', {
                    class: 'btn choice', dataset: { pinyin: it.pinyin },
                    onclick: (e) => answer(it, e.currentTarget),
                  },
                    h('div', { class: answered ? `t${it.tone}` : '' }, it.pinyin),
                    h('div', { class: 'muted small', style: 'font-family:var(--font)' }, answered ? it.gloss : ' ')))),
              scoreEl,
              h('div', { class: 'center' },
                h('button', { class: 'btn btn-primary', dataset: { next: '1' }, hidden: !answered, onclick: nextQuestion }, 'Next →')))),
    );
  }

  paint();
  return pane;
}

function accuracy() {
  const t = Object.values(get().tones);
  const seen = t.reduce((a, x) => a + x.seen, 0);
  const ok = t.reduce((a, x) => a + x.correct, 0);
  return seen ? Math.round((ok / seen) * 100) : null;
}

/* ---------- 3. Tone sandhi ---------- */

function rulesPane(data) {
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' },
      h('h2', {}, 'Tones change in real speech'),
      h('p', { class: 'muted small', style: 'margin:0' },
        'Written pinyin shows each syllable’s dictionary tone. Spoken Mandarin does not always match it. ' +
        'These four rules cover almost every mismatch you will hear as a beginner — and knowing them is the difference ' +
        'between sounding like a textbook and sounding like a person.')),
    ...data.rules.map((r) =>
      h('section', { class: 'card stack' },
        h('h2', {}, r.title),
        h('p', { class: 'muted small', style: 'margin:0' }, r.detail),
        h('div', { class: 'stack', style: 'gap:.4rem' },
          ...r.examples.map((ex) =>
            h('div', { class: 'row', style: 'justify-content:space-between;gap:.6rem' },
              h('button', { class: 'btn btn-ghost', onclick: () => speak(ex.hanzi, { rate: 0.7 }) }, '🔊'),
              h('span', { class: 'zh', style: 'font-size:1.4rem;flex:1' }, ex.hanzi),
              h('span', { class: 'muted small', style: 'text-decoration:line-through' }, ex.written),
              h('span', { style: 'font-weight:600' }, '→'),
              pinyinEl(ex.spoken, 'pinyin')))))));
}
