@AGENTS.md

# My Future Health — Meet Your Digital Twin

A Digital Health Twin web app built for **START Hack 2026**. Case partner: **Prof. Dr. Robin Wilkening**, Monash University School of Public Health.

The user fills in a short health profile (or skips with realistic demo defaults), takes/uploads a selfie, and then talks to their "future self" — a Claude-powered persona grounded in cited clinical research that projects how their habits will shape their health over 5, 10, and 20 years and shows the effect visually on their own face.

## Live & Repo

- **Live**: https://health-twin-ivory.vercel.app
- **GitHub**: https://github.com/pietro12007/health-twin

## Tech Stack

- **Next.js 16** (App Router, Turbopack) — see warning above about breaking changes vs. older Next.js
- **TypeScript**, strict
- **Tailwind CSS v4**
- **Anthropic Claude API** — currently `claude-sonnet-4-5` (was Opus 4.5; switched because Opus has been overloaded). The model string lives in `app/api/chat/route.ts`.
- **TensorFlow.js** + `@tensorflow-models/face-detection` (MediaPipe FaceDetector, `tfjs` runtime) for personalised face aging
- **react-markdown + remark-gfm** for rendering Claude's responses
- **lucide-react** for icons in the simulator
- Deployed on **Vercel**

## Folder Structure

```
app/
  page.tsx                        — main UI / view orchestrator (photo → onboarding → building → dashboard → simulator → chat)
  layout.tsx, globals.css         — shell
  api/
    chat/route.ts                 — Claude streaming chat with retry on overloaded_error
    onboarding/route.ts           — per-question ack + next-question generator
    patient/route.ts              — synthetic baseline patient (random)
components/
  PhotoOnboarding.tsx             — welcome → camera/upload → review (Web getUserMedia)
  PersonalizedAgingFace.tsx       — TF.js photo aging, before/after divider, keyword reactivity
  AgingFace.tsx                   — SVG animated avatar fallback when no photo
  HealthDashboard.tsx             — score ring, risk bars, 20-year trajectory, biggest-lever panel
  BehaviorSimulator.tsx           — drag-the-levers live risk simulator (sends scenarios to Twin)
lib/
  health-types.ts                 — shared HealthData type
  health-metrics.ts               — score, 5-disease risk model, trajectory, best-change identification
  onboarding.ts                   — onboarding script + answer parsing (numeric + smoking keywords)
  patient.ts                      — seedable PRNG + synthetic-patient generator
  face-processing.ts              — TF.js face detection (lazy-loaded) + 300×300 crop
stubs/
  mediapipe-face-detection.js     — Turbopack alias stub (see caveat below)
next.config.ts                    — Turbopack resolveAlias for the stub above
```

## Current Features

- **Conversational onboarding** — Claude asks one question at a time, acknowledges each answer naturally, supports voice or text input
- **Voice I/O** — Web Speech API for input (`SpeechRecognition`) and output (`speechSynthesis`); mute toggle persists
- **Health dashboard** — animated score ring, 5 disease-risk bars (CV / T2D / Alzheimer's / metabolic syndrome / stroke), 20-year trajectory chart with current-vs-optimised lines, single-biggest-lever impact panel
- **Behavior simulator** — drag sleep / exercise / stress / HR sliders, smoking toggle; risks recompute live; "Ask my Twin about these changes" sends a structured prompt into chat
- **Personalised face aging** — selfie / upload → TF.js MediaPipe FaceDetector → before/after divider with drag handle; CSS filter + SVG overlays react to assistant text keywords (smoking, sleep, stress, exercise) and to the user's profile; flash-forward / rejuvenation moments on bad/good outcomes; opt-in WebAudio whoosh
- **SVG fallback avatar** when the user skips the photo step
- **Claude API with medical system prompt** — speaks as the user's future self, grounded in a cited research base, gives 5/10/20-year projections + one this-week action
- **Auto-retry on overloaded_error** — 3 retries with 2s fixed delay; friendly inline message ("Your Digital Twin is thinking...") if all retries fail. SDK's built-in retries are disabled (`maxRetries: 0`) so the manual count is exact.

## Environment

- API key lives in **`.env.local`** as **`ANTHROPIC_API_KEY=sk-ant-...`**
- **Each team member uses their own key.** Don't share keys, and don't commit `.env.local` (it's in `.gitignore`).
- The chat route returns a friendly text message (not a 5xx JSON) when the key is missing, so demos don't blow up — but check the server logs if responses look off.

## Running Locally

```sh
npm install
# create .env.local with ANTHROPIC_API_KEY=sk-ant-...
npm run dev
# → http://localhost:3000
```

The TF.js MediaPipe model (~3 MB) is fetched from `tfhub.dev` on first photo capture. **Demo machine needs internet** for the first run; after that the browser caches it.

## Team Collaboration Rules

- **Always `git pull` before starting a new task.** This codebase moves fast.
- **Never commit directly to `main`.** Branch (`feat/...`, `fix/...`) → push → open a PR.
- **Write clear, imperative commit messages.** Match the existing style: short title in lowercase, e.g. `add behavior simulator`, `fix face mount path`. PR description for the why.
- **After pushing, tell the team** in chat what you pushed and which files moved — especially anything in `app/page.tsx`, `lib/health-metrics.ts`, or `next.config.ts`, since those are merge-conflict hotspots.
- **Don't push anyone's `.env.local`, `.next/`, or `node_modules/`.**
- **Don't `--force` push to `main`.** Period.

## Important Caveats (for any future Claude Code session)

- **Risk math is illustrative, not clinical.** `lib/health-metrics.ts` uses cited but simplified coefficients — it is **not** a validated instrument like ACC/AHA, Framingham, QRISK3, SCORE2, or FINDRISC. The dashboard has a visible disclaimer; keep it.
- **Face aging is a stylised effect**, not a learned aging model. CSS filters + SVG overlays anchored to MediaPipe keypoints. The on-screen disclaimer ("Stylised illustration only — not a clinical projection") must stay.
- **Turbopack alias for MediaPipe.** `@tensorflow-models/face-detection` does a static ESM import of `@mediapipe/face_detection`, which is a UMD/global-only package with no ESM exports. We use the `tfjs` runtime (so the MediaPipe path is never executed), but the static import still has to resolve. `next.config.ts` aliases `@mediapipe/face_detection` to `stubs/mediapipe-face-detection.js`. **Don't remove this alias** without also changing the face-detection runtime.
- **The model string in `app/api/chat/route.ts` is `claude-sonnet-4-5`** (alias). The full snapshot is `claude-sonnet-4-5-20250929` — pin to that if you need reproducibility. Don't construct date suffixes from memory; they 404.
- **Demo-day pre-flight**: take a selfie at home first to warm the browser cache for the TF.js model; do a full dry-run of `photo → onboarding → building → dashboard → simulator → chat` on the actual demo machine over the actual network.
