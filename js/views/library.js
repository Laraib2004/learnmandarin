import { h, pinyinEl } from '../ui.js';
import { getCorpus } from '../deck.js';
import { speak } from '../tts.js';
import { get } from '../store.js';
import { retrievability, formatInterval } from '../fsrs.js';

/**
 * Library — every sentence in the course, plus the state of your memory for it.
 *
 * Showing recall probability rather than a streak counter is a deliberate
 * choice: it tells you something true about your own memory, and it makes the
 * scheduler's behaviour legible instead of magical.
 */
export default function library(root) {
  const corpus = getCorpus();
  let filter = 'all';
  let query = '';

  const pane = h('div', { class: 'stack' });
  root.append(pane);

  function rows() {
    const { cards } = get();
    const q = query.trim().toLowerCase();
    return corpus.sentences.filter((s) => {
      const c = cards[s.id];
      const state = !c?.reps ? 'new' : c.stability >= 21 ? 'mature' : 'learning';
      if (filter !== 'all' && filter !== state) return false;
      if (!q) return true;
      return (s.hanzi + s.pinyin + s.en).toLowerCase().includes(q);
    });
  }

  function paint() {
    const { cards } = get();
    const list = rows();

    pane.replaceChildren(
      h('section', { class: 'card stack' },
        h('h1', {}, 'Library'),
        h('p', { class: 'muted small', style: 'margin:0' },
          `${corpus.sentences.length} sentences. “Recall” is the scheduler’s estimate of your chance of remembering it right now.`),
        h('input', {
          type: 'search', placeholder: 'Search Chinese, pinyin or English…',
          value: query,
          style: 'width:100%;padding:.55rem;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--text);font:inherit',
          oninput: (e) => { query = e.target.value; paintList(); },
        }),
        h('div', { class: 'row' },
          ...[['all', 'All'], ['new', 'Not started'], ['learning', 'Learning'], ['mature', 'Solid']]
            .map(([id, label]) =>
              h('button', {
                class: `btn ${filter === id ? 'btn-primary' : ''}`,
                onclick: () => { filter = id; paint(); },
              }, label)))),
      listEl(list, cards),
    );
  }

  function paintList() {
    const el = pane.querySelector('[data-list]');
    if (el) el.replaceWith(listEl(rows(), get().cards));
  }

  function listEl(list, cards) {
    const byUnit = new Map();
    for (const s of list) {
      if (!byUnit.has(s.unit)) byUnit.set(s.unit, []);
      byUnit.get(s.unit).push(s);
    }

    return h('div', { class: 'stack', dataset: { list: '1' } },
      list.length === 0 ? h('p', { class: 'muted' }, 'Nothing matches.') : null,
      ...[...byUnit.entries()].map(([unitId, items]) => {
        const unit = corpus.units.find((u) => u.id === unitId);
        return h('section', { class: 'card stack' },
          h('h2', {}, unit?.title ?? unitId),
          h('ul', { class: 'list' }, ...items.map((s) => row(s, cards[s.id]))));
      }));
  }

  function row(s, card) {
    const showHanzi = get().settings.showHanzi;
    const state = !card?.reps ? 'new' : card.stability >= 21 ? 'review' : 'learning';
    const label = !card?.reps ? 'not started' : card.stability >= 21 ? 'solid' : 'learning';

    let recall = null;
    if (card?.reps && card.lastReview) {
      const days = (Date.now() - card.lastReview) / 86400000;
      const r = Math.round(retrievability(days, card.stability) * 100);
      const dueIn = card.due - Date.now();
      recall = `${r}% recall · ${dueIn <= 0 ? 'due now' : `due in ${formatInterval(dueIn)}`}`;
    }

    return h('li', {},
      h('button', { class: 'btn btn-ghost', onclick: () => speak(s.hanzi), 'aria-label': `Play ${s.pinyin}` }, '🔊'),
      h('div', { style: 'flex:1;min-width:0' },
        showHanzi ? h('div', { class: 'zh', style: 'font-size:1.3rem' }, s.hanzi) : null,
        pinyinEl(s.pinyin, 'pinyin small'),
        h('div', { class: 'small' }, s.en)),
      h('div', { style: 'text-align:right;flex:none' },
        h('span', { class: `pill ${state}` }, label),
        recall ? h('div', { class: 'muted small' }, recall) : null));
  }

  paint();
  return null;
}
