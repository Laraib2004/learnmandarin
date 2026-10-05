# CLAUDE.md — working notes for this repo

Context for any AI agent (or human) picking this project up. Read this before
changing anything; several decisions here look arbitrary and are not.

## What this is

**Shuō Ba (说吧)** — a free, zero-backend Mandarin course that runs from absolute
beginner to conversational fluency. Static files, no build step, no dependencies.
Installable PWA, offline-capable, built mobile-first for iPhone 16.

## Hard constraints

These are the project's reason for existing. Do not trade them away for
convenience.

1. **Free forever, for anyone.** No paid API may become a hard dependency. Audio
   uses the browser's built-in speech synthesis; scoring uses the browser's
   built-in recogniser. Both are free and unlimited. If a feature needs a paid
   service, it must be optional and the app fully usable without it.
2. **No backend.** Everything runs client-side against `localStorage`. This is
   what makes it free to host and impossible to monetise via user data.
3. **No build step.** Plain ES modules, served as-is. Anyone can fork it, edit a
   file, and host it on GitHub Pages. Introducing a bundler breaks that promise.
4. **No account, no telemetry, no network calls after load.**
5. **Speaking is the goal.** Judge any feature by: *does this get the learner
   closer to producing Mandarin out loud?* Streaks and badges fail that test.

## The front door is a single linear path

`views/learn.js` + `data/lessons.json` is the app's entry point (route `''`).

**Design rule: one thing on screen, one button.** The original app failed a real
beginner for exactly one reason — seven tabs and no obvious start. If you are
adding to the path, do not add choices to it.

- Tabs use **progressive disclosure** via `data-needs` in `index.html`:
  `always`, `cards` (any review card exists), or a number of finished lessons.
  `applyNavVisibility()` in `main.js` enforces it. A fresh learner sees ONE tab.
- **`[hidden] { display: none !important }` in app.css is load-bearing.** Our own
  `.tabbar a { display: flex }` outranks the UA's `[hidden]` rule, so without it
  `el.hidden = true` silently does nothing. This shipped broken once; there is a
  guard test.
- `seedFromLesson()` in `deck.js` hands anything a lesson taught to the FSRS
  scheduler on completion, matched by punctuation-stripped hanzi. Without it the
  path and Review are two disconnected apps and the queue stays empty forever.
- Lesson position saves after **every step** (`store.lessons` + `saveSession`).
- Step types: `teach`, `tones`, `pickTone`, `pick`, `read`, `word`, `speak`, `char`.
  `char` takes `{c}` and renders from `characters.json` via `deck.lookupGlyph()`
  (a character, or a building block by full or squeezed form: 人 or 亻).
  Characters taught in `char` steps are seeded onto the Script track's schedule
  by `seedCharsFromLesson()` — never into the sentence queue.
  A `pick`/`read` step must have **exactly one** correct option and a `why` on
  every option — both are asserted by tests. A `pick` may carry a `big` glyph.
- `word` steps and `teach` steps with a hanzi `big` show a per-character
  breakdown (meaning + parts) automatically. A learner reported having "no clue
  what the characters mean"; do not remove it.
- Unit order is A (pinyin) → B (first words) → D (what the characters mean) →
  C (sentences). Ids are stable; array order is the path order.
- `word` and `speak` steps also show "Said as …" (`ui.spokenNote`, falling back
  to `ui.autoSandhi` when the step has no `spoken`) and a "Spelling trap" note
  per trap the word contains (`deck.trapsIn`). The traps are taught once in
  L05–L08; the notes keep pointing them out afterwards.
- The path has keyboard support (Enter continue, Space replay, 1–4 answer) and
  a persistent `aria-live` region for answers. Focus moves to the step card on
  each new step and to Continue after answering — read `hadFocus` *before*
  repainting, because browsers clear focus from a removed node a frame late.

## Audio: assume there is no Mandarin voice

