# 说吧 Shuō Ba — learn to *speak* Mandarin

A free, open, speaking-first Mandarin course that runs entirely in your browser.
No account. No subscription. No server. Nothing you do leaves your device.

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
| Weld reading to speaking | **Characters are optional** — you can complete the course in pinyin and audio alone |
| SM-2 or a hand-tuned interval ladder | **FSRS-5** — models memory stability and difficulty per card, schedules the review for the day you'd otherwise forget |
| Gamified streaks in place of feedback | **Recall probability** — the Library shows your real chance of remembering each sentence right now |

### The method, in four moves

1. **Train the ear before the mouth.** Mandarin is tonal: `mā 妈` (mother),
   `mǎ 马` (horse), and `mà 骂` (to scold) differ only in pitch contour. Learners
   who skip this fossilise a tone-deaf accent that takes years to undo. Tone Lab
   plays one syllable and makes you pick which you heard — the drill format that
   actually shifts phonetic perception.
2. **Learn whole utterances.** You don't learn 很 by memorising "very"; you
   learn it by owning 我很好. Every card carries a word-by-word gloss, so the
   grammar is visible without ever being a grammar lesson.
3. **Produce out loud, get judged honestly.** Shadow mode builds the motor
   pattern. Produce mode shows English only and scores what you say. If the
   recogniser hears 我是美国**仁** instead of 美国**人**, that's the exact
   syllable to fix — feedback no multiple-choice app can give.
4. **Come back at the right moment.** FSRS tracks how long each sentence will
   stick and surfaces it just before it decays past your retention target.

---

## Run it

It's static files — no build step, no dependencies to install.

```bash
npm start                  # or: python -m http.server 8080
# then open http://localhost:8080
```

You **must** serve it over HTTP. Opening `index.html` as a `file://` URL makes
browsers block the course JSON (the app detects this and tells you so).

### Tests

```bash
npm test          # scheduler maths + every view rendered against a DOM shim
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
| Course, SRS, tone drills | ✅ | ✅ | ✅ |
| Mandarin audio (TTS) | ✅ | ✅ | ✅ |
| **Speech scoring (ASR)** | ✅ | 14.1+ | ❌ — Speak falls back to shadowing |

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
  deck.js               what to study next, progress stats
  ui.js                 DOM helpers, tone colouring
  views/                dashboard · tones · review · speak · library · settings
data/
  sentences.json        60 sentences, 6 units, frequency-ordered
  tones.json            minimal pairs + the 4 tone-change rules
scripts/                node test harnesses
```

## Data & privacy

Everything lives in `localStorage` under `learnchinese.v1`. There is no backend,
no analytics, and no network request after the page loads. That's also the
catch: **clearing site data erases your progress.** Settings → Export backup
gives you a JSON file you can re-import anywhere, including on another device.

---

## Roadmap

The course is a working foundation, not a finished curriculum.

- [ ] Expand to ~600 sentences (roughly HSK 1–3 spoken coverage)
- [ ] Recording playback so you can hear yourself against the native audio
- [ ] Pitch-contour visualisation from the mic — see your tone, not just a score
- [ ] Optional character track: stroke order + radical decomposition
- [ ] Listening mode: connected speech at natural speed
- [ ] Conversation drills — scripted branching dialogues
- [ ] Offline support via a service worker (PWA)

## Contributing

The highest-value contribution is **sentences**. Add to `data/sentences.json`
following the existing shape (`hanzi`, `pinyin` with tone marks, `en`, per-word
`words[]`, and `spoken` when tone sandhi changes the pronunciation). Run
`npm test` to validate. Prioritise what a learner would actually say over what
is easy to illustrate.

## Licence

MIT (code). Course content in `data/` is CC0 — take it and build something
better.
