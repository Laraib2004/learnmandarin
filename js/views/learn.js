import { h, pinyinEl, shuffle, autoSandhi, spokenNote, trapNotes } from '../ui.js';
import { getCorpus, seedFromLesson, seedCharsFromLesson, lookupGlyph } from '../deck.js';
import { speak, initVoices, hasChineseVoice } from '../tts.js';
import { voiceHelpCard } from '../voicehelp.js';
import * as pitch from '../pitch.js';
import * as asr from '../asr.js';
import { get, update, bumpDaily, saveSession, clearSession } from '../store.js';
import { signal, cue, unlockAudio } from '../feedback.js';

/**
 * The guided path — the app's front door.
 *
 * Design rule: at any moment there is exactly ONE thing on screen and ONE
 * button. No menus, no choosing what to study, no way to get lost. A beginner
 * who has to decide where to start will not start.
 *
 * Order is deliberate and was the learner's own instinct: pinyin first (you
 * cannot learn a word whose sound you cannot decode), then common words, then
 * sentences, with reading checks folded in once the sounds are solid.
 *
 * Position is saved after every single step, so closing the tab mid-lesson
 * costs nothing.
 */
export default function learn(root, { navigate }) {
  const { lessons } = getCorpus();
  const all = lessons.lessons;

  const progress = () => get().lessons || { done: [], current: null, step: 0 };

  let lesson = null;
  let stepIndex = 0;
  let answered = null;     // { correct, chosen }
  let spoken = null;       // ASR result

  const pane = h('div', { class: 'stack' });
  // Persistent live region: content inserted by paint() is brand new each
  // time, and screen readers do not reliably announce a region that was just
  // created. This one outlives every repaint, so "Correct — …" is heard.
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  root.append(pane, live);
  let focusedStep = null;

  /* ---------------- choosing what is next (there is only one answer) ------ */

  const doneSet = () => new Set(progress().done);
  const nextLesson = () => all.find((l) => !doneSet().has(l.id)) || all[all.length - 1];

  function start(l, atStep = 0) {
    unlockAudio();
    pitch.unlock();
    lesson = l;
    stepIndex = atStep;
    answered = null;
    spoken = null;
    update((s) => {
      s.lessons = s.lessons || { done: [], current: null, step: 0 };
      s.lessons.current = l.id;
      s.lessons.step = atStep;
    });
    saveSession('learn', { id: l.id, step: atStep, title: l.title });
    paint();
    autoplay();
  }

  const step = () => lesson.steps[stepIndex];

  function autoplay() {
    const s = step();
    if (!s) return;
    if (s.type === 'pickTone') setTimeout(() => pitch.playTone(s.answer), 250);
    // A new word is a word: with a real Mandarin voice, play the word itself.
    // The bare tone contour is the fallback for a device with no voice — tone
    // *teaching* steps still always use the contour (see CLAUDE.md, Audio).
    else if (s.type === 'word' && hasChineseVoice()) setTimeout(() => speak(s.hanzi), 250);
    else if (s.tone) setTimeout(() => pitch.playTone(s.tone), 250);
    else if (s.speak) setTimeout(() => speak(s.speak), 250);
    else if (s.type === 'word') setTimeout(() => speak(s.hanzi), 250);
    else if (s.type === 'char' && lookupGlyph(s.c)?.kind === 'char') setTimeout(() => speak(s.c), 250);
  }

  function advance() {
    // Wake audio inside the tap itself: autoplay() fires 250ms later, and iOS
    // only lets a tap resume audio synchronously.
    unlockAudio();
    pitch.unlock();
    answered = null;
    spoken = null;
    if (stepIndex >= lesson.steps.length - 1) return finishLesson();
    stepIndex++;
    update((s) => { s.lessons.step = stepIndex; });
    saveSession('learn', { id: lesson.id, step: stepIndex, title: lesson.title });
    paint();
    autoplay();
  }

  function finishLesson() {
    update((s) => {
      s.lessons = s.lessons || { done: [], current: null, step: 0 };
      if (!s.lessons.done.includes(lesson.id)) s.lessons.done.push(lesson.id);
      s.lessons.current = null;
      s.lessons.step = 0;
    });
    bumpDaily('lesson');
    // Hand what was just taught to the scheduler, or the path and Review stay
    // two disconnected apps and the queue is empty after eighteen lessons.
    const seeded = seedFromLesson(lesson);
    // Characters taught here join the Script track's own schedule, never the
    // sentence queue — reading stays optional and separate from speaking.
    const seededChars = seedCharsFromLesson(lesson);
    clearSession();
    cue('done');

    const finished = lesson;
    const upcoming = all.find((l) => !doneSet().has(l.id));
    lesson = null;

    pane.replaceChildren(
      h('section', { class: 'card stack center' },
        h('div', { style: 'font-size:2.6rem' }, '✓'),
        h('h1', {}, 'Lesson complete'),
        h('p', { class: 'muted' }, finished.title),
        h('p', { class: 'muted small' },
          `${doneSet().size} of ${all.length} lessons done.`),
        seeded.length
          ? h('div', { class: 'notice' },
              `${seeded.length} phrase${seeded.length === 1 ? '' : 's'} added to your review schedule — they will come back tomorrow so they stick.`)
          : null,
        seededChars.length
          ? h('div', { class: 'notice' },
              `${seededChars.length} character${seededChars.length === 1 ? '' : 's'} added to the Script tab's reading practice.`)
          : null,
        upcoming
          ? h('div', { class: 'stack' },
              h('div', { class: 'notice' }, h('b', {}, 'Next: '), upcoming.title),
              h('button', { class: 'btn btn-primary btn-lg tappable', onclick: () => start(upcoming) },
                'Start the next lesson'),
              h('button', { class: 'btn btn-ghost tappable', onclick: () => { paint(); } }, 'Stop here for today'))
          : h('div', { class: 'stack' },
              h('p', {}, 'That is every lesson on the path so far.'),
              h('button', { class: 'btn btn-primary tappable', onclick: () => navigate('review') }, 'Keep it fresh with Review'))));
  }

  /* ---------------- the home screen of the path ---------------- */

  function overview() {
    const p = progress();
    const done = doneSet();
    const next = nextLesson();
    const resuming = p.current && p.step > 0 ? all.find((l) => l.id === p.current) : null;
    const pct = Math.round((done.size / all.length) * 100);

    return h('div', { class: 'stack' },
      audioWarning(),

      h('section', { class: 'hero stack' },
        h('div', { class: 'muted small' },
          resuming ? 'You stopped part-way through' : done.size === 0 ? 'Start here' : 'Next lesson'),
        h('h1', { style: 'margin:0' },
          resuming ? resuming.title : next.title),
        h('p', { class: 'muted', style: 'margin:0' },
          resuming
            ? `Step ${p.step + 1} of ${resuming.steps.length}. Nothing is lost — carry on where you left off.`
            : `About ${next.minutes} minutes. ${lessonsMeta().why}`),
        h('button', {
          class: 'btn btn-primary btn-lg tappable', style: 'width:100%',
          onclick: () => start(resuming || next, resuming ? p.step : 0),
        }, resuming ? 'Carry on' : done.size === 0 ? 'Begin lesson 1' : 'Start this lesson'),
        resuming
          ? h('button', { class: 'btn btn-ghost tappable', onclick: () => start(resuming, 0) }, 'Restart this lesson')
          : null),

      h('div', { class: 'stack', style: 'gap:.3rem' },
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('span', { class: 'muted small' }, `${done.size} of ${all.length} lessons`),
          h('span', { class: 'muted small' }, `${pct}%`)),
        h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` }))),

      ...lessons.units.map((u) => {
        const mine = all.filter((l) => l.unit === u.id);
        return h('section', { class: 'card stack' },
          h('h2', {}, u.title),
          h('div', { class: 'muted small' }, u.goal),
          h('div', { class: 'stack', style: 'gap:.3rem' },
            ...mine.map((l, i) => {
              const isDone = done.has(l.id);
              const isNext = l.id === (resuming?.id || next.id);
              const locked = !isDone && !isNext && all.indexOf(l) > all.indexOf(resuming || next);
              return h('button', {
                class: `btn tappable lesson-row ${isNext ? 'btn-primary' : ''}`,
                disabled: locked,
                onclick: () => start(l, 0),
              },
                h('span', { class: `lesson-dot ${isDone ? 'done' : isNext ? 'now' : ''}` },
                  isDone ? '✓' : String(all.indexOf(l) + 1)),
                h('span', { style: 'flex:1;text-align:left' }, l.title),
                h('span', { class: 'muted small' }, locked ? '' : `${l.minutes}m`));
            })));
      }));
  }

  const lessonsMeta = () => lessons.meta;

  /** No Mandarin voice installed is THE silent killer — say so loudly. */
  // Voices load asynchronously; judging before they arrive flashes a false alarm.
  function audioWarning() {
    const slot = h('div', { style: 'display:contents' });
    initVoices().then(() => { const card = voiceHelpCard(); if (card) slot.append(card); });
    return slot;
  }

  /* ---------------- rendering one step ---------------- */

  function paint() {
    if (!lesson) { pane.replaceChildren(overview()); return; }

    const s = step();
    const n = lesson.steps.length;
    const pct = Math.round((stepIndex / n) * 100);

    // Read before repainting: browsers only move focus off a removed element on
    // the next frame, so afterwards activeElement still points at the old node.
    const hadFocus = Boolean(pane.contains?.(globalThis.document?.activeElement));
    const card = h('section', { class: 'card study', tabindex: '-1', 'aria-label': `Step ${stepIndex + 1} of ${n}` },
      ...renderStep(s));

    pane.replaceChildren(
      h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
        h('button', { class: 'btn btn-ghost tappable', onclick: () => { lesson = null; paint(); } }, '← Path'),
        h('span', { class: 'muted small' }, `${stepIndex + 1} / ${n}`)),
      h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
      h('div', { class: 'muted small center' }, lesson.title),

      card,

      footer(s),
    );

    // A repaint destroys the focused button, dropping keyboard and screen-reader
    // users back at the top of the document. Land them on the new step instead —
    // once per step, so answering a question does not yank focus away.
    const key = `${lesson.id}:${stepIndex}`;
    if (focusedStep !== key) {
      focusedStep = key;
      card.focus({ preventScroll: true });
    } else if (hadFocus) {
      // Answering destroyed the chosen button; the next thing to do is continue.
      pane.querySelector('.btn-primary')?.focus({ preventScroll: true });
    }
    announce(s);
  }

  /** Say the result out loud to screen readers, exactly once per answer. */
  function announce(s) {
    if (answered && !answered.announced) {
      answered.announced = true;
      const why = answered.chosen.why;
      // Most explanations already open with the verdict ("Right — …").
      const verdict = /^(correct|right|exactly|yes|no|not|close)\b/i.test(why) ? ''
        : answered.correct ? 'Correct. ' : 'Not quite. ';
      live.textContent = s.type === 'pickTone'
        ? (answered.correct ? `Correct — tone ${s.answer}.` : `Not quite. That was tone ${s.answer}.`)
        : verdict + why;
    } else if (spoken && spoken.score != null && !spoken.announced) {
      spoken.announced = true;
      live.textContent = `${spoken.score}% — ${spoken.score >= 70 ? 'understood' : 'not quite, try once more'}.`;
    }
  }

  /** Same playback at a slower rate — but never below ~0.6, which flattens tones. */
  const slower = (text) =>
    h('button', { class: 'btn btn-ghost tappable', onclick: () => { unlockAudio(); speak(text, { rate: 0.65 }); } }, 'Slower');

  function renderStep(s) {
    switch (s.type) {
      case 'teach': return teachStep(s);
      case 'tones': return tonesStep(s);
      case 'pickTone': return pickToneStep(s);
      case 'pick': return pickStep(s);
      case 'read': return readStep(s);
      case 'word': return wordStep(s);
      case 'speak': return speakStep(s);
      case 'char': return charStep(s);
      default: return [h('div', { class: 'muted' }, `Unknown step: ${s.type}`)];
    }
  }

  function teachStep(s) {
    return [
      h('h2', { style: 'margin:0' }, s.title),
      s.big ? h('div', { class: 'zh zh-lg' }, s.big) : null,
      s.pinyin ? pinyinEl(s.pinyin) : null,
      s.big ? charBreakdown(s.big) : null,
      s.tone
        ? h('div', { class: 'stack' },
            h('div', { class: 'contour', onclick: () => pitch.playTone(s.tone) }, pitch.contourSVG(s.tone)),
            h('button', { class: 'btn tappable', onclick: () => pitch.playTone(s.tone) }, '🔊 Hear the shape'))
        : null,
      h('p', { class: 'muted', style: 'margin:.2rem 0 0;text-align:left' }, s.body),
      s.speak
        ? h('button', { class: 'btn tappable', onclick: () => { unlockAudio(); speak(s.speak); } }, '🔊 Hear it')
        : null,
    ];
  }

  function tonesStep(s) {
    return [
      h('h2', { style: 'margin:0' }, s.title),
      h('p', { class: 'muted small', style: 'text-align:left' }, s.body),
      h('div', { class: 'contour-row' },
        ...s.items.map((t) =>
          h('button', { class: 'btn tappable contour-btn', onclick: () => pitch.playTone(t) },
            pitch.contourSVG(t),
            h('b', {}, `Tone ${t}`),
            h('span', { class: 'muted small' }, pitch.CONTOURS[t].label)))),
      h('button', { class: 'btn tappable', onclick: () => pitch.playSequence(s.items) }, '▶ Play all in order'),
    ];
  }

  function pickToneStep(s) {
    const opts = s.only || [1, 2, 3, 4];
    return [
      h('h2', { style: 'margin:0' }, s.question),
      h('button', { class: 'mic tappable', 'aria-label': 'Play the tone again', onclick: () => pitch.playTone(s.answer) }, '🔊'),
      h('div', { class: 'muted small' }, 'Tap to hear it again'),
      h('div', { class: 'choices' },
        ...opts.map((t) =>
          h('button', {
            class: `btn choice tappable ${answered ? (t === s.answer ? 'correct' : t === answered.chosen ? 'wrong' : '') : ''}`,
            disabled: Boolean(answered),
            onclick: () => {
              answered = { correct: t === s.answer, chosen: t };
              signal(answered.correct ? 'correct' : 'wrong');
              bumpDaily('lesson');
              paint();
            },
          },
            pitch.contourSVG(t, { w: 64, h: 38 }),
            h('div', { style: 'font-family:var(--font);font-size:.9rem;font-weight:650' }, `Tone ${t}`)))),
      answered
        ? h('div', { class: 'notice' },
            answered.correct
              ? `Correct — tone ${s.answer}, ${pitch.CONTOURS[s.answer].label}.`
              : `That was tone ${s.answer} — ${pitch.CONTOURS[s.answer].label}. Play it once more before moving on.`)
        : null,
    ];
  }

  function pickStep(s) {
    if (!s._shuffled) s._shuffled = shuffle(s.options);
    return [
      s.big ? h('div', { class: 'zh zh-xl' }, s.big) : null,
      h('h2', { style: 'margin:0;font-size:1.05rem' }, s.question),
      h('div', { class: 'choices' },
        ...s._shuffled.map((o) =>
          h('button', {
            class: `btn choice tappable ${answered ? (o.correct ? 'correct' : o === answered.chosen ? 'wrong' : '') : ''}`,
            style: 'font-family:var(--font);font-size:.95rem;line-height:1.35',
            disabled: Boolean(answered),
            onclick: () => {
              answered = { correct: Boolean(o.correct), chosen: o };
              signal(o.correct ? 'correct' : 'wrong');
              bumpDaily('lesson');
              paint();
            },
          }, o.label))),
      answered ? h('div', { class: 'notice' }, answered.chosen.why) : null,
    ];
  }

  function readStep(s) {
    if (!s._shuffled) s._shuffled = shuffle(s.options);
    return [
      h('div', { class: 'muted small' }, 'Read this out loud first'),
      pinyinEl(s.pinyin, 'pinyin'),
      h('h2', { style: 'margin:.2rem 0;font-size:1rem' }, s.question),
      h('div', { class: 'choices' },
        ...s._shuffled.map((o) =>
          h('button', {
            class: `btn choice tappable ${answered ? (o.correct ? 'correct' : o === answered.chosen ? 'wrong' : '') : ''}`,
            style: 'font-family:var(--font);font-size:.95rem',
            disabled: Boolean(answered),
            onclick: () => {
              answered = { correct: Boolean(o.correct), chosen: o };
              signal(o.correct ? 'correct' : 'wrong');
              bumpDaily('lesson');
              paint();
            },
          }, o.label))),
      answered ? h('div', { class: 'notice' }, answered.chosen.why) : null,
    ];
  }

  function wordStep(s) {
    return [
      h('div', { class: 'muted small' }, 'New word'),
      h('div', { class: 'zh zh-xl' }, s.hanzi),
      pinyinEl(s.pinyin),
      spokenNote(s.pinyin, s.spoken || autoSandhi(s.pinyin)),
      h('div', { class: 'en', style: 'font-weight:600' }, s.en),
      charBreakdown(s.hanzi),
      trapNotes(s.pinyin),
      s.tone
        ? h('div', { class: 'contour', onclick: () => pitch.playTone(s.tone) }, pitch.contourSVG(s.tone))
        : null,
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn tappable', onclick: () => { unlockAudio(); speak(s.hanzi); } }, '🔊 Hear it'),
        slower(s.hanzi),
        s.tone
          ? h('button', { class: 'btn btn-ghost tappable', onclick: () => pitch.playTone(s.tone) }, 'Tone shape')
          : null),
      s.note ? h('div', { class: 'notice' }, s.note) : null,
    ];
  }

  /**
   * One character or building block, taught as meaning + parts + story.
   * Never as a shape to memorise: knowing 亻 is "person" is what lets a learner
   * guess the next character instead of starting from zero.
   */
  function charStep(s) {
    const g = lookupGlyph(s.c);
    if (!g) return [h('div', { class: 'muted' }, `Unknown character: ${s.c}`)];
    const glyph = (text) =>
      h('div', { class: 'zh', style: 'font-size:clamp(3.4rem,20vw,5rem);font-weight:600;line-height:1.1' }, text);

    if (g.kind === 'component') {
      const c = g.entry;
      return [
        h('div', { class: 'muted small' }, 'Building block'),
        glyph(s.c),
        h('div', { class: 'en', style: 'font-weight:650' }, c.name),
        h('div', { class: 'muted small' }, c.meaning),
        c.alt && s.c === c.alt
          ? h('div', { class: 'muted small' }, 'A squeezed form of ', h('span', { class: 'zh' }, c.c),
              ' — it shrinks like this when it sits beside something else.')
          : null,
        c.in?.length
          ? h('div', { class: 'stack', style: 'gap:.3rem' },
              h('div', { class: 'muted small' }, 'You will find it inside'),
              h('div', { class: 'row', style: 'justify-content:center;gap:.35rem' },
                ...c.in.map((ch) => h('span', { class: 'zh pill', style: 'font-size:1.2rem' }, ch))))
          : null,
        s.note ? h('div', { class: 'notice' }, s.note) : null,
      ];
    }

    const c = g.entry;
    return [
      h('div', { class: 'muted small' }, 'Character'),
      glyph(c.c),
      pinyinEl(c.p),
      h('div', { class: 'en', style: 'font-weight:650' }, c.e),
      partsRow(c),
      h('div', { class: 'notice' }, c.story),
      s.note ? h('div', { class: 'notice' }, s.note) : null,
      h('button', { class: 'btn tappable', onclick: () => { unlockAudio(); speak(c.c); } }, '🔊 Hear it'),
    ];
  }

  const glyphName = (p) => {
    const g = lookupGlyph(p);
    return g ? (g.kind === 'component' ? g.entry.name : g.entry.e) : null;
  };

  function partsRow(c) {
    if (!c.parts?.length) return null;
    return h('div', { class: 'row', style: 'justify-content:center;gap:.4rem;align-items:center' },
      h('span', { class: 'muted small' }, 'built from'),
      ...c.parts.map((p) =>
        h('span', { class: 'pill', style: 'font-size:.85rem;display:inline-flex;gap:.3rem;align-items:center' },
          h('span', { class: 'zh', style: 'font-size:1.15rem' }, p),
          glyphName(p) ? h('span', {}, glyphName(p)) : null)));
  }

  /**
   * "What do these characters mean?" answered in place, under every word.
   * A beginner staring at 谢谢 has no way to know it is one character twice,
   * or that the 讠 inside it means speech — so show them.
   */
  function charBreakdown(text) {
    const seen = new Set();
    const known = [];
    for (const ch of String(text || '')) {
      if (!/[\u4e00-\u9fff]/.test(ch) || seen.has(ch)) continue;
      seen.add(ch);
      const g = lookupGlyph(ch);
      if (g?.kind === 'char') known.push(g.entry);
    }
    if (!known.length) return null;
    return h('div', { class: 'char-breakdown' },
      h('div', { class: 'muted small' }, known.length === 1 ? 'What the character means' : 'What each character means'),
      ...known.map((c) =>
        h('div', { class: 'char-line' },
          h('span', { class: 'zh' }, c.c),
          h('span', {},
            h('b', {}, c.e),
            h('span', { class: 'muted small' }, ` · ${c.p}`),
            c.parts?.length
              ? h('span', { class: 'muted small' }, ' · ',
                  c.parts.map((p) => (glyphName(p) ? `${p} ${glyphName(p)}` : p)).join(' + '))
              : null))));
  }

  function speakStep(s) {
    return [
      h('div', { class: 'muted small' }, s.prompt),
      h('div', { class: 'zh zh-lg' }, s.target),
      pinyinEl(s.pinyin),
      spokenNote(s.pinyin, s.spoken || autoSandhi(s.pinyin)),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn tappable', onclick: () => { unlockAudio(); speak(s.target); } }, '🔊 Hear it'),
        slower(s.target)),
      asr.isSupported()
        ? h('div', { class: 'stack' },
            h('button', {
              class: `mic tappable ${spoken === 'listening' ? 'live' : ''}`,
              'aria-label': spoken === 'listening' ? 'Listening' : 'Record yourself saying it',
              disabled: spoken === 'listening',
              onclick: async () => {
                unlockAudio();
                spoken = 'listening';
                cue('listening');
                paint();
                try {
                  const r = await asr.listen({ timeoutMs: 8000 });
                  spoken = asr.score(s.target, r);
                  signal(spoken.score >= 70 ? 'correct' : spoken.score >= 40 ? 'partial' : 'wrong');
                  bumpDaily('speak');
                } catch (err) {
                  spoken = { error: err.message };
                }
                paint();
              },
            }, spoken === 'listening' ? '●' : '🎤'),
            h('div', { class: 'muted small' },
              spoken === 'listening' ? 'Listening…' : 'Tap and say it out loud'))
        : h('div', { class: 'notice' },
            'Say it out loud anyway — this browser cannot score you, but the speaking still counts.'),
      spoken && spoken !== 'listening' ? speakVerdict(spoken) : null,
    ];
  }

  function speakVerdict(r) {
    if (r.error) {
      return h('div', { class: 'notice warn' },
        r.error === 'no-speech' ? 'Did not catch that — try again a little louder.'
          : r.error === 'not-allowed' ? 'Microphone blocked. Allow it in your browser settings.'
          : `Could not score that: ${r.error}. Carry on regardless.`);
    }
    const colour = r.score >= 70 ? 'var(--good)' : r.score >= 40 ? 'var(--warn)' : 'var(--bad)';
    return h('div', { class: 'stack' },
      h('div', { class: 'score', style: `color:${colour}` }, `${r.score}%`),
      h('div', { class: 'marks' },
        ...r.marks.map((m) => h('span', { class: `mark ${m.ok ? 'ok' : 'bad'}` }, m.char))),
      h('div', { class: 'muted small' },
        r.score >= 70 ? 'Understood. Move on.'
          : 'Not quite — but do not get stuck here. Play it, copy it once, and continue.'));
  }

  /** One button. Always one button. */
  function footer(s) {
    const needsAnswer = ['pick', 'pickTone', 'read'].includes(s.type);
    const last = stepIndex >= lesson.steps.length - 1;

    if (needsAnswer && !answered) {
      return h('p', { class: 'muted small center' }, 'Choose an answer to continue');
    }
    return h('div', { class: 'stack' },
      h('button', { class: 'btn btn-primary btn-lg tappable', style: 'width:100%', onclick: advance },
        last ? 'Finish lesson' : 'Continue'),
      s.type === 'speak'
        ? h('button', { class: 'btn btn-ghost tappable', style: 'width:100%', onclick: advance }, 'Skip speaking this one')
        : null);
  }

  /**
   * Keyboard: the front door was the one view without it. Enter continues,
   * Space replays, 1-4 answer. A focused button keeps its native Enter/Space,
   * so tabbing to "Hear it" and pressing Enter still plays it.
   */
  function onKey(e) {
    if (!lesson || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t?.matches?.('input, textarea, select')) return;
    const onControl = t?.matches?.('button, a');
    const s = step();
    if (e.key === 'Enter' && !onControl) {
      const needsAnswer = ['pick', 'pickTone', 'read'].includes(s.type);
      if (needsAnswer && !answered) return;
      e.preventDefault();
      advance();
    } else if (e.key === ' ' && !onControl) {
      e.preventDefault();
      unlockAudio();
      pitch.unlock();
      autoplay();
    } else if (/^[1-4]$/.test(e.key) && !answered) {
      const choice = pane.querySelectorAll('.choice')[Number(e.key) - 1];
      if (choice && !choice.disabled) { e.preventDefault(); choice.click(); }
    }
  }
  document.addEventListener('keydown', onKey);

  paint();
  return () => document.removeEventListener('keydown', onKey);
}
