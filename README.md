# GCLF - Gordon College Lost & Found

This project now includes a built-in server-side Gemini AI integration.

Users can open the website normally. API keys stay on the server.

## Fastest Deployment (Render Free Plan)

1. Push this repo to GitHub.
2. Create a Render account and click **New +** -> **Blueprint**.
3. Select this repository (Render auto-detects `render.yaml`).
4. Set `GEMINI_API_KEY` in Render Environment Variables.
5. Deploy.

After deploy, open your Render URL. No local setup needed for end users.

## Required Environment Variables

- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL` (optional, default: `gemini-2.0-flash`)
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
  "aiConfigured": true,
  "model": "gemini-2.0-flash"
}
```
