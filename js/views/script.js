import { h, pinyinEl, shuffle, keys } from '../ui.js';
import { getCorpus, charCardFor, dueCharCards, newCharacters, charStats } from '../deck.js';
import { speak } from '../tts.js';
import { get, update, bumpDaily } from '../store.js';
import { review as gradeCard, formatInterval, previewIntervals } from '../fsrs.js';
import { signal, cue, unlockAudio } from '../feedback.js';

/**
 * Script — the reading/writing track, kept deliberately separate from speaking.
 *
 * Two things live here because learners conflate them and then stall:
 *
 *   Pinyin  — the alphabet-like system you have been reading since day one.
 *             It is NOT English: q, x, c, z, zh and ü do not say what an
 *             English speaker assumes, and that mismatch is most of a beginner
 *             accent. Nobody teaches this explicitly, so we do.
 *
 *   Hanzi   — not an alphabet at all. Characters are assembled from ~200
 *             reusable components. Taught components-first and ordered by
 *             frequency *in this course*, so every character learned pays off
 *             in sentences the learner already owns.
 *
 * This track is optional for speaking fluency, which is why it is its own view
 * rather than bolted onto Review.
 */
export default function script(root, { navigate }) {
  let mode = localStorage.getItem('learnchinese.scriptTab') || 'pinyin';
  const wrap = h('div', { class: 'stack' });
  root.append(wrap);

  const tab = (id, label) =>
    h('button', {
      class: `btn tappable ${mode === id ? 'btn-primary' : ''}`,
      onclick: () => { mode = id; localStorage.setItem('learnchinese.scriptTab', id); paint(); },
    }, label);

  function paint() {
    const setMode = (id) => { mode = id; localStorage.setItem('learnchinese.scriptTab', id); paint(); };
    const panes = { pinyin: pinyinPane, sounds: soundsPane, hanzi: hanziPane, learn: learnPane };
    wrap.replaceChildren(
      h('div', { class: 'row' }, tab('pinyin', 'Pinyin traps'), tab('sounds', 'All sounds'),
        tab('hanzi', 'Characters'), tab('learn', 'Learn characters')),
      panes[mode](navigate, setMode),
    );
  }
  paint();
  return null;
}

/* ================= 1. Pinyin: the traps that matter ================= */

