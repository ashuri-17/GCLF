# GCLF - Gordon College Lost & Found

This project includes built-in server-side AI integration with provider switching.

Users can open the website normally. API keys stay on the server.

## Fastest Deployment (Render Free Plan)

1. Push this repo to GitHub.
2. Create a Render account and click **New +** -> **Blueprint**.
3. Select this repository (Render auto-detects `render.yaml`).
4. Set environment variables in Render (see provider options below).
5. Deploy.

After deploy, open your Render URL. No local setup needed for end users.

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
- The **Reports and Analytics** panel includes a **local** mini chart (claims by month, last 6) with no API cost.

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
