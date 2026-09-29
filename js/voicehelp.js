import { h } from './ui.js';
import { speak, initVoices, hasChineseVoice } from './tts.js';
import { unlockAudio, toast } from './feedback.js';

/**
 * "Why is there no sound?" — the answer, shown where the learner is.
 *
 * Spoken Mandarin comes from the device's own Mandarin voice (free, offline,
 * unlimited). Plenty of machines have none, and then every 🔊 button is
 * silent. Code cannot install a voice, so the next best thing is an exact,
 * platform-specific fix at the moment the learner notices — not a warning on a
 * page they already scrolled past.
 */

function platform() {
  const ua = globalThis.navigator?.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac OS X/.test(ua)) return 'mac';
  return 'other';
}

// A function, not a constant: DOM nodes can only live in one place at a time.
const steps = () => ({
  windows: [
    ['Open ', h('b', {}, 'Settings → Time & language → Speech'), '.'],
    ['Under ', h('b', {}, 'Manage voices'), ', choose ', h('b', {}, 'Add voices'), '.'],
    ['Pick ', h('b', {}, 'Chinese (Simplified, China)'), ' and install it. It is free and about 60 MB.'],
    [h('b', {}, 'Close every browser window'), ' and open this page again. The browser only reads the voice list when it starts.'],
  ],
  mac: [
    ['Open ', h('b', {}, 'System Settings → Accessibility → Spoken Content'), '.'],
    ['Next to System voice choose ', h('b', {}, 'Manage Voices…'), ', then tick a ', h('b', {}, 'Chinese (China mainland)'), ' voice such as Tingting.'],
    ['Quit and reopen the browser.'],
  ],
  ios: [
    ['Open ', h('b', {}, 'Settings → Accessibility → Spoken Content → Voices → Chinese (China mainland)'), '.'],
    ['Download a voice such as Tingting, then reopen this app.'],
  ],
  android: [
    ['Install or update ', h('b', {}, 'Speech Recognition & Synthesis from Google'), ' in the Play Store.'],
    ['In its settings, install the ', h('b', {}, 'Chinese (Mandarin)'), ' voice data, then reopen the browser.'],
  ],
  other: [
    ['Install a Chinese (Mandarin) voice in your system\'s text-to-speech settings, then restart the browser.'],
  ],
});

/** The full explanation, as a card. Returns null when a voice exists. */
export function voiceHelpCard({ onClose } = {}) {
  if (hasChineseVoice()) return null;
  const p = platform();
  const card = h('section', { class: 'card stack voice-help', style: 'border-color:var(--warn)' },
    h('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start' },
      h('h2', { style: 'margin:0' }, '⚠ No Chinese voice on this device'),
      onClose ? h('button', { class: 'btn btn-ghost tappable', 'aria-label': 'Close', onclick: onClose }, '✕') : null),
    h('p', { class: 'muted small', style: 'margin:0' },
      'The spoken Chinese in this app comes from your device\'s own Mandarin voice. It is free and works offline, ' +
      'but this device does not have one yet, so Chinese audio plays silently. ' +
      'The tone exercises still work, because they use generated pitch rather than a voice.'),
    h('ol', { class: 'voice-steps' }, ...steps()[p].map((parts) => h('li', {}, ...parts))),
    p === 'windows' || p === 'mac' || p === 'other'
      ? h('div', { class: 'notice' },
          h('b', {}, 'No install needed: '), 'open this page in ', h('b', {}, 'Microsoft Edge'),
          ', which includes Chinese voices already. Your progress is saved in the browser, so it starts fresh there.')
      : null,
    h('button', {
      class: 'btn tappable',
      onclick: async () => {
        unlockAudio();
        await initVoices();
        if (hasChineseVoice()) {
          speak('你好');
          toast('Chinese voice found.', 'correct');
          card.remove();
        } else {
          toast('Still no Chinese voice. Restart the browser after installing it.', 'partial', 4000);
        }
      },
    }, 'Check again'));
  return card;
}

/**
 * Called whenever speech was refused for want of a voice. The first time, put
 * the full explanation at the top of the page; after that a short toast is
 * enough, so tapping play five times does not stack five panels.
 */
let shownOnce = false;
export function showVoiceHelp(host) {
  if (!host || hasChineseVoice()) return;
  const existing = host.querySelector?.('.voice-help');
  if (existing) {
    toast('No Chinese voice installed, so there is no sound. The fix is at the top of the page.', 'partial', 3500);
    existing.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (shownOnce) {
    toast('No Chinese voice installed, so there is no sound. Settings explains how to add one.', 'partial', 3500);
    return;
  }
  shownOnce = true;
  const card = voiceHelpCard({ onClose: () => card.remove() });
  if (!card) return;
  host.prepend(card);
  card.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}