function pinyinPane() {
  const { pinyin } = getCorpus();
  const pane = h('div', { class: 'stack' });
  let drill = null;
  let answered = null;

  function startDrill() {
    unlockAudio();
    const pair = pinyin.pairs[Math.floor(Math.random() * pinyin.pairs.length)];
    const target = Math.random() < 0.5 ? pair.a : pair.b;
    drill = { pair, target, choices: shuffle([pair.a, pair.b]) };
    answered = null;
    render();
    speak(target.h, { rate: 0.65 });
  }

  function answer(choice) {
    if (answered) return;
    const right = choice.p === drill.target.p;
    answered = { choice, right };
    update((s) => {
      s.pinyinDrill = s.pinyinDrill || { seen: 0, correct: 0 };
      s.pinyinDrill.seen++;
      if (right) s.pinyinDrill.correct++;
    });
    bumpDaily('reviews');
    signal(right ? 'correct' : 'wrong');
    render();
  }

  function render() {
    const rec = get().pinyinDrill;
    pane.replaceChildren(
      h('section', { class: 'card stack' },
        h('h1', {}, 'Pinyin'),
        h('p', { class: 'muted small', style: 'margin:0' }, pinyin.meta.why),
        h('div', { class: 'notice' },
          h('b', {}, 'Chinese has no alphabet. '),
          'Pinyin is a spelling system for the sounds, written in Latin letters — that is the closest thing. ',
          'Characters are a separate system entirely, and they are not letters. Learn them as two different things.')),

      h('section', { class: 'card stack' },
        h('h2', {}, 'Every syllable is initial + final + tone'),
        h('div', { class: 'row', style: 'justify-content:center;gap:.4rem;font-size:1.1rem' },
          h('span', { class: 'pill new' }, 'h'), h('span', {}, '+'),
          h('span', { class: 'pill learning' }, 'ao'), h('span', {}, '+'),
          h('span', { class: 'pill review' }, 'tone 3'), h('span', {}, '='),
          h('b', { class: 'zh' }, '好 hǎo')),
        h('p', { class: 'muted small', style: 'margin:0' }, pinyin.structure.note)),

      // The ear drill for the sounds English speakers confuse.
      h('section', { class: 'card stack' },
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('h2', { style: 'margin:0' }, 'Tell them apart'),
          rec?.seen ? h('span', { class: 'muted small' }, `${Math.round((rec.correct / rec.seen) * 100)}% of ${rec.seen}`) : null),
        !drill
          ? h('div', { class: 'stack center' },
              h('p', { class: 'muted small' }, 'These are the pairs English speakers merge. If you cannot hear the difference you cannot produce it.'),
              h('button', { class: 'btn btn-primary btn-lg tappable', onclick: startDrill }, 'Start listening drill'))
          : h('div', { class: 'stack center' },
              h('button', { class: 'mic tappable', onclick: () => speak(drill.target.h, { rate: 0.65 }) }, '🔊'),
              h('div', { class: 'choices' },
                ...drill.choices.map((c) =>
                  h('button', {
                    class: `btn choice tappable ${answered ? (c.p === drill.target.p ? 'correct' : c === answered.choice ? 'wrong' : '') : ''}`,
                    disabled: Boolean(answered),
                    onclick: () => answer(c),
                  },
                    h('div', { class: 'zh' }, c.h),
                    h('div', { style: 'font-family:var(--font);font-size:.95rem' }, c.p),
                    h('div', { class: 'muted small', style: 'font-family:var(--font)' }, c.e)))),
              answered
                ? h('div', { class: 'stack' },
                    h('div', { class: 'notice' }, h('b', {}, 'Tests: '), drill.pair.tests),
                    h('button', { class: 'btn btn-primary tappable', onclick: startDrill }, 'Next →'))
                : null)),

      ...pinyin.traps.map((t) =>
        h('section', { class: 'card stack' },
          h('h2', {}, t.title),
          h('p', { class: 'muted small', style: 'margin:0' }, t.detail),
          ...t.rows.map((r) =>
            h('div', { class: 'trap-row' },
              h('span', { class: 'trap-wrong' }, '✗ ', r.wrong),
              h('span', { class: 'trap-right' }, '✓ ', r.right),
              h('button', {
                class: 'btn btn-ghost tappable', style: 'flex:1;min-width:150px;text-align:left',
                onclick: () => { unlockAudio(); speak(r.eg.split(' ')[0], { rate: 0.6 }); },
              }, '🔊 ', r.eg))))),
    );
  }

  render();
  return pane;
}

/* ================= 2. The full sound inventory ================= */

function soundsPane() {
  const { pinyin } = getCorpus();
  const groups = new Map();
  for (const i of pinyin.initials) {
    if (!groups.has(i.group)) groups.set(i.group, []);
    groups.get(i.group).push(i);
  }

  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' },
      h('h1', {}, 'All the sounds'),
      h('p', { class: 'muted small', style: 'margin:0' },
        `Mandarin has only ${pinyin.initials.length} initials and about ${pinyin.finals.length} common finals. ` +
        'That is the entire sound system — a closed set. Tap anything to hear it. ' +
        'Sounds marked ⚠ do not match English spelling.')),

    ...[...groups.entries()].map(([group, items]) =>
      h('section', { class: 'card stack' },
        h('h2', {}, `Initials — ${group}`),
        ...items.map((i) => soundRow(i)))),

    h('section', { class: 'card stack' },
      h('h2', {}, 'Finals'),
      ...pinyin.finals.map((f) => soundRow(f))));
}

