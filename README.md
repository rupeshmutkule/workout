# AiRA workout starter

A local browser harness derived from AiRA API and AiRA client code. Read the short assignment in [docs/EXERCISE.md](docs/EXERCISE.md).

## Run

Requires Node.js 22.18 or later and npm. From this directory:

```sh
npm ci --ignore-scripts
npm start
```

Open the URL printed by the server. The starter default is http://127.0.0.1:4319; `PORT` in your local `.env` can override it. Stop with Ctrl+C.

The app opens on a conversational AiRA landing page and starts in Mock, with no account or key needed. Tell AiRA what you need (for example, “I’m tired, have 8 minutes, keep cues quiet, and I’m in a small room”) and it turns that sentence into an editable plan with simulated sets. Three minutes creates fewer sets than eight. The Active screen keeps the timer, fictional sequence, set progress, AiRA character and one cue in view. Rest includes a simulated ring and EffortPicker; scores 1–2 shorten the next set and extend its rest, 4–5 adjust it slightly the other way, and 3 keeps the shape. During a set, “make the next part shorter”, “make it more exciting”, “what happens next?”, “less talking”, “pause”, “repeat”, “skip”, or “finish now” changes the session. The recap separates simulated sets completed, skipped and remaining. You can explicitly save a setup for this browser tab and clear it later. Everything is fictional and simulated: it does not request movement, provide exercise or health advice, or track activity.

## Optional Gemini mode

Copy `.env.example` to `.env` and set `GEMINI_API_KEY`. The app still starts in Mock. Select Gemini and check the consent box before sending. The local backend sends only the latest message and a compact summary of the current screen/session; it does not send conversation history or the full OpenUI screen program. Phone-like numbers in the message are redacted before the request. The backend validates Gemini's structured response against an allowlist, then trusted local code applies the requested screen changes. Gemini never returns executable UI code.

## Files

- `skills/workout.md`: your interaction instructions.
- `prompts/`: output protocol and current-turn context.
- `src/shared/openui/`: parser, component registry, validation, navigation, timers and serialization.
- `src/web/`: trusted browser renderers and presentation, including `SetDots`, `EffortPicker` and `RestRing`.
- `src/server/`: prompt loading, local HTTP server, deterministic session director, mock and model adapters.
- `examples/wiring.openui`: generic offline fixture.

See [AiRA harness](docs/HARNESS.md) for the included plumbing and [runtime setup](docs/RUNTIMES.md) for optional model adapters.

## Check and package

```sh
npm run check
npx playwright install chromium
npm run test:ui
npm run package
```

The browser checks start a mock server on port 4320. They use Playwright Chromium by default; to use an installed Chrome or Edge, set `PLAYWRIGHT_CHROME_PATH` to its absolute executable path.

Packaging writes `output/workout-source.zip` locally. It includes source and records changes against this starter's baseline; it excludes `.env`, dependencies, build output and repository history. It does not submit anything. Builder tools can export a local run; optional run JSON files can be placed in `runs/`. Keep credentials out of source and exports.

The supplied tests exercise local harness behavior with fake transports. Live Gemini, OpenAI and Claude requests have not been verified by the automated checks. This browser slice is not the production AiRA application.
