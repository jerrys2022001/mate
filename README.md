# Mate English Learning Site

A product-site prototype plus lightweight Node BFF for `mate.velocai.net`.

This rebuild positions Mate as:

- the product frontend
- the BFF orchestration layer
- DeepTutor as the AI engine behind Chat, Deep Solve, KB, and Quiz

## V1 pages

- `index.html`: login / signup landing page
- `chat.html`: study chat for essay feedback, grammar help, business email, and sentence upgrades
- `knowledge-base.html`: drag-and-drop file upload, custom knowledge entry, and search screen
- `quiz.html`: deep solve and quiz generation screen

## BFF scaffold

- `server.js`: serves the static site and exposes `/api/auth/*`, `/api/chat`, `/api/deep-solve`, `/api/kb/*`, and `/api/quiz`
- `package.json`: local dev and syntax-check scripts
- `.env.example`: optional DeepTutor proxy environment variables
- `data/mate-kb.json`: seed and persisted knowledge-base entries for local mock mode
- `data/mate-users.json` and `data/mate-sessions.json`: local runtime auth data created on first signup and ignored by git

By default, the BFF runs in local mock mode. If you set `DEEPTUTOR_BASE_URL`, Mate keeps its own `/api/*` surface and adapts it to the official DeepTutor protocol underneath.

## Official DeepTutor mapping

- `Chat`: Mate `POST /api/chat` -> DeepTutor websocket `WS /api/v1/chat`
- `Deep Solve`: Mate `POST /api/deep-solve` -> DeepTutor websocket `WS /api/v1/solve`
- `Quiz`: Mate `POST /api/quiz` -> DeepTutor websocket `WS /api/v1/question/generate`
- `KB`: Mate `GET/POST /api/kb/*` -> DeepTutor `GET/POST /api/v1/knowledge/*`

This keeps the website frontend stable while the BFF handles DeepTutor-specific payloads, sessions, and knowledge-base uploads.

## Local auth flow

- `POST /api/auth/signup`: create a Mate account and start a session
- `POST /api/auth/login`: sign in with the same local account store
- `GET /api/auth/session`: restore the current session for the frontend
- `POST /api/auth/logout`: clear the session cookie

The current implementation uses Node's built-in `crypto` module for password hashing and an HttpOnly session cookie for the website flow. Protected routes now require authentication, and local KB entries are scoped to the signed-in user while seed documents stay shared.

## KB uploads

- The KB page supports drag-and-drop file upload and manual file selection.
- Mate accepts common learning assets such as `pdf`, `docx`, `txt`, `md`, `csv`, `ppt`, and `pptx`.
- Uploaded files are cached locally under `data/mate-kb-files/` and ignored by git.
- When DeepTutor is configured, the same upload flow is forwarded to the official DeepTutor knowledge-base API.
- User-owned KB documents can now be renamed or deleted directly from the document list in the KB page.
- The KB workspace now includes upload progress feedback plus source/type filters so learners can jump between starter docs, personal uploads, files, and notes quickly.

## Product direction

- Audience: IELTS / TOEFL / SAT Writing learners, business English users, and grammar-focused learners
- Core jobs: correct essays, improve expression, upgrade sentences, generate templates
- UX direction: lively, simple, product-owned interface rather than a direct DeepTutor frontend fork

## Local preview

```powershell
powershell -ExecutionPolicy Bypass -File scripts\preview.ps1 -NoOpen
```

Then open the printed local URL in a browser.

## Run the BFF directly

```powershell
node server.js
```

## Connect to DeepTutor

1. Start the official DeepTutor backend on its API port, then confirm it is reachable locally.
2. Copy `.env.example` to `.env` and set `DEEPTUTOR_BASE_URL` to your DeepTutor server, for example `http://127.0.0.1:8001`.
3. Start Mate with `node server.js`.
4. Open `/api/health` and confirm `proxyEnabled` is `true`.

Notes:

- If DeepTutor is unreachable, Mate automatically falls back to local mock responses instead of breaking the UI.
- The realtime DeepTutor routes use websocket transport, so the Node runtime used for Mate should provide a WebSocket client.
- KB uploads are mirrored into `data/mate-kb.json` so Mate still keeps a product-side record of imported learning material.
- If your DeepTutor instance does not have a working embedding provider yet, set `DEEPTUTOR_ENABLE_KB_PROXY=false` and `DEEPTUTOR_ENABLE_RAG=false`. Mate will keep `Chat / Deep Solve / Quiz` live while the KB page stays in local-store mode.
- Runtime auth files are ignored in git, so local testing accounts do not affect the repository state.

## Quick checks

```powershell
npm run check
```
