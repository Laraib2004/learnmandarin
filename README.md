# 说吧 Shuō Ba — learn to *speak* Mandarin

A free, open, speaking-first Mandarin course that runs entirely in your browser.
Zero to conversational. No account. No subscription. No server. Nothing you do
leaves your device.

> **说吧** (*shuō ba*) means roughly "go on — speak." That is the whole thesis.

---

## Why this exists

Most language apps optimise for daily engagement, not for the day you stand in
front of a Mandarin speaker and have to say something. This one inverts that.

| What typical apps do | What Shuō Ba does |
|---|---|
| Mention tones once, then move on | **Tone Lab first** — forced-choice ear training on minimal pairs, plus the four tone-change rules that make you sound human |
| Drill isolated words | **Sentence-level cards** — the unit of memory is a usable phrase |
| Never ask you to speak | **Speech scoring** — a Mandarin recogniser either understood you or it didn't, marked character by character |
| Only ever test recall | **Pattern drills** — you *build* sentences you have never said, against a clock |
| Weld reading to speaking | **Characters are optional** — you can complete the course in pinyin and audio alone |
| SM-2 or a hand-tuned interval ladder | **FSRS-5** — models memory stability and difficulty per card, schedules the review for the day you'd otherwise forget |
| Gamified streaks in place of feedback | **Recall probability** — the Library shows your real chance of remembering each sentence right now |

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

**250 sentences · 500 glossed words · 32 pattern frames · 217 drillable variations**

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

### Tests

```bash
npm test          # 46 checks: scheduler maths, speech scoring, every view rendered
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

## Browser support

| Feature | Chrome / Edge | Safari | Firefox |
|---|---|---|---|
| Course, SRS, tone drills, patterns | ✅ | ✅ | ✅ |
| Mandarin audio (TTS) | ✅ | ✅ | ✅ |
| **Speech scoring (ASR)** | ✅ | 14.1+ | ❌ — falls back to self-checking |

Firefox doesn't implement the Web Speech recognition API. The app degrades
rather than breaking, but **use Chrome or Edge for pronunciation scoring.**

**No Chinese voice?** Windows: Settings → Time & language → Language → add
Chinese (Simplified) → Speech. macOS/iOS ship Tingting by default. Android:
install Google Speech Services.

---

## Project layout

```
index.html              app shell + nav
css/app.css             design tokens, light/dark, tone colour-coding
js/
  main.js               hash router, view lifecycle
  fsrs.js               FSRS-5 scheduler (pure, tested)
  asr.js                speech recognition + character-level scoring
  tts.js                Mandarin text-to-speech
  store.js              localStorage persistence, export/import
  deck.js               corpus loading, study queue, progress stats
  ui.js                 DOM helpers, tone colouring
  views/                dashboard · tones · review · speak · drill · library · settings
data/
  course.json           the five stages and where their sentences live
  corpus/st1..st5.json  250 sentences, 25 units
  patterns.json         32 generative grammar frames
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
- [ ] Pitch-contour feedback from the mic — see your tone curve against the target
- [ ] Recording playback so you can hear yourself beside the native audio
- [ ] Multi-turn dialogue roleplay with branching replies
- [ ] Listening mode at natural speed with connected speech
- [ ] Optional character track: stroke order + radical decomposition
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