This is the highest-impact failure in the whole project and it is invisible from
the code. A learner reported "every tone sounds the same"; the cause was that
the machine had **no Chinese voice installed at all**, so `speechSynthesis` fell
back to an English voice. Verified: `speechSynthesis.getVoices()` returned only
en-GB and de-DE.

- `tts.speak()` **refuses** to speak with a non-Chinese voice (an English voice
  given hanzi plays silence) and dispatches `tts:novoice` instead. `main.js`
  answers it with `voicehelp.js → showVoiceHelp()`: platform-specific install
  steps, shown at the moment the learner tapped play. The Path and Settings
  show the same card up front. Never let this fail silently again.
- `initVoices()` must always settle (it resolves with `[]` after polling), and
  `speak()` caps its wait, so nothing chained on speech can hang. Chrome also
  drops an utterance queued in the same tick as `cancel()` and can GC one
  mid-sentence — both are handled in `speak()`.
- **`js/pitch.js` is the answer to it.** Tones are taught as synthesised pitch
  contours (Chao levels → Hz via an oscillator), not speech. This is immune to a
  missing voice, works offline, and `contourSVG()` draws the picture from the
  same `CONTOURS` table that generates the audio, so they cannot drift apart.
- Do not "improve" tone teaching by making it depend on TTS again.
- `word` steps autoplay the spoken word when `hasChineseVoice()`, and fall back
  to the step's `tone` contour only when there is no voice. Tone-teaching steps
  (`tones`, `pickTone`, `teach` with `tone`) always use the contour.
- Rates below ~0.6 flatten tones badly on weak engines. Prefer repeating a
  phrase over slowing it further. Every "Slow/Slower" button uses 0.65.

## The pedagogical thesis

**Recall ≠ fluency.** Memorising sentences makes a phrasebook; fluency is
generating novel sentences fast. The app therefore has two distinct engines:

- **Review** (`views/review.js`) trains recall over the fixed corpus, on FSRS.
- **Drill** (`views/drill.js`) trains *production* — grammar frames with slots
  filled at random, so the learner assembles sentences never seen before.
- **Dialogue** (`views/dialogue.js`) trains *both, alternating*.
- **Script** (`views/script.js`) is the reading track: pinyin + characters. It is
  deliberately OPTIONAL and on its own FSRS schedule (`store.charCards`), never
  mixed into the sentence queue.

If you are adding a feature, know which engine it serves. The timer in Drill is
load-bearing, not decoration: correct-but-slow plateaus, so `TARGET_MS = 4000`
(roughly conversational latency) is the bar.

### Bidirectionality is a hard requirement

Dialogues must alternate `partner` (ZH -> EN comprehension) and `you`
(EN -> ZH production) turns. Practising one direction only produces the two
classic failures: learners who recite but cannot reply, and learners who
understand but freeze. The test harness enforces strict alternation and
near-balance between directions — **do not add a dialogue with consecutive
same-role turns**, it will fail the build.

Partner turns are audio-first: the Chinese is hidden until the learner commits
to an answer. Do not "helpfully" reveal it early — a real conversation has no
subtitles, and that is the whole point of the exercise. Comprehension
distractors are drawn from other turns at the same stage so wrong answers are
plausible Chinese rather than obvious filler.

### Chinese has no alphabet — say so

Learners arrive believing there is one. The app must keep two things distinct:

- **Pinyin** is the romanisation, the nearest thing to an alphabet. The value is
  in the *traps* (`data/pinyin.json` → `traps`): q=ch, x=sh, c=ts, z=ds, the
  buzzing i after zi/ci/si/zhi/chi/shi/ri, bare e = "uh", -ian = "yen", hidden
  vowels in iu/ui/un, and the ü hidden inside ju/qu/xu/yu. These cause most of a
  beginner accent and almost no app teaches them.
- **Hanzi** are not letters. Taught components-first: know 讠 and you can guess a
  character is about speech. Never present characters as shapes to memorise —
  every entry needs `parts` and a `story`.

Characters are ordered by frequency **in this corpus**, not by textbook order or
HSK. Regenerate that ordering if the corpus grows substantially; the payoff claim
("55% of course text") is asserted by a test and must stay true.

