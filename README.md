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
