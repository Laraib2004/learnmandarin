import { h, pinyinEl, shuffle } from '../ui.js';
import { getCorpus, seedFromLesson } from '../deck.js';
import { speak, chineseVoices } from '../tts.js';
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
  root.append(pane);

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
    else if (s.tone) setTimeout(() => pitch.playTone(s.tone), 250);
    else if (s.speak) setTimeout(() => speak(s.speak), 250);
    else if (s.type === 'word') setTimeout(() => speak(s.hanzi), 250);
  }

  function advance() {
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
  function audioWarning() {
    if (chineseVoices().length > 0) return null;
    return h('section', { class: 'card stack', style: 'border-color:var(--warn)' },
      h('h2', {}, '⚠ No Chinese voice on this device'),
      h('p', { class: 'muted small', style: 'margin:0' },
        'Your browser has no Mandarin voice installed, so any Chinese it tries to read aloud ' +
        'comes out in an English voice — which is why every tone sounds the same. ' +
        'The tone exercises below use synthesised pitch instead and work perfectly without it, ' +
        'but words will not sound right until you add a voice.'),
      h('div', { class: 'notice' },
        h('b', {}, 'Windows: '), 'Settings → Time & language → Language & region → Add a language → ',
        h('b', {}, 'Chinese (Simplified, China)'), ' → tick ', h('b', {}, 'Speech'),
        ' → Install, then restart your browser.'),
      h('div', { class: 'notice' },
        h('b', {}, 'Faster alternative: '), 'open this page in ', h('b', {}, 'Microsoft Edge'),
        ', which ships Microsoft’s online Chinese voices with nothing to install.'),
      h('button', { class: 'btn tappable', onclick: () => { unlockAudio(); speak('你好'); } },
        'Test the audio again'));
  }

  /* ---------------- rendering one step ---------------- */

  function paint() {
    if (!lesson) { pane.replaceChildren(overview()); return; }

    const s = step();
    const n = lesson.steps.length;
    const pct = Math.round((stepIndex / n) * 100);

    pane.replaceChildren(
      h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
        h('button', { class: 'btn btn-ghost tappable', onclick: () => { lesson = null; paint(); } }, '← Path'),
        h('span', { class: 'muted small' }, `${stepIndex + 1} / ${n}`)),
      h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
      h('div', { class: 'muted small center' }, lesson.title),

      h('section', { class: 'card study' }, ...renderStep(s)),

      footer(s),
    );
  }

  function renderStep(s) {
    switch (s.type) {
      case 'teach': return teachStep(s);
      case 'tones': return tonesStep(s);
      case 'pickTone': return pickToneStep(s);
      case 'pick': return pickStep(s);
      case 'read': return readStep(s);
      case 'word': return wordStep(s);
      case 'speak': return speakStep(s);
      default: return [h('div', { class: 'muted' }, `Unknown step: ${s.type}`)];
    }
  }

  function teachStep(s) {
    return [
      h('h2', { style: 'margin:0' }, s.title),
      s.big ? h('div', { class: 'zh zh-lg' }, s.big) : null,
      s.pinyin ? pinyinEl(s.pinyin) : null,
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
      h('button', { class: 'mic tappable', onclick: () => pitch.playTone(s.answer) }, '🔊'),
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
      h('div', { class: 'en', style: 'font-weight:600' }, s.en),
      s.tone
        ? h('div', { class: 'contour', onclick: () => pitch.playTone(s.tone) }, pitch.contourSVG(s.tone))
        : null,
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn tappable', onclick: () => { unlockAudio(); speak(s.hanzi); } }, '🔊 Hear it'),
        s.tone
          ? h('button', { class: 'btn btn-ghost tappable', onclick: () => pitch.playTone(s.tone) }, 'Tone shape')
          : null),
      s.note ? h('div', { class: 'notice' }, s.note) : null,
    ];
  }

  function speakStep(s) {
    return [
      h('div', { class: 'muted small' }, s.prompt),
      h('div', { class: 'zh zh-lg' }, s.target),
      pinyinEl(s.pinyin),
      h('button', { class: 'btn tappable', onclick: () => { unlockAudio(); speak(s.target); } }, '🔊 Hear it'),
      asr.isSupported()
        ? h('div', { class: 'stack' },
            h('button', {
              class: `mic tappable ${spoken === 'listening' ? 'live' : ''}`,
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

  paint();
  return null;
}
