# 说吧 Shuō Ba — learn to *speak* Mandarin

A free, open, speaking-first Mandarin course that runs entirely in your browser.
Zero to conversational. Installable as an app. Works offline. No account, no
subscription, no server — nothing you do leaves your device.

> **说吧** (*shuō ba*) means roughly "go on — speak." That is the whole thesis.

---

## Start here

Open it and press **Begin lesson 1**. That is the whole instruction — there is
one tab and one button, and the app decides what comes next.

**18 lessons, ~70 minutes**, in this order:

| Unit | Lessons | What you get |
|---|---|---|
| **A — Pinyin** | 1–8 | Read any Chinese syllable and know how it sounds. Tones, and the letters that lie (`q`=ch, `x`=sh, `c`=ts, `z`=ds, hidden `ü`). |
| **B — First words** | 9–14 | 你 我 他 是 不 很 好 谢谢 — with a reading check. |
| **C — First sentences** | 15–18 | Greet someone, swap names, and rescue yourself when lost. |

Tabs beyond **Path** stay hidden until the lessons that justify them are done.
A beginner sees one tab, not seven.

### If the audio sounds wrong

**Every tone sounding identical means you have no Mandarin voice installed** —
the browser falls back to an English voice and mangles everything. The app now
detects this and says so on the first screen.

- **Windows:** Settings → Time & language → Language & region → Add a language →
  Chinese (Simplified, China) → tick **Speech** → Install → restart the browser.
- **Faster:** open the app in **Microsoft Edge**, which ships Microsoft's online
  Chinese voices with nothing to install.

**Tones are learnable either way.** The tone lessons use *synthesised pitch
contours*, not speech — a pure tone that glides exactly the way each tone
glides. It cannot be broken by a missing voice, needs no network, and the
on-screen shape is drawn from the same numbers that generate the sound, so the
picture and the audio can never disagree.

## Why this exists

Most language apps optimise for daily engagement, not for the day you stand in
front of a Mandarin speaker and have to say something. This one inverts that.

| What typical apps do | What Shuō Ba does |
|---|---|
| Mention tones once, then move on | **Tone Lab first** — forced-choice ear training on minimal pairs, plus the four tone-change rules that make you sound human |
| Drill isolated words | **Sentence-level cards** — the unit of memory is a usable phrase |
| Never ask you to speak | **Speech scoring** — a Mandarin recogniser either understood you or it didn't, marked character by character |
| Only ever test recall | **Pattern drills** — you *build* sentences you have never said, against a clock |
| Test one direction only | **Two-way conversations** — understand their Chinese, then produce your own |
| Never explain pinyin | **The alphabet you were never taught** — q, x, c, z and ü do not say what English spelling suggests |
| Characters as rote squiggles | **Components first** — 39 reusable parts, characters ordered by frequency *in this course* |
| Weld reading to speaking | **Characters are optional** — you can complete the course in pinyin and audio alone |
| SM-2 or a hand-tuned interval ladder | **FSRS-5** — models memory stability and difficulty per card, schedules the review for the day you'd otherwise forget |
| Gamified streaks in place of feedback | **Recall probability** — the Library shows your real chance of remembering each sentence right now |
| A menu you must navigate | **One linear path** — one lesson, one step, one button; tabs unlock as you earn them |
| Tones taught through speech you may not be able to play | **Synthesised pitch contours** — works with zero voices installed |

### The core idea

**Memorising sentences makes you a phrasebook. Fluency is generating sentences
you have never produced before, fast enough to hold a conversation.**

So the app has two engines, not one:

- **Review** trains recall — 250 sentences on an FSRS schedule.
- **Drills** train production — 32 grammar frames whose slots are filled at
  random, so `我想 ___` becomes a sentence you assemble on the spot. 217
  variations ship, and the frame transfers to every word you learn afterwards.
  There is a timer, and it is not decoration: correct-but-slow is not fluent.
  The target is under 4 seconds, roughly conversational latency.
- **Conversations** train both at once — see below.

### Both directions, always

A conversation is two skills alternating, and practising one of them produces a
predictable failure:

| Direction | What it trains | Skip it and you get |
|---|---|---|
| **ZH → EN** partner speaks, you recover the meaning | listening comprehension | someone who can recite but cannot reply |
| **EN → ZH** you hold an intention, you produce it | speaking from meaning | someone who understands but freezes |

Every dialogue alternates strictly between the two, and neither can be skipped.
Partner turns are **audio-first with no subtitles** — the Chinese stays hidden
until you commit to an answer, because a real conversation has no subtitles.
10 dialogues ship, 81 turns, 41 comprehension / 40 production.

### Chinese has no alphabet

This confuses every beginner, so the app is explicit about it. There are **two
separate systems**, and conflating them is why people stall:

- **Pinyin** — the romanisation. Alphabet-like, and the closest thing to one.
  It is also a trap: `q` is *ch*, `x` is *sh*, `c` is *ts*, `z` is *ds*, `e`
  alone is *uh*, `-ian` is *yen*, and `ju/qu/xu` secretly contain `ü`. Nobody
  teaches this, so learners guess from English and build an accent that takes
  years to undo. The **Script → Pinyin traps** tab covers all eight.
- **Hanzi** — not letters at all. Characters are assembled from ~200 reusable
  **components**: 讠 means it is spoken, 氵 means liquid, 忄 means a feeling.
  39 components ship, plus 8 stroke-order rules and 69 characters — ordered by
  how often they appear in *this* course, so they cover **55% of all its text**.

Characters are a **separate, optional track** on their own FSRS schedule. You
can reach speaking fluency without ever touching them.

---

## The course

Five stages, defined by what you can **do** — not by how many words you've seen.

| Stage | Level | You can… | Sentences |
|---|---|---|---|
| Foundation | A1 | Survive a first encounter without freezing | 60 |
| Survival | A2 | Handle a day in a Chinese city alone | 50 |
| Conversation | B1 | Talk about your life, past and future | 50 |
| Fluency | B2 | Say what you mean, including awkward things | 50 |
| Native-adjacent | C1 | Hedge, use chengyu, shift register, argue a point | 40 |

**250 sentences · 500 glossed words · 32 pattern frames · 217 drillable
variations · 10 two-way conversations · 69 characters · 39 components**

Every sentence carries a word-by-word gloss, so grammar is visible without ever
being a grammar lesson. Tone sandhi is marked where the spoken form differs from
the written pinyin (你好 is written `nǐ hǎo` but said `ní hǎo`).

---

## Run it

Static files — no build step, no dependencies to install.

```bash
npm start                  # or: python -m http.server 8080
# then open http://localhost:8080
```

You **must** serve it over HTTP. Opening `index.html` as a `file://` URL makes
browsers block the course JSON (the app detects this and tells you so).

### Install it

It is a real PWA. On **Android/Chrome/Edge** an Install button appears in the
header. On **iPhone** tap Share → Add to Home Screen (iOS Safari exposes no
install API, so the button explains that route rather than faking one).

Once installed it runs full-screen, keeps its own icon, and **works offline** —
the service worker precaches the shell and the entire course. That matters for a
study app: reviews happen on the metro.

### Tests

```bash
npm test          # 177 checks: scheduler, speech scoring, corpus integrity,
                  # every view rendered, PWA assets, mobile-layout rules,
                  # session resume, reminder/ICS generation, lesson
                  # integrity and tone-contour synthesis
```

### Deploy for free

Any static host works. GitHub Pages:

```bash
git add -A && git commit -m "Shuo Ba"
git branch -M main && git remote add origin <your-repo-url>
git push -u origin main
# then: repo Settings → Pages → Deploy from branch → main / (root)
```

`.nojekyll` is already present so Pages serves the `js/` directory untouched.
Netlify, Cloudflare Pages, and Vercel need no configuration either.

---

## Mobile

Built mobile-first against iPhone 16 (393 × 852pt) and verified in-browser at
that exact viewport:

- **Bottom tab bar**, thumb-reachable — a top nav is not, on a 6.3" phone
- **Safe-area insets** respected, so nothing hides under the Dynamic Island or
  the home indicator
- `100dvh`, not `100vh` — iOS Safari's URL bar moves and `vh` gets it wrong
- **44pt minimum touch targets** throughout (HIG), verified by test
- 16px inputs, so iOS never zooms the page on focus
- No tap-highlight flash; press states and `touch-action: manipulation` instead
  (which also removes the 300ms double-tap delay)
- No horizontal overflow on any route

## Nothing ever restarts

Every card, score, streak and half-finished conversation is written to
`localStorage` as it happens. Close the tab mid-dialogue and the picker offers
**Resume — turn 4 of 8**; the dashboard shows an **Unfinished** card for whatever
you walked away from. Sessions older than a week are dropped, because a stale
"resume" is noise rather than help. Start over is always one tap away.

## Daily reminder

Set a time in Settings (default 15:00). Two layers, and the README is honest
about which one actually works:

1. **In-app nudge** — if you open the app after your time and haven't studied,
   it tells you. Free and universal, but only fires once you've already opened
   the app, which is exactly when you don't need reminding.
2. **A calendar alarm (.ics)** ← **this is the one that works.** One tap adds a
   daily repeating event to your phone's own calendar. It fires whether or not
   the app is open, forever, with no server anywhere.