function soundRow(x) {
  return h('button', {
    class: 'btn btn-ghost tappable sound-row',
    onclick: () => { unlockAudio(); speak(x.eg.h, { rate: 0.6 }); },
  },
    h('b', { style: 'min-width:3.2rem;text-align:left;font-size:1.05rem' },
      x.p, x.trap ? h('span', { style: 'color:var(--warn)' }, ' ⚠') : null),
    h('span', { class: 'muted small', style: 'flex:1;text-align:left' }, x.say),
    h('span', { class: 'zh', style: 'font-size:1.15rem' }, x.eg.h),
    h('span', { class: 'muted small' }, x.eg.p));
}

/* ================= 3. How characters are built ================= */

function hanziPane(navigate, setMode) {
  const { characters } = getCorpus();
  const known = new Set(Object.keys(get().charCards || {}).filter((k) => get().charCards[k].reps > 0));

  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' },
      h('h1', {}, 'Characters'),
      h('p', { class: 'muted small', style: 'margin:0' }, characters.meta.why),
      h('div', { class: 'notice' },
        h('b', {}, 'You do not need these to speak. '),
        'Reading and speaking are separate skills. This track is here because you asked for it — ' +
        'but if progress here feels slow, it is not holding your speaking back.')),

    h('section', { class: 'card stack' },
      h('h2', {}, 'Stroke order — 8 rules cover almost everything'),
      h('p', { class: 'muted small', style: 'margin:0' },
        'Stroke order is not decoration: it makes characters legible, and handwriting input depends on it.'),
      ...characters.strokeRules.map((r) =>
        h('div', { class: 'row', style: 'gap:.7rem;padding:.4rem 0;border-bottom:1px solid var(--line)' },
          h('span', { class: 'zh', style: 'font-size:1.9rem;min-width:2.2rem' }, r.eg),
          h('div', { style: 'flex:1;min-width:170px' },
            h('b', { style: 'font-size:.92rem' }, r.rule),
            h('div', { class: 'muted small' }, r.note))))),

    h('section', { class: 'card stack' },
      h('h2', {}, `The building blocks (${characters.components.length})`),
      h('p', { class: 'muted small', style: 'margin:0' },
        'Characters are made of these, reused endlessly. Once you know a component, you can often guess ' +
        'what a new character is about — 讠 means it is spoken, 氵 means liquid, 忄 means a feeling.'),
      h('div', { class: 'comp-grid' },
        ...characters.components.map((c) =>
          h('div', { class: 'comp' },
            h('b', { class: 'zh' }, c.alt || c.c),
            c.alt ? h('span', { class: 'muted small zh' }, c.c) : null,
            h('span', {}, c.name),
            h('span', { class: 'muted small' }, c.meaning),
            h('span', { class: 'zh comp-in' }, (c.in || []).join(' ')))))),

    h('section', { class: 'card stack' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('h2', { style: 'margin:0' }, `Characters in this course (${characters.characters.length})`),
        h('span', { class: 'muted small' }, `${known.size} learned`)),
      h('p', { class: 'muted small', style: 'margin:0' },
        'Ordered by how often they appear in the sentences you are already studying.'),
      h('div', { class: 'char-grid' },
        ...characters.characters.map((c) =>
          h('button', {
            class: `btn tappable char-cell ${known.has(c.c) ? 'known' : ''}`,
            onclick: () => { unlockAudio(); speak(c.c, { rate: 0.6 }); },
            title: c.story,
          },
            h('b', { class: 'zh' }, c.c),
            h('i', {}, c.p),
            h('u', {}, c.e)))),
      h('button', { class: 'btn btn-primary btn-lg tappable', onclick: () => setMode('learn') },
        'Learn them with spaced repetition →')));
}

/* ================= 4. Character SRS ================= */

