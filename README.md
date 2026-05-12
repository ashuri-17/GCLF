# GCLF - Gordon College Lost & Found

This project includes built-in server-side AI integration with provider switching.

Users can open the website normally. API keys stay on the server.

## Fastest Deployment (Render Free Plan)

1. Push this repo to GitHub.
2. Create a Render account and click **New +** -> **Blueprint**.
3. Select this repository (Render auto-detects `render.yaml`).
4. Set environment variables in Render (see provider options below).
5. Deploy.

After deploy, open your **Render Web Service** URL (the service that runs `npm start` / `node server.js`). Static-only hosts (e.g. GitHub Pages) cannot run `POST /api/ai` and the AI summary will show a configuration error.

## AI Provider Settings

- `AI_PROVIDER` = `gemini` or `openrouter`

If `AI_PROVIDER=gemini`:
- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL` (optional, default: `gemini-2.0-flash`)

If `AI_PROVIDER=openrouter`:
- `OPENROUTER_API_KEY` (required)
- `OPENROUTER_MODEL` (optional, default: `openai/gpt-oss-120b:free`)

## AI (admin dashboard)

- The **floating chatbot is removed**. There is no chat UI or prompts to type.
- On **Admin → Overview**, an **AI-powered summary** card loads automatically from `/api/ai` using the same server-side keys (`GEMINI_API_KEY` or OpenRouter). Results are **cached ~8 minutes** (and when metrics unchanged) to limit API usage. Use **Refresh** on that card to force a new summary.
- The **Reports and Analytics** panel includes **data tables** (metrics, claims, report queues, categories, locations, monthly counts), a **visual trend bar**, **rule-based admin tips** (no API cost), and optional **AI** narrative split into **Snapshot** vs **Suggested improvements** when `POST /api/ai` works.

General:
- `PORT` (set automatically by Render)

## Local Run (for development only)

1. Create `.env` from `.env.example`.
2. Run:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Quick Health Check

The server exposes:

- `GET /api/health`

Expected response:

```json
{
  "ok": true,
  "provider": "gemini",
  "aiConfigured": true,
  "model": "gemini-2.0-flash"
}
```