## Accessibility

- **Every hanzi element gets `lang="zh-CN"`, centrally in `ui.js → h()`**
  whenever its class list contains `zh`. Without it screen readers read Chinese
  with an English voice, and some browsers render Han text with a Japanese font.
  Pinyin gets `lang="zh-Latn-pinyin"`. Keep using `class: 'zh'` for hanzi.
- Tone is never signalled by colour alone: the `toneNumbers` setting adds a
  superscript digit (nǐ³), because tone 1 (red) vs tone 3 (green) is the most
  common colour-blind confusion.
- `store.load()` merges `settings` one level deep, so settings added later get
  their defaults for existing learners instead of `undefined`.

## Architecture

```
index.html → js/main.js (hash router) → js/views/<route>.js
                    ↓
      deck.js (corpus + what to study) → store.js (persistence)
                    ↓
      fsrs.js (scheduling) · tts.js (audio) · asr.js (scoring)
                    ↓
      feedback.js (toasts · audio cues · haptics)
      reminder.js (daily nudge · .ics calendar alarm)

sw.js + manifest.webmanifest + icons/   →  installable, offline PWA
```

- **Views** are `(rootEl, { navigate }) => cleanupFn | null`. They own their own
  re-render (a local `paint()`), append into `rootEl`, and return a cleanup
  function if they registered global listeners (see `ui.js` → `keys()`).
- **`js/fsrs.js` is pure and has no DOM dependency.** Keep it that way — it's the
  piece most worth testing and least worth rewriting.
- **`js/ui.js` → `h()`** is a 15-line hyperscript helper. No framework. If a view
  gets unwieldy, split the view, don't add React.

### Key invariants

- `deck.buildQueue()` returns **due reviews first, then new cards**, capped by
  `settings.newPerDay`. Never let new cards jump the queue — that's how learners
  accumulate an overdue backlog and quit.
- Grading a card with **Again (1)** re-appends it to the live session queue in
  `views/review.js`, because a 1-minute `due` would otherwise land after the
  session ended.
- `store.save()` is debounced 150ms. Call `update(fn)` rather than mutating state
  directly, or the write won't be scheduled.
- Card state shape is FSRS's, not SM-2's: `{stability, difficulty, due,
  lastReview, reps, lapses, state}`. There is no "ease factor."
- `deck.availablePatterns()` and `deck.availableDialogues()` gate content to
  stages the learner has entered. Drilling a frame never heard in context is
  just translation homework. Stage 1 is always open.
- `feedback.signal(kind, message)` is the single call for "tell the learner what
  just happened" — it fires audio, haptics, and a toast together. Prefer it over
  calling `cue`/`haptic`/`toast` separately, so channels never drift apart.

## Content model

`data/course.json` lists the five stages and points at one corpus file each.
**Content grows without code changes** — add sentences to a stage file, or a new
stage to `course.json` with its own file. `deck.loadCorpus()` fetches them all in
parallel and flattens.

```
data/lessons.json          the guided path (the app's front door)
data/course.json           stages: {id, level, title, goal, canDo[], file}
data/corpus/st1..st5.json  {stage, units[], sentences[]}
data/patterns.json         generative frames
data/dialogues.json        two-way conversations
data/pinyin.json           initials, finals, and the 8 spelling traps
data/characters.json       components, stroke rules, characters
data/tones.json            minimal pairs + sandhi rules
```

Current size: **250 sentences · 25 units · 500 glossed words · 32 patterns ·
217 drillable variations · 10 dialogues (81 turns).** C1 (`st5`) is the thinnest
stage and the best place to add.

### Dialogue schema

```jsonc
{
  "id": "d01", "stage": "st1", "title": "Meeting someone new",
  "setting": "A friend introduces you to someone at dinner.",
  "partner": "陈伟 Chén Wěi",
  "turns": [
    { "who": "partner", "hanzi": "...", "pinyin": "...", "en": "...",
      "note": "optional cultural/usage note shown after answering" }
  ]
}
```

