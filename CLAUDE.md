# CLAUDE.md — working notes for this repo

Context for any AI agent (or human) picking this project up. Read this before
changing anything; several decisions here look arbitrary and are not.

## What this is

**Shuō Ba (说吧)** — a free, zero-backend Mandarin course that runs from absolute
beginner to conversational fluency. Static files, no build step, no dependencies.

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

## The pedagogical thesis

**Recall ≠ fluency.** Memorising sentences makes a phrasebook; fluency is
generating novel sentences fast. The app therefore has two distinct engines:

- **Review** (`views/review.js`) trains recall over the fixed corpus, on FSRS.
- **Drill** (`views/drill.js`) trains *production* — grammar frames with slots
  filled at random, so the learner assembles sentences never seen before.

If you are adding a feature, know which engine it serves. The timer in Drill is
load-bearing, not decoration: correct-but-slow plateaus, so `TARGET_MS = 4000`
(roughly conversational latency) is the bar.

## Architecture

```
index.html → js/main.js (hash router) → js/views/<route>.js
                    ↓
      deck.js (corpus + what to study) → store.js (persistence)
                    ↓
      fsrs.js (scheduling) · tts.js (audio) · asr.js (scoring)
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
- `deck.availablePatterns()` gates drills to stages the learner has entered.
  Drilling a frame never heard in context is just translation homework.

## Content model

`data/course.json` lists the five stages and points at one corpus file each.
**Content grows without code changes** — add sentences to a stage file, or a new
stage to `course.json` with its own file. `deck.loadCorpus()` fetches them all in
parallel and flattens.

```
data/course.json           stages: {id, level, title, goal, canDo[], file}
data/corpus/st1..st5.json  {stage, units[], sentences[]}
data/patterns.json         generative frames
data/tones.json            minimal pairs + sandhi rules
```

Current size: **250 sentences · 25 units · 500 glossed words · 32 patterns ·
217 drillable variations.** C1 (`st5`) is the thinnest stage and the best place
to add.

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

## Testing

```bash
npm test            # both suites, 46 checks
npm run test:engine # FSRS maths + alignment scoring (pure logic)
npm run test:views  # renders every view against a DOM shim
```

`scripts/test-views.mjs` contains a ~60-line fake DOM. It is deliberately *not* a
browser — it catches runtime errors and missing-branch bugs in view code, which
is most of what actually breaks here. It runs with **no `speechSynthesis` and no
`SpeechRecognition` defined**, so it also exercises the graceful-degradation
paths. If you add a view, add it to the `views` map there.

The harness also validates corpus integrity: unique ids, unit/stage references,
stage totals, and that every pattern composes with no leftover placeholder.

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

## Roadmap priorities

In rough order of learner value:

1. **More sentences, especially B2/C1.** The engines are done; C1 has 40
   sentences and should have several hundred. This is the bottleneck to fluency.
2. **More patterns.** Cheapest fluency-per-edit in the whole repo — each frame
   generates ~8 sentences and transfers to future vocabulary.
3. **Pitch-contour feedback** from the mic — show the learner's actual tone curve
   against the target. The single biggest possible upgrade to Speak.
4. **Multi-turn dialogue** — the gap between "says sentences" and "converses".
5. Recording playback; service worker for offline; optional character track.

## Style

- Comments explain **why**, not what. The FSRS, ASR, and drill modules carry the
  pedagogical reasoning; keep that when editing.
- Learner-facing copy is plain, direct, and never condescending. No exclamation
  marks, no fake encouragement, no "Great job!" — tell the learner what's true
  and what to do next.
- Match the surrounding code: 2-space indent, single quotes, semicolons.