**Why not real push notifications?** Waking a closed website requires Web Push,
which requires a server to hold subscriptions and send messages. This app has no
backend by design — that is what keeps it free and private. A static site
physically cannot do it. On iOS it is stricter still: `Notification` only exists
for a PWA added to the Home Screen (16.4+), and background delivery still needs
push. So the app offers the calendar route instead of shipping a toggle that
quietly does nothing.

## Feedback

Three channels, because none of them works everywhere:

- **Visual** — toasts, per-character marks, animated scores. Works universally.
- **Audio** — short synthesised tones via Web Audio. No asset files.
- **Haptic** — `navigator.vibrate`.

**iOS Safari does not implement the Vibration API**, so there is no haptic
feedback on iPhone, including in an installed PWA. That is a platform
restriction, not something the code can work around — which is why audio and
visual carry the real weight and nothing is ever signalled by vibration alone.
Both channels are toggleable in Settings, with a Test button.

## Browser support

| Feature | Chrome / Edge | Safari | Firefox |
|---|---|---|---|
| Course, SRS, tone drills, patterns, dialogues | ✅ | ✅ | ✅ |
| Mandarin audio (TTS) | ✅ | ✅ | ✅ |
| Install / offline (PWA) | ✅ | ✅ via Share menu | ✅ |
| **Speech scoring (ASR)** | ✅ | 14.1+ | ❌ — falls back to self-checking |
| Haptics | ✅ Android | ❌ iOS | ✅ Android |

Firefox doesn't implement the Web Speech recognition API. The app degrades
rather than breaking, but **use Chrome or Edge for pronunciation scoring.**

**No Chinese voice?** Windows: Settings → Time & language → Language → add
Chinese (Simplified) → Speech. macOS/iOS ship Tingting by default. Android:
install Google Speech Services.

---

## Project layout

```
index.html              app shell + bottom tab bar + PWA meta
manifest.webmanifest    installable app metadata
sw.js                   service worker: offline precache of shell + course
icons/                  PNG app icons (192/512/maskable/apple-touch)
css/app.css             design tokens, light/dark, tone colour-coding
js/
  main.js               hash router, view lifecycle
  fsrs.js               FSRS-5 scheduler (pure, tested)
  asr.js                speech recognition + character-level scoring
  tts.js                Mandarin text-to-speech
  store.js              localStorage persistence, export/import
  deck.js               corpus loading, study queue, progress stats
  ui.js                 DOM helpers, tone colouring
  feedback.js           toasts, audio cues, haptics
  reminder.js           daily nudge + .ics calendar alarm
  pitch.js              synthesised tone contours (no voice needed)
  views/                learn (the path) · dashboard · tones · script · review ·
                        speak · drill · dialogue · library · settings
data/
  course.json           the five stages and where their sentences live
  corpus/st1..st5.json  250 sentences, 25 units
  patterns.json         32 generative grammar frames
  dialogues.json        10 two-way conversations
  lessons.json          the 18-lesson guided path
  pinyin.json           the sound system + the 8 spelling traps
  characters.json       components, stroke rules, 69 characters
  tones.json            minimal pairs + the 4 tone-change rules
scripts/                node test harnesses
```

Content is split per stage and listed in `course.json`, so **the corpus can grow
without touching a line of code.**

## Data & privacy

Everything lives in `localStorage` under `learnchinese.v1`. There is no backend,
no analytics, and no network request after the page loads. That's also the
catch: **clearing site data erases your progress.** Settings → Export backup
gives you a JSON file you can re-import anywhere, including on another device.

---

## Roadmap

- [ ] Grow the corpus toward ~1,000 sentences (C1 is the thinnest stage)
- [ ] Extend the character set past 69 (the top 100 would cover ~68% of the text)
- [ ] Animated stroke-order playback (needs a stroke-path dataset)
- [ ] More dialogues, and branching replies rather than a fixed script
- [ ] Pitch-contour feedback from the mic — see your tone curve against the target
- [ ] Recording playback so you can hear yourself beside the native audio
- [ ] Listening mode at natural speed with connected speech
- [ ] Offline support via a service worker (PWA)

## Contributing

The highest-value contributions are **sentences** and **patterns**.

- Sentences: add to the right `data/corpus/st*.json` following the existing
  shape (`hanzi`, `pinyin` with tone marks, `en`, per-word `words[]`, and
  `spoken` when tone sandhi changes the pronunciation).
- Patterns: add to `data/patterns.json` — a frame containing `{X}` in all three
  of `zh` / `pinyin` / `en`, plus slot fillers. One good pattern is worth
  dozens of sentences, because it generates.

Run `npm test` to validate. Prioritise what a learner would actually say over
what is easy to illustrate.

## Licence

MIT (code). Course content in `data/` is CC0 — take it and build something
better.
