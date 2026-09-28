import { h } from '../ui.js';
import { stats, unitProgress, buildQueue } from '../deck.js';
import { get } from '../store.js';

/**
 * The dashboard's one job: remove the "what do I do today?" decision.
 * A beginner should never see a menu of options — they should see one button.
 */
export default function dashboard(root, { navigate }) {
  const s = stats();
  const { due, fresh } = buildQueue();
  const firstTime = s.known === 0;
  const toneReady = (get().tones && Object.keys(get().tones).length > 0) || s.toneAccuracy !== null;

  // Decide the single next action.
  let next;
  if (!toneReady) {
    next = { label: 'Start with tones', to: 'tones',
      why: 'Before any vocabulary: Mandarin is tonal, and tones learned wrong are extremely hard to unlearn. This takes about 10 minutes.' };
  } else if (due > 0) {
    next = { label: `Review ${due} sentence${due === 1 ? '' : 's'}`, to: 'review',
      why: 'These are due right now. Reviews before new material, always.' };
  } else if (fresh > 0) {
    next = { label: `Learn ${fresh} new sentence${fresh === 1 ? '' : 's'}`, to: 'review',
      why: 'Nothing is due. Time to add to the pile.' };
  } else {
    next = { label: 'Practise speaking', to: 'speak',
      why: 'You are caught up for today. The best use of extra time is producing out loud, not more flashcards.' };
  }

  root.append(
    h('div', { class: 'stack' },
      firstTime ? welcome() : null,

      h('section', { class: 'hero stack' },
        h('h1', {}, firstTime ? 'Start here' : 'Today'),
        h('p', { class: 'muted', style: 'margin:0' }, next.why),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary btn-lg', onclick: () => navigate(next.to) }, next.label))),

      h('div', { class: 'stats' },
        stat(s.known, 'sentences known'),
        stat(s.words, 'words met'),
        stat(s.spoken, 'said out loud'),
        stat(s.streak, s.streak === 1 ? 'day streak' : 'day streak')),

      h('section', { class: 'card stack' },
        h('h2', {}, 'The course'),
        h('p', { class: 'muted small', style: 'margin:0' },
          'Six units of the most useful spoken Mandarin. Finish these and you can hold a basic conversation — not recite a word list.'),
        ...unitProgress().map(unitRow)),

      h('section', { class: 'card stack' },
        h('h2', {}, 'How this works'),
        step(1, 'Tones first', 'Hear the difference before you try to make it. Drill minimal pairs until you can tell mā from mà without thinking.', toneReady),
        step(2, 'Sentences, not words', 'Every card is a whole usable phrase. You learn 很 by using it, not by memorising "very".', s.known > 0),
        step(3, 'Say it, get scored', 'Speech recognition checks whether a Mandarin engine actually understood you. That is the only honest test of pronunciation.', s.spoken > 0),
        step(4, 'Come back when it matters', 'The scheduler tracks how long each sentence will stick and brings it back right before you would forget it.', s.mature > 0)),
    ),
  );
  return null;
}

const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, String(n)), h('span', {}, label));

function unitRow(u) {
  return h('div', { class: 'stack', style: 'gap:.3rem' },
    h('div', { class: 'row', style: 'justify-content:space-between;gap:.5rem' },
      h('b', { style: 'font-size:.95rem' }, u.title),
      h('span', { class: 'muted small' }, `${u.done}/${u.total}`)),
    h('div', { class: 'muted small' }, u.goal),
    h('div', { class: 'bar' }, h('i', { style: `width:${u.pct}%` })));
}

function step(n, title, body, done) {
  return h('div', { class: 'step' },
    h('div', { class: `step-n ${done ? 'done' : 'todo'}` }, done ? '✓' : String(n)),
    h('div', {},
      h('b', {}, title),
      h('div', { class: 'muted small' }, body)));
}

function welcome() {
  return h('section', { class: 'card stack' },
    h('h2', {}, '你好 — welcome'),
    h('p', { class: 'muted', style: 'margin:0' },
      'This course assumes you know nothing. No characters are required to finish it: ' +
      'reading Chinese and speaking Chinese are separate skills, and bolting them together ' +
      'is the main reason beginners stall. Characters are here if you want them, off if you do not.'),
    h('p', { class: 'muted small', style: 'margin:0' },
      'Everything runs in your browser. No account, no payment, nothing sent anywhere.'));
}