`who` is `partner` or `you`, and the two **must** strictly alternate (see
"Bidirectionality is a hard requirement" above).

### Sentence schema

```jsonc
{
  "id": "s001", "unit": "u1",
  "hanzi": "你好", "pinyin": "nǐ hǎo",
  "spoken": "ní hǎo",          // ONLY when tone sandhi changes it
  "en": "Hello",
  "words": [{"h":"你","p":"nǐ","e":"you"}]   // gloss every word, in order
}
```

Rules when adding sentences:
- Pinyin **must** carry tone marks (`nǐ`, not `ni3`). `ui.js → toneOf()` colours
  syllables by reading the diacritic; without it everything renders as neutral.
- Set `spoken` whenever 3-3 sandhi, 不 bù→bú, or 一 yī→yì/yí applies.
- Gloss every word in `words[]`, in sentence order — the review view renders them
  as the grammar explanation.
- `id` must be globally unique across **all** stage files; `unit` must exist in
  the same file's `units[]`. The test harness enforces both.
- Ask "would a learner at this stage actually say this?" If no, it doesn't belong.

### Pattern schema

```jsonc
{
  "id": "p01", "stage": "st1",
  "name": "我想 + verb",
  "zh": "我想{X}", "pinyin": "wǒ xiǎng {X}", "en": "I want to {X}",
  "note": "why this frame works / what to watch for",
  "slots": [{"h":"喝水","p":"hē shuǐ","e":"drink water"}]
}
```

- `{X}` must appear in **all three** of `zh`, `pinyin`, `en`.
- `fillPattern()` uses **`replaceAll`**, deliberately: a frame may carry the
  placeholder twice (`"Do you have {X}? / Is there {X}?"`). A plain `.replace()`
  leaves a raw `{X}` in the learner's prompt — this was a real shipped bug.
  Note Python's `str.replace` replaces all by default, so a Python-side check
  will *not* catch the JS bug. Validate through the JS path.
- Never put Latin text in an `h` field (it goes to the Mandarin TTS). `Wi-Fi` is
  the one sanctioned exception; the test harness whitelists it.
- One good pattern is worth dozens of sentences, because it generates.

## The scheduler (js/fsrs.js)

Implements **FSRS-5** with the published default weights. Two latent variables
per card:

- **stability** — days until recall probability falls to 90%
- **difficulty** — 1..10, how fast that card's stability grows

`review(card, grade)` is pure and returns a new card. Grades are `1 Again /
2 Hard / 3 Good / 4 Easy`.

Sanity check when touching it — `npm run test:engine` asserts all of these:
- intervals grow monotonically under repeated "Good" (3d → 11d → 1.1mo → 3.3mo → 8.8mo → 1.8y)
- a lapse always *reduces* stability, never raises it
- `Easy > Good > Again` interval ordering holds
- `intervalFor(S=10, 0.9) ≈ 10` days (the definition of stability)

Do not "simplify" the weights or the damping/mean-reversion terms in
`nextDifficulty()`. They're trained parameters, not magic numbers someone guessed.

## Speech scoring (js/asr.js)

`score(target, result)` checks **every alternative** the recogniser returned and
keeps the best match. ASR is noisy, and marking a learner wrong because the
engine's *first* guess was off — when its second was exact — teaches the wrong
lesson.

`align()` does a Levenshtein backtrace to produce one mark per target character
(`{char, ok, heard}`), so the UI can point at the exact syllable that missed.
Marks always align 1:1 with the target string; there's a test for that.

Firefox has no `SpeechRecognition`. Every path that uses it must degrade, never
throw — `views/speak.js` and `views/drill.js` show the fallback pattern.

## Persistence and resume

**Nothing may ever force a restart.** Two separate mechanisms:

- *Permanent progress* — cards, scores, streaks, character cards. Already
  written on every interaction via `store.update()`.
