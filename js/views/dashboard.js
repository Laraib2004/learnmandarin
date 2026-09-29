import { h } from '../ui.js';
import { stats, stageProgress, buildQueue } from '../deck.js';
import { get, getSession } from '../store.js';

/**
 * The dashboard's one job: remove the "what do I do today?" decision.
 * A beginner should never see a menu of options — they should see one button.
 *
 * The order below is the pedagogy, encoded: ears before mouth, reviews before
 * new material, and production once the day's recall work is done.
 */
export default function dashboard(root, { navigate }) {
  const s = stats();
  const { due, fresh } = buildQueue();
  const firstTime = s.known === 0;
  const toneReady = s.toneAccuracy !== null;

  let next;
  if (!toneReady) {
    next = { label: 'Start with tones', to: 'tones',
      why: 'Before any vocabulary: Mandarin is tonal, and tones learned wrong are extremely hard to unlearn. About 10 minutes.' };
  } else if (due > 0) {
    next = { label: `Review ${due} sentence${due === 1 ? '' : 's'}`, to: 'review',
      why: 'Due right now. Reviews before new material, always — that is what keeps the workload flat.' };
  } else if (fresh > 0) {
    next = { label: `Learn ${fresh} new sentence${fresh === 1 ? '' : 's'}`, to: 'review',
      why: 'Nothing is due. Time to add to the pile.' };
  } else if (s.drilled === 0) {
    next = { label: 'Run pattern drills', to: 'drill',
      why: 'Caught up on recall. Now build sentences you have never said before — that is the part that turns into fluency.' };
  } else {
    next = { label: 'Have a conversation', to: 'dialogue',
      why: 'Recall and production are both current. A conversation is the only exercise that makes you switch between understanding and speaking, which is what real talking demands.' };
  }

  root.append(
    h('div', { class: 'stack' },
      firstTime ? welcome() : null,

      resumeCard(navigate),

      h('section', { class: 'hero stack' },
        h('h1', {}, firstTime ? 'Start here' : 'Today'),
        h('p', { class: 'muted', style: 'margin:0' }, next.why),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary btn-lg', onclick: () => navigate(next.to) }, next.label),
          !firstTime && next.to !== 'drill'
            ? h('button', { class: 'btn tappable', onclick: () => navigate('drill') }, 'Drills')
            : null,
          !firstTime && next.to !== 'dialogue'
            ? h('button', { class: 'btn tappable', onclick: () => navigate('dialogue') }, 'Talk')
            : null)),

      h('div', { class: 'stats' },
        stat(s.known, 'sentences known'),
        stat(s.words, 'words met'),
        stat(s.spoken + s.drilled, 'said out loud'),
        stat(s.streak, 'day streak')),

      s.chars.known > 0
        ? h('div', { class: 'stats' },
            stat(s.chars.known, 'characters known'),
            stat(s.chars.due, 'characters due'),
            stat(s.conversations, 'conversations'),
            stat(s.mature, 'solid in memory'))
        : null,

      journey(s),

      h('section', { class: 'card stack' },
        h('h2', {}, 'How this gets you to fluent'),
        step('Ears first', 'Hear the difference before you try to make it. Tones learned wrong fossilise.', toneReady),
        step('Sentences, not words', 'Every card is a whole usable phrase. You learn 很 by using it, not by memorising "very".', s.known > 0),
        step('Say it, get scored', 'Speech recognition checks whether a Mandarin engine actually understood you.', s.spoken > 0),
        step('Build, don\'t recite', 'Pattern drills fill a frame at random so you produce sentences you have never said — under time pressure.', s.drilled > 0),
        step('Read the script (optional)', 'Pinyin is the alphabet-like part; characters are a separate system built from reusable components. Neither is required to speak.', s.chars.known > 0),
        step('Both directions at once', 'Conversations alternate: understand their Chinese, then produce your own. Drilling one direction only is why people freeze mid-chat.', s.conversations > 0),
        step('Return at the right moment', 'The scheduler brings each sentence back just before you would forget it.', s.mature > 0)),
    ),
  );
  return null;
}

const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, String(n)), h('span', {}, label));

/**
 * Nothing should ever have to be restarted. Cards, scores and streaks are
 * already permanent; this covers the half-finished session you walked away
 * from — the thing that actually feels like losing your place.
 */
function resumeCard(navigate) {
  const s = getSession();
  if (!s) return null;
  const labels = {
    learn: s.detail?.title ? `Lesson: ${s.detail.title}` : 'a lesson',
    dialogue: s.detail?.title ? `Conversation: ${s.detail.title}` : 'a conversation',
    review: 'your review session',
    drill: 'pattern drills',
    script: 'character practice',
  };
  const when = new Date(s.at);
  const ago = Math.round((Date.now() - s.at) / 3600000);
  return h('section', { class: 'card stack' },
    h('div', { class: 'row', style: 'justify-content:space-between;gap:.5rem' },
      h('b', {}, 'Unfinished: ', labels[s.view] || s.view),
      h('span', { class: 'muted small' },
        ago < 1 ? 'just now' : ago < 24 ? `${ago}h ago` : when.toLocaleDateString())),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary tappable', onclick: () => navigate(s.view) }, 'Continue')));
}

/** The A1 → C1 spine, with the current stage opened up. */
function journey(s) {
  const stages = stageProgress();
  const currentId = s.stage?.id;

  return h('section', { class: 'card stack' },
    h('h2', {}, 'The path'),
    h('p', { class: 'muted small', style: 'margin:0' },
      'Five stages, defined by what you can do — not by how many words you have seen.'),
    ...stages.map((st) => {
      const active = st.id === currentId;
      const finished = st.done === st.total;
      return h('div', { class: 'stack', style: 'gap:.35rem' },
        h('div', { class: 'row', style: 'justify-content:space-between;gap:.5rem' },
          h('b', { style: `font-size:.95rem;${active ? '' : 'opacity:.7'}` },
            h('span', { class: 'pill ' + (finished ? 'review' : active ? 'learning' : 'new') }, st.level),
            ' ', st.title),
          h('span', { class: 'muted small' }, `${st.done}/${st.total}`)),
        h('div', { class: 'bar' }, h('i', { style: `width:${st.pct}%` })),
        active
          ? h('ul', { class: 'muted small', style: 'margin:.2rem 0 .4rem;padding-left:1.1rem' },
              ...st.canDo.map((c) => h('li', {}, c)))
          : null);
    }));
}

function step(title, body, done) {
  return h('div', { class: 'step' },
    h('div', { class: `step-n ${done ? 'done' : 'todo'}` }, done ? '✓' : '·'),
    h('div', {},
      h('b', {}, title),
      h('div', { class: 'muted small' }, body)));
}

function welcome() {
  return h('section', { class: 'card stack' },
    h('h2', {}, '你好 — welcome'),
    h('p', { class: 'muted', style: 'margin:0' },
      'This course assumes you know nothing, and runs from there to conversational Mandarin. ' +
      'No characters are required to finish it: reading Chinese and speaking Chinese are separate skills, ' +
      'and bolting them together is the main reason beginners stall. Characters are here if you want them, off if you do not.'),
    h('p', { class: 'muted small', style: 'margin:0' },
      'Everything runs in your browser. No account, no payment, nothing sent anywhere.'));
}
