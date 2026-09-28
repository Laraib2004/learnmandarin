/**
 * Daily study reminder.
 *
 * THE HONEST CONSTRAINT: this app has no backend, by design. Web Push — the
 * only way a website can notify you while it is closed — requires a server to
 * hold subscriptions and send messages. So a purely static site physically
 * cannot wake your phone on its own. Anyone claiming otherwise is either
 * running a server or shipping something that quietly does not work.
 *
 * On iOS it is stricter still: Notification is only available to a PWA that has
 * been added to the Home Screen (16.4+), and even then background delivery
 * needs push.
 *
 * So reminders work in two layers, weakest to strongest:
 *
 *   1. In-app nudge — when you open the app after your reminder time and have
 *      not studied yet, it says so. Free, works everywhere, but only when you
 *      have already opened the app, which is precisely when you do not need it.
 *
 *   2. A calendar event (.ics) — a real daily alarm owned by your phone's OS.
 *      Fires whether or not the app is open, whether or not the browser is
 *      running, forever, with no server anywhere. This is the one that actually
 *      does the job, which is why the UI pushes you toward it.
 *
 *   (2b) Notification API, if granted and the tab is alive — a nicer version of
 *        layer 1 while the app sits open in a background tab.
 */

import { get, update, todayKey } from './store.js';

export const notificationsSupported = () => typeof Notification !== 'undefined';

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** iOS only exposes Notification to an installed PWA. Detect that case. */
export function iosNeedsInstall() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') && !window.MSStream;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true;
  return isIOS && !standalone;
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/** Parse "HH:MM" into minutes past midnight. */
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '15:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function studiedToday() {
  const d = get().daily[todayKey()];
  return Boolean(d && (d.new || d.reviews || d.speak || d.drill || d.chars));
}

/** Is a nudge warranted right now? */
export function reminderDue(now = new Date()) {
  const s = get();
  if (!s.settings.reminderOn) return false;
  if (studiedToday()) return false;
  if (s.lastReminded === todayKey()) return false;
  return now.getHours() * 60 + now.getMinutes() >= toMinutes(s.settings.reminderTime);
}

export function markReminded() {
  update((s) => { s.lastReminded = todayKey(); });
}

/**
 * Fire the reminder if it is due. Called on load and on an interval while the
 * app is open. Returns the message if one was raised, else null.
 */
export function checkReminder({ onNudge } = {}) {
  if (!reminderDue()) return null;
  const msg = 'Time for your Chinese — a short session is enough to keep the schedule honest.';
  markReminded();

  if (notificationsSupported() && Notification.permission === 'granted') {
    try {
      new Notification('说吧 Shuō Ba', { body: msg, icon: 'icons/icon-192.png', tag: 'daily-study' });
    } catch { /* some browsers only allow this from a service worker */ }
  }
  onNudge?.(msg);
  return msg;
}

/** Poll while the app is open. Cheap, and stops when the page is hidden. */
export function startReminderLoop(onNudge) {
  const tick = () => { if (!document.hidden) checkReminder({ onNudge }); };
  tick();
  const id = setInterval(tick, 60000);
  document.addEventListener('visibilitychange', tick);
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
}

/* ---------------- the reliable layer: a real calendar alarm ---------------- */

const pad = (n) => String(n).padStart(2, '0');

/**
 * Build a daily-recurring VEVENT with an alarm at the chosen local time.
 * Deliberately floating (no timezone/Z suffix) so it fires at that wall-clock
 * time wherever the learner happens to be.
 */
export function buildICS(time = '15:00') {
  const [hh, mm] = String(time).split(':').map(Number);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh || 15, mm || 0, 0);
  if (start < now) start.setDate(start.getDate() + 1); // start tomorrow if today has passed

  const fmtLocal = (d) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const end = new Date(start.getTime() + 15 * 60000);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Shuo Ba//Mandarin study reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:shuoba-daily-${start.getTime()}@shuoba.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${fmtLocal(start)}`,
    `DTEND:${fmtLocal(end)}`,
    'RRULE:FREQ=DAILY',
    'SUMMARY:Chinese practice — 说吧',
    'DESCRIPTION:Review what is due\\, then say it out loud. Fifteen minutes is plenty.',
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Chinese practice — 说吧',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadICS(time = '15:00') {
  const blob = new Blob([buildICS(time)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'shuoba-daily-reminder.ics';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