- *Session position* — `store.saveSession(view, detail)` / `getSession()` /
  `clearSession()`. Views that span multiple steps must record position as they
  go (see `views/dialogue.js`, which saves `{id, turn, title}` every turn).
  `getSession()` returns null for anything older than 7 days: a stale resume is
  noise. Always call `clearSession()` on completion, or the dashboard offers to
  resume something already finished.

The dashboard's `resumeCard()` surfaces it. If you add a multi-step view, wire
`saveSession` into it and add a label to the `labels` map there.

## Reminders — know what is impossible

`js/reminder.js`. **A static site cannot notify a user while it is closed.** Web
Push needs a server to hold subscriptions; this app has no backend by design. Do
not add a feature that implies otherwise, and do not "fix" this by adding a
server without revisiting Hard Constraint #2.

- iOS is stricter: `Notification` only exists for a PWA added to the Home Screen
  (16.4+), and background delivery still needs push. `iosNeedsInstall()` detects
  the pre-install case so Settings can explain instead of offering a dead button.
- The layer that genuinely works is `buildICS()` — a daily-recurring VEVENT with
  a VALARM, downloaded and imported into the user's own calendar. It uses
  **floating local time** (no `Z`, no TZID) deliberately, so it fires at the
  chosen wall-clock time in any timezone. ICS requires **CRLF** line endings;
  there is a test for that.
- `reminderDue()` is suppressed by: reminder off, already studied today, already
  reminded today, or before the chosen time. All four are tested.

## Mobile and PWA

Built mobile-first against **iPhone 16 (393 x 852pt)**. Rules that are load-bearing:

- `viewport-fit=cover` in the meta tag + `env(safe-area-inset-*)` in CSS. Both
  halves are required; the meta tag alone paints under the Dynamic Island with
  no compensation.
- **`100dvh`, never `100vh`.** iOS Safari's URL bar resizes the viewport and
  `vh` measures the wrong thing. There is a test asserting no bare `100vh`.
- Inputs must be **>= 16px** or iOS zooms the page on focus. Also tested.
- `--tap: 44px` is the HIG minimum touch target; every button uses it. The test
  harness measures rendered heights and fails on anything smaller.
- The tab bar sits **after `<main>` in the DOM** so content and screen readers
  come first. On wide screens it is pulled above the content with flex `order`.
  `position: sticky` does NOT reorder anything — this shipped broken once, with
  the nav rendering at the bottom of the document at desktop width.
- `sw.js` precaches the shell and the whole course. **Bump `CACHE` when assets
  change**, or returning users keep the old files. Each file is added
  individually rather than via `addAll`, so one renamed asset cannot fail the
  entire install.
- **Offline:** navigations are network-first with a **3s timeout** — a weak
  connection hangs rather than fails, and without the timeout the app looked
  broken offline. Cache lookups use `ignoreVary` (GitHub Pages sends
  `Vary: Accept-Encoding`, which Safari has refused to match) and fallbacks use
  `ignoreSearch`. Only `ok`, non-redirected, same-origin responses are cached.
  `scripts/test-views.mjs` runs the real `sw.js` in a `vm` sandbox against fake
  offline / hanging / online networks, and fails if any shipped js/json/css/png
  file is missing from `PRECACHE` — add new files there.
- `navigator.storage.persist()` is requested at registration so Safari does not
  evict the offline copy after a week unused. iPhone Home Screen apps keep their
  own storage, separate from Safari: each must be opened online once.
- Speech *scoring* is the one thing that needs a network (Chrome's recogniser
  is server-side). `asr.errorText()` holds every view's failure copy; `network`
  tells the learner it is the connection, not them.
- `registerServiceWorker()` must check `document.readyState === 'complete'`
  before falling back to a `load` listener. It runs after `await loadCorpus()`,
  by which point `load` has usually already fired — the listener-only version
  silently never registered the worker. Both regressions have guard tests.

### Platform limits you cannot code around

- **iOS Safari has no `navigator.vibrate`.** No haptics on iPhone, installed or
  not. Audio + visual feedback carry it; never signal anything by vibration
  alone.
