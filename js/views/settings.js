import { h } from '../ui.js';
import { get, update, exportJSON, importJSON, reset } from '../store.js';
import { chineseVoices, setVoice, speak, initVoices } from '../tts.js';
import { primeMicrophone, isSupported as asrOk } from '../asr.js';
import { signal, unlockAudio, hapticsSupported } from '../feedback.js';

export default function settings(root) {
  const pane = h('div', { class: 'stack' });
  root.append(pane);

  async function paint() {
    await initVoices();
    const s = get();
    const voices = chineseVoices();

    pane.replaceChildren(
      h('section', { class: 'card stack' },
        h('h1', {}, 'Settings'),

        h('label', { class: 'field' }, 'Mandarin voice',
          h('small', {}, voices.length
            ? 'Installed on your device. Nothing is downloaded or streamed.'
            : 'No Chinese voice found. On Windows: Settings → Time & language → Language → add Chinese (Simplified) → Speech. On Android, install Google Speech Services.'),
          h('select', {
            onchange: (e) => { setVoice(e.target.value || null); speak('你好，我们开始吧'); },
          },
            h('option', { value: '' }, 'Automatic'),
            ...voices.map((v) =>
              h('option', { value: v.voiceURI, selected: v.voiceURI === s.settings.voiceURI }, `${v.name} (${v.lang})`)))),

        h('label', { class: 'field' }, `Speaking speed — ${Math.round(s.settings.speechRate * 100)}%`,
          h('small', {}, 'Native Mandarin is fast. Start around 85% and raise it as your ear catches up.'),
          h('input', {
            type: 'range', min: '0.4', max: '1.3', step: '0.05', value: String(s.settings.speechRate),
            oninput: (e) => { update((st) => { st.settings.speechRate = Number(e.target.value); }); },
            onchange: () => { paint(); speak('你好吗'); },
          })),

        h('label', { class: 'field' }, 'Show Chinese characters',
          h('small', {}, 'Off means pinyin and audio only. Speaking fluency does not require characters, and hiding them early keeps you listening instead of reading.'),
          h('div', { class: 'row' },
            toggle('showHanzi', true, 'Show 汉字'),
            toggle('showHanzi', false, 'Pinyin only'))),

        h('label', { class: 'field' }, `New sentences per day — ${s.settings.newPerDay}`,
          h('small', {}, 'Every new card becomes ~8 future reviews. 8 a day is sustainable; 30 a day builds a backlog you will abandon.'),
          h('input', {
            type: 'range', min: '2', max: '30', step: '1', value: String(s.settings.newPerDay),
            oninput: (e) => { update((st) => { st.settings.newPerDay = Number(e.target.value); }); },
            onchange: paint,
          })),

        h('label', { class: 'field' }, `Target retention — ${Math.round(s.settings.requestRetention * 100)}%`,
          h('small', {}, 'How much you want to remember, as a probability. Higher means more reviews. 90% is the efficiency sweet spot; below 80% you start forgetting faster than you learn.'),
          h('input', {
            type: 'range', min: '0.7', max: '0.97', step: '0.01', value: String(s.settings.requestRetention),
            oninput: (e) => { update((st) => { st.settings.requestRetention = Number(e.target.value); }); },
            onchange: paint,
          })),

        h('label', { class: 'field' }, 'Theme',
          h('div', { class: 'row' },
            themeBtn('', 'Match system'), themeBtn('light', 'Light'), themeBtn('dark', 'Dark')))),

      h('section', { class: 'card stack' },
        h('h2', {}, 'Feedback'),
        h('label', { class: 'field' }, 'Sound cues',
          h('small', {}, 'Short tones on correct, close, and missed answers. Synthesised in the browser — no audio files, no downloads.'),
          h('div', { class: 'row' },
            boolToggle('sounds', true, 'On'),
            boolToggle('sounds', false, 'Off'))),
        h('label', { class: 'field' }, 'Vibration',
          h('small', {},
            hapticsSupported()
              ? 'Short buzz alongside each result.'
              : 'Not available in this browser. iOS Safari does not implement the Vibration API, so iPhone gets no haptics — including in an installed app. Sound and on-screen feedback carry it instead.'),
          h('div', { class: 'row' },
            boolToggle('haptics', true, 'On'),
            boolToggle('haptics', false, 'Off'))),
        h('button', {
          class: 'btn tappable', onclick: () => { unlockAudio(); signal('correct', 'This is what a correct answer feels like'); },
        }, 'Test feedback')),

      h('section', { class: 'card stack' },
        h('h2', {}, 'Microphone'),
        h('p', { class: 'muted small', style: 'margin:0' },
          asrOk()
            ? 'Speech scoring is available in this browser. Grant mic access once and the Speak page will stop asking.'
            : 'This browser does not expose speech recognition, so Speak cannot score you. Chrome, Edge, or Safari 14.1+ will.'),
        h('button', {
          class: 'btn', onclick: async (e) => {
            const ok = await primeMicrophone();
            e.target.textContent = ok ? 'Microphone ready ✓' : 'Permission denied';
          },
        }, 'Grant microphone access')),

      h('section', { class: 'card stack' },
        h('h2', {}, 'Your data'),
        h('p', { class: 'muted small', style: 'margin:0' },
          'Progress lives in this browser only. Nothing is uploaded, and there is no account to lose. ' +
          'That also means clearing site data erases it — export a backup if you care about your streak.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', onclick: download }, 'Export backup'),
          h('button', { class: 'btn', onclick: () => pane.querySelector('#import-box').hidden = false }, 'Import backup'),
          h('button', {
            class: 'btn', style: 'color:var(--bad)',
            onclick: () => {
              if (confirm('Erase all progress on this device? This cannot be undone.')) { reset(); paint(); }
            },
          }, 'Erase everything')),
        h('div', { id: 'import-box', hidden: true, class: 'stack' },
          h('textarea', { id: 'import-text', placeholder: 'Paste the contents of your backup file here…' }),
          h('button', {
            class: 'btn btn-primary',
            onclick: () => {
              try {
                importJSON(pane.querySelector('#import-text').value);
                alert('Progress restored.');
                paint();
              } catch (err) {
                alert(err.message);
              }
            },
          }, 'Restore'))),
    );
  }

  function toggle(key, value, label) {
    const on = get().settings[key] === value;
    return h('button', {
      class: `btn ${on ? 'btn-primary' : ''}`,
      onclick: () => { update((st) => { st.settings[key] = value; }); paint(); },
    }, label);
  }

  /** Toggle for a plain boolean setting (the existing `toggle` compares values). */
  function boolToggle(key, value, label) {
    const on = Boolean(get().settings[key]) === value;
    return h('button', {
      class: `btn tappable ${on ? 'btn-primary' : ''}`,
      onclick: () => { update((st) => { st.settings[key] = value; }); paint(); },
    }, label);
  }

  function themeBtn(value, label) {
    const cur = localStorage.getItem('learnchinese.theme') || '';
    return h('button', {
      class: `btn ${cur === value ? 'btn-primary' : ''}`,
      onclick: () => {
        if (value) { localStorage.setItem('learnchinese.theme', value); document.documentElement.dataset.theme = value; }
        else { localStorage.removeItem('learnchinese.theme'); delete document.documentElement.dataset.theme; }
        paint();
      },
    }, label);
  }

  function download() {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `learnchinese-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  paint();
  return null;
}
