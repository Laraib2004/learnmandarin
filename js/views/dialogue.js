import { h, pinyinEl, keys, shuffle } from '../ui.js';
import { getCorpus, availableDialogues } from '../deck.js';
import { speak } from '../tts.js';
import * as asr from '../asr.js';
import { get, update, bumpDaily } from '../store.js';
import { signal, cue, unlockAudio, toast } from '../feedback.js';

/**
 * Dialogue — the only view where both directions run in one activity.
 *
 * A conversation is two skills alternating:
 *   partner turn -> you hear Mandarin and must recover meaning   (ZH -> EN)
 *   your turn    -> you hold an intention and must produce it    (EN -> ZH)
 *
 * Training only one direction produces the two classic failures: learners who
 * can recite but not reply, and learners who understand but freeze. So every
 * dialogue alternates, and neither direction can be skipped.
 *
 * Partner turns are audio-first by design — the Chinese is hidden until you
 * commit to an answer, because in a real conversation there are no subtitles.
 */
export default function dialogue(root, { navigate }) {
  const corpus = getCorpus();
  const list = availableDialogues();

  let convo = null;
  let idx = 0;
  let phase = 'prompt';     // prompt | answered
  let chosen = null;        // comprehension choice
  let last = null;          // ASR result
  let listening = false;
  let correct = 0;
  let attempts = 0;

  const pane = h('div', { class: 'stack' });
  root.append(pane);

  /* ---------------- picker ---------------- */

  function picker() {
    const done = get().dialogues || {};
    return h('div', { class: 'stack' },
      h('section', { class: 'card stack' },
        h('h1', {}, 'Conversations'),
        h('p', { class: 'muted small', style: 'margin:0' }, corpus.dialoguesMeta.why)),
      ...list.map((d) => {
        const rec = done[d.id];
        const stage = corpus.stageById[d.stage];
        return h('button', {
          class: 'card tappable', style: 'text-align:left;width:100%;border:1px solid var(--line)',
          onclick: () => { unlockAudio(); startConvo(d); },
        },
          h('div', { class: 'row', style: 'justify-content:space-between;gap:.5rem' },
            h('b', {}, d.title),
            h('span', { class: 'pill' }, `${stage.level}`)),
          h('div', { class: 'muted small' }, d.setting),
          h('div', { class: 'row small muted', style: 'margin-top:.35rem;gap:.7rem' },
            h('span', {}, `${d.turns.length} turns`),
            rec?.best ? h('span', { style: 'color:var(--good)' }, `best ${rec.best}%`) : null));
      }));
  }

  function startConvo(d) {
    convo = d;
    idx = 0;
    correct = 0;
    attempts = 0;
    reset();
    paint();
    autoplay();
  }

  const reset = () => { phase = 'prompt'; chosen = null; last = null; };
  const turn = () => convo.turns[idx];

  function autoplay() {
    const t = turn();
    if (t && t.who === 'partner') speak(t.hanzi);
  }

  /* ---------------- comprehension (ZH -> EN) ---------------- */

  /**
   * Distractors come from other dialogues at the same stage where possible, so
   * the wrong answers are plausible Chinese rather than obvious filler. A
   * comprehension check you can pass by elimination teaches nothing.
   */
  function choicesFor(t) {
    const pool = corpus.dialogues
      .flatMap((d) => d.turns)
      .filter((x) => x.en !== t.en);
    const sameStage = corpus.dialogues
      .filter((d) => d.stage === convo.stage)
      .flatMap((d) => d.turns)
      .filter((x) => x.en !== t.en);
    const source = sameStage.length >= 3 ? sameStage : pool;
    const seen = new Set([t.en]);
    const picks = [];
    for (const cand of shuffle(source)) {
      if (seen.has(cand.en)) continue;
      seen.add(cand.en);
      picks.push(cand);
      if (picks.length === 3) break;
    }
    return shuffle([t, ...picks]);
  }

  let cachedChoices = null;
  function comprehensionChoices(t) {
    if (!cachedChoices || cachedChoices.key !== `${convo.id}:${idx}`) {
      cachedChoices = { key: `${convo.id}:${idx}`, items: choicesFor(t) };
    }
    return cachedChoices.items;
  }

  function chooseMeaning(item) {
    if (phase === 'answered') return;
    chosen = item;
    phase = 'answered';
    attempts++;
    const right = item.en === turn().en;
    if (right) correct++;
    signal(right ? 'correct' : 'wrong',
      right ? 'Understood' : 'Not quite — read the Chinese now');
    recordTurn(right ? 100 : 0);
    paint();
  }

  /* ---------------- production (EN -> ZH) ---------------- */

  async function attempt() {
    if (listening || !asr.isSupported()) return;
    unlockAudio();
    listening = true;
    cue('listening');
    paint();
    try {
      const result = await asr.listen({ timeoutMs: 8000 });
      const scored = asr.score(turn().hanzi, result);
      last = scored;
      phase = 'answered';
      attempts++;
      if (scored.score >= 80) correct++;
      signal(scored.score >= 90 ? 'correct' : scored.score >= 60 ? 'partial' : 'wrong',
        scored.score >= 90 ? 'Clear' : scored.score >= 60 ? 'Close' : 'Not understood');
      recordTurn(scored.score);
    } catch (err) {
      last = { error: err.message };
      phase = 'answered';
      signal('wrong');
    } finally {
      listening = false;
      paint();
    }
  }

  function recordTurn(score) {
    update((st) => {
      st.dialogues = st.dialogues || {};
      const rec = st.dialogues[convo.id] || { runs: 0, best: 0, turns: 0 };
      rec.turns++;
      st.dialogues[convo.id] = rec;
    });
    bumpDaily('speak');
  }

  function revealAnswer() {
    phase = 'answered';
    paint();
    speak(turn().hanzi);
  }

  function next() {
    if (idx >= convo.turns.length - 1) return finish();
    idx++;
    reset();
    paint();
    autoplay();
  }

  function finish() {
    const pct = attempts ? Math.round((correct / attempts) * 100) : 0;
    update((st) => {
      st.dialogues = st.dialogues || {};
      const rec = st.dialogues[convo.id] || { runs: 0, best: 0, turns: 0 };
      rec.runs++;
      rec.best = Math.max(rec.best, pct);
      st.dialogues[convo.id] = rec;
    });
    cue('done');
    pane.replaceChildren(
      h('section', { class: 'card stack center' },
        h('h1', {}, '聊完了 — conversation complete'),
        h('div', { class: 'score', style: `color:${pct >= 80 ? 'var(--good)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)'}` }, `${pct}%`),
        h('p', { class: 'muted' }, `${correct} of ${attempts} turns handled — both understanding and speaking.`),
        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn btn-primary', onclick: () => startConvo(convo) }, 'Run it again'),
          h('button', { class: 'btn', onclick: () => { convo = null; paint(); } }, 'Another conversation'),
          h('button', { class: 'btn btn-ghost', onclick: () => navigate('') }, 'Home'))));
  }

  /* ---------------- render ---------------- */

  function paint() {
    if (!convo) { pane.replaceChildren(picker()); return; }

    const t = turn();
    const answered = phase === 'answered';
    const showHanzi = get().settings.showHanzi;
    const isPartner = t.who === 'partner';

    pane.replaceChildren(
      h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
        h('button', { class: 'btn btn-ghost tappable', onclick: () => { convo = null; paint(); } }, '← Conversations'),
        h('span', { class: 'muted small' }, `${idx + 1} / ${convo.turns.length}`)),

      h('div', { class: 'bar' }, h('i', { style: `width:${((idx) / convo.turns.length) * 100}%` })),

      transcript(),

      h('section', { class: 'card study' },
        h('span', { class: `pill ${isPartner ? 'new' : 'learning'}` },
          isPartner ? 'Listen — what did they say?' : 'Your turn — say it in Chinese'),

        isPartner ? partnerTurn(t, answered, showHanzi) : yourTurn(t, answered, showHanzi)),

      h('p', { class: 'muted small center' },
        isPartner
          ? [h('kbd', {}, '1–4'), ' choose · ', h('kbd', {}, 'R'), ' replay']
          : [h('kbd', {}, 'Space'), ' record · ', h('kbd', {}, 'S'), ' show · ', h('kbd', {}, 'Enter'), ' next']),
    );
  }

  /** What has already been said, so the conversation reads as a conversation. */
  function transcript() {
    if (idx === 0) return h('div', { class: 'muted small center' }, convo.setting);
    const shown = convo.turns.slice(Math.max(0, idx - 3), idx);
    return h('div', { class: 'transcript' },
      ...shown.map((t) =>
        h('div', { class: `bubble ${t.who}` },
          h('div', { class: 'zh', style: 'font-size:1.05rem' }, t.hanzi),
          h('div', { class: 'muted small' }, t.en))));
  }

  function partnerTurn(t, answered, showHanzi) {
    const choices = comprehensionChoices(t);
    return h('div', { class: 'stack' },
      h('div', { class: 'muted small' }, convo.partner),
      h('button', { class: 'mic tappable', onclick: () => speak(t.hanzi), 'aria-label': 'Play again' }, '🔊'),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn btn-ghost tappable', onclick: () => speak(t.hanzi, { rate: 0.5 }) }, 'Slower')),

      answered && showHanzi ? h('div', { class: 'zh zh-lg' }, t.hanzi) : null,
      answered ? pinyinEl(t.pinyin) : h('div', { class: 'muted small' }, 'No subtitles — this is what a real conversation sounds like.'),

      h('div', { class: 'choices', style: 'margin-top:.5rem' },
        ...choices.map((c, i) =>
          h('button', {
            class: `btn choice tappable ${answered ? (c.en === t.en ? 'correct' : c === chosen ? 'wrong' : '') : ''}`,
            style: 'font-family:var(--font);font-size:.95rem;line-height:1.3',
            disabled: answered,
            onclick: () => chooseMeaning(c),
          }, c.en))),

      answered
        ? h('div', { class: 'stack' },
            t.note ? h('div', { class: 'notice' }, t.note) : null,
            h('button', { class: 'btn btn-primary btn-lg tappable', onclick: next }, 'Continue →'))
        : null);
  }

  function yourTurn(t, answered, showHanzi) {
    return h('div', { class: 'stack' },
      h('div', { class: 'en', style: 'font-size:1.35rem;font-weight:650' }, t.en),
      h('div', { class: 'muted small' }, 'Say this in Mandarin'),

      answered
        ? h('div', { class: 'stack' },
            showHanzi ? h('div', { class: 'zh zh-lg' }, t.hanzi) : null,
            pinyinEl(t.pinyin),
            t.note ? h('div', { class: 'notice' }, t.note) : null)
        : null,

      asr.isSupported()
        ? h('div', { class: 'stack' },
            h('button', {
              class: `mic tappable ${listening ? 'live' : ''}`, onclick: attempt, disabled: listening,
              'aria-label': listening ? 'Listening' : 'Record your reply',
            }, listening ? '●' : '🎤'),
            h('div', { class: 'muted small' }, listening ? 'Listening…' : 'Tap and reply'))
        : h('div', { class: 'notice warn' },
            'Speech scoring needs Chrome, Edge, or Safari. Say it aloud, then reveal and check yourself.'),

      last ? verdict(last) : null,

      h('div', { class: 'row', style: 'justify-content:center;margin-top:.3rem' },
        !answered ? h('button', { class: 'btn tappable', onclick: revealAnswer }, 'Show answer') : null,
        answered ? h('button', { class: 'btn tappable', onclick: () => speak(t.hanzi) }, '🔊 Play') : null,
        answered ? h('button', { class: 'btn btn-primary btn-lg tappable', onclick: next }, 'Continue →') : null));
  }

  function verdict(result) {
    if (result.error) {
      return h('div', { class: 'notice warn' },
        result.error === 'no-speech' ? 'Did not catch that — try again a bit louder.'
          : result.error === 'not-allowed' ? 'Microphone blocked. Allow it in your browser settings.'
          : `Recognition failed: ${result.error}`);
    }
    const { score, marks, exact } = result;
    const colour = score >= 90 ? 'var(--good)' : score >= 60 ? 'var(--warn)' : 'var(--bad)';
    return h('div', { class: 'stack' },
      h('div', { class: 'score', style: `color:${colour}` }, `${score}%`),
      h('div', { class: 'marks' }, ...marks.map((m) => h('span', { class: `mark ${m.ok ? 'ok' : 'bad'}` }, m.char))),
      h('div', { class: 'muted small' },
        exact ? 'Exactly right — they would have understood you.'
          : score >= 80 ? 'Close enough to be understood; check the marked syllables.'
          : 'They would not have caught that. Play it and copy the melody.'));
  }

  const off = keys({
    ' ': () => (convo && turn().who === 'you' ? attempt() : null),
    s: () => (convo && turn().who === 'you' ? revealAnswer() : null),
    S: () => (convo && turn().who === 'you' ? revealAnswer() : null),
    r: () => (convo ? speak(turn().hanzi) : null),
    R: () => (convo ? speak(turn().hanzi) : null),
    Enter: () => (convo && phase === 'answered' ? next() : null),
    1: () => pick(0), 2: () => pick(1), 3: () => pick(2), 4: () => pick(3),
  });

  function pick(i) {
    if (!convo || turn().who !== 'partner' || phase === 'answered') return;
    const c = comprehensionChoices(turn())[i];
    if (c) chooseMeaning(c);
  }

  paint();
  return off;
}
