# Compliance Co-Pilot OpenAI Proxy

A tiny Express server that holds the OpenAI key server-side and forwards
audio (Whisper) and chat (GPT-4o) calls from the mobile app.

## Why

`EXPO_PUBLIC_*` env vars are inlined into the client JS bundle at build time.
Shipping the OpenAI key that way means anyone who installs the app can extract
it from the bundle. This proxy keeps the key out of the client.

## Setup

```bash
cd server
cp .env.example .env
# put a fresh OpenAI key in OPENAI_API_KEY — rotate the old one first
npm install
npm run dev
```

In the app, set:

```
EXPO_PUBLIC_PROXY_URL=http://<your-LAN-ip>:8787
```

For an iOS simulator on the same Mac, `http://localhost:8787` works.
For a physical phone, use your Mac's LAN IP and make sure port 8787 is
reachable.

## Routes

- `POST /transcribe` — multipart `file` (m4a) → `{ text }`
- `POST /classify` — `{ transcript, today }` → tax-compliance JSON object
- `POST /itinerary` — `{ transcript }` → parsed itinerary JSON

## Deploying

This is a vanilla Node Express app, so it deploys to:

- Vercel (move `index.js` under `api/` and adapt to the Vercel function shape)
- Cloudflare Workers (rewrite using their fetch handler)
- Fly.io / Render / Railway / any Node host (no changes needed)