- **iOS Safari has no `beforeinstallprompt`.** There is no API to trigger
  installation. The Install button detects iOS and explains
  Share -> Add to Home Screen rather than pretending to work.
- Audio is blocked until a user gesture. `feedback.unlockAudio()` is called from
  the first `pointerdown`/`keydown` in `main.js`, and again from explicit taps.

## Testing

```bash
npm test            # both suites, 161 checks
npm run test:engine # FSRS maths + alignment scoring (pure logic)
npm run test:views  # renders every view against a DOM shim
```

`scripts/test-views.mjs` contains a ~60-line fake DOM. It is deliberately *not* a
browser — it catches runtime errors and missing-branch bugs in view code, which
is most of what actually breaks here. It runs with **no `speechSynthesis` and no
`SpeechRecognition` defined**, so it also exercises the graceful-degradation
paths. If you add a view, add it to the `views` map there.

The harness also validates corpus integrity (unique ids, unit/stage references,
stage totals, pattern composition), dialogue alternation and direction balance,
graceful degradation of `feedback.js` with no AudioContext and no vibrate, the
PWA asset set (manifest fields, every icon present, every precached path
resolving), and the mobile-layout CSS rules listed above.

Note the shim needs `globalThis.Node` defined, since `ui.js → h()` does
`instanceof Node`.

## Gotchas

- **`file://` does not work.** `fetch` on the course JSON is blocked. `main.js`
  catches this and shows instructions; don't "fix" it by inlining the data.
- `views/review.js` imports `refreshBadge` from `main.js`, which imports the view
  back. The cycle is safe because `refreshBadge` is a hoisted function
  declaration — keep it declared with `function`, not `const`.
- CSS dark theme is defined **three** times on purpose: `:root` (light),
  `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, and
  `:root[data-theme="dark"]`. That's what makes both the OS setting and the
  manual toggle work in both directions.
- Don't use CSS nesting — it was removed once already for browser reach.
- `settings.js`'s `paint()` is async (it awaits `initVoices()`); tests must flush
  a tick before asserting on its output.
- Heredocs choke on this corpus in Git Bash — use the Write tool for large
  JSON/JS files rather than `cat <<'EOF'`.
- When testing layout in a browser, the dev server sends no cache headers but
  Chrome still serves a stale `app.css`; bust it with a query string. A stale
  stylesheet reads exactly like "my CSS fix did nothing".
- Windows consoles are cp1252: printing Chinese from a Python one-liner throws
  `UnicodeEncodeError`. Write to a file and read it back instead.
- Never assume `window.navigator` exists — it is absent in the test shim and in
  some embedded webviews. `reminder.js` uses optional chaining for this reason.
- The bottom tab bar holds **7** items at 393px with no clipping (verified).
  Adding an eighth will overflow; move something to the header icons instead.

## Roadmap priorities

In rough order of learner value:

1. **More lessons.** The path stops at 22 (end of A1 greetings). Extending it is
   now the highest-value work in the repo — everything else is optional depth.
2. **More sentences, especially B2/C1.** The engines are done; C1 has 40
   sentences and should have several hundred. This is the bottleneck to fluency.
3. **More patterns.** Cheapest fluency-per-edit in the whole repo — each frame
   generates ~8 sentences and transfers to future vocabulary.
4. **Pitch-contour feedback** from the mic — show the learner's actual tone curve
   against the target. The single biggest possible upgrade to Speak.
5. **More dialogues**, and branching replies instead of a fixed script.
6. **More characters** — 69 now; the top 100 by corpus frequency reach ~68%.
7. Recording playback; pitch-contour visualisation; animated stroke order
   (the last needs a stroke-path dataset, which is a real download).

## Style

- Comments explain **why**, not what. The FSRS, ASR, and drill modules carry the
  pedagogical reasoning; keep that when editing.
- Learner-facing copy is plain, direct, and never condescending. No exclamation
  marks, no fake encouragement, no "Great job!" — tell the learner what's true
  and what to do next.
- Match the surrounding code: 2-space indent, single quotes, semicolons.