function learnPane(navigate, setMode) {
  const pane = h('div', { class: 'stack' });
  const { characters } = getCorpus();

  const due = dueCharCards();
  const fresh = newCharacters(get().settings.newCharsPerDay ?? 5);
  const queue = [...due, ...fresh];

  let i = 0;
  let revealed = false;
  let done = 0;

  if (!queue.length) {
    const st = charStats();
    pane.append(
      h('section', { class: 'card stack center' },
        h('h1', {}, 'No characters due'),
        h('p', { class: 'muted' },
          st.known === 0
            ? 'Nothing started yet — raise the daily new-character limit in Settings to begin.'
            : `${st.known} of ${characters.characters.length} started. Come back when the scheduler brings them round.`),
        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn btn-primary tappable', onclick: () => navigate('') }, 'Back to today'))));
    return pane;
  }

  const current = () => queue[i];

  function answer(g) {
    if (!revealed) return;
    const c = current();
    const card = charCardFor(c.c);
    const next = gradeCard(card, g, { requestRetention: get().settings.requestRetention });
    update((st) => { st.charCards[c.c] = next; });
    bumpDaily('chars');
    if (g === 1) queue.push(c);
    done++;
    signal(g === 1 ? 'partial' : 'correct');
    i++;
    revealed = false;
    if (i >= queue.length) return finish();
    render();
  }

  function finish() {
    cue('done');
    pane.replaceChildren(
      h('section', { class: 'card stack center' },
        h('h1', {}, '写完了 — done'),
        h('p', { class: 'muted' }, `${done} character${done === 1 ? '' : 's'} reviewed.`),
        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn btn-primary tappable', onclick: () => navigate('') }, 'Back to today'))));
  }

  function render() {
    const c = current();
    const card = charCardFor(c.c);
    const isNew = !(card.reps > 0);
    const ivls = previewIntervals(card, { requestRetention: get().settings.requestRetention });

    pane.replaceChildren(
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('span', { class: 'muted small' }, `${i + 1} / ${queue.length}`),
        h('span', { class: `pill ${isNew ? 'new' : 'review'}` }, isNew ? 'new' : 'review')),

      h('section', { class: 'card study' },
        h('div', { class: 'zh', style: 'font-size:clamp(4rem,26vw,7rem);font-weight:600;line-height:1' }, c.c),
        isNew || revealed
          ? h('div', { class: 'stack' },
              pinyinEl(c.p, 'pinyin'),
              h('div', { class: 'en', style: 'font-weight:600' }, c.e),
              h('div', { class: 'muted small' }, `${c.strokes} strokes · ${c.type.replace('-', ' ')}`),
              c.parts?.length
                ? h('div', { class: 'row', style: 'justify-content:center;gap:.3rem' },
                    h('span', { class: 'muted small' }, 'built from'),
                    ...c.parts.map((p) => h('span', { class: 'zh pill', style: 'font-size:1.1rem' }, p)))
                : null,
              h('div', { class: 'notice' }, c.story),
              h('button', { class: 'btn tappable', onclick: () => { unlockAudio(); speak(c.c, { rate: 0.6 }); } }, '🔊 Hear it'))
          : h('div', { class: 'muted small' }, 'What does this mean, and how is it said?')),

      isNew || revealed
        ? h('div', { class: 'stack' },
            h('div', { class: 'grades' },
              gradeBtn(1, 'Again', ivls[1]), gradeBtn(2, 'Hard', ivls[2]),
              gradeBtn(3, 'Good', ivls[3]), gradeBtn(4, 'Easy', ivls[4])))
        : h('div', { class: 'center' },
            h('button', { class: 'btn btn-primary btn-lg tappable', onclick: () => { revealed = true; render(); } }, 'Show answer')),
    );
  }

  function gradeBtn(g, label, ms) {
    return h('button', { class: 'btn grade tappable', dataset: { g: String(g) }, onclick: () => answer(g) },
      h('b', {}, label), h('small', {}, formatInterval(ms)));
  }

  render();
  return pane;
}
