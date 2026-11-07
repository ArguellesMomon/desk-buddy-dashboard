# Buddy songs: Cloudflare setup and cost guardrails

The R2 bucket `buddy-songs` should stay Standard with Public Access disabled.
The Worker is the only application path to the bucket; never add the bucket to
`r2.dev`, a public custom domain, or the browser's static files.

## Free-plan guardrails

- Keep the Worker on **Workers Free**. Its request quota is 100,000/day; requests
  beyond the limit fail with Cloudflare error 1027. Do not select Workers Paid.
- Every Worker route performs at most one R2 read. The maximum 100,000 Worker
  requests/day is about 3.1 million/month, below R2 Standard's 10 million free
  Class B operations/month.
- Uploads are limited to 10 current MP3s, 5 MiB each, and 50 MiB total. A
  persistent lifetime counter reserves before any upload attempt and permits at
  most 100 library changes. Even if every reservation leaves an orphaned file
  after a rare storage failure, at most 100 files × 5 MiB = 500 MiB can be
  created through this Worker, below R2's 10 GB-month Standard allowance.
  Catalog and audio writes are capped at a few hundred Class A operations,
  below the 1 million monthly allowance.
- There are no public audio URLs or direct R2 credentials in the website/device.
  Buddy audio is streamed through this Worker. This is required for the request
  bound to apply.
- The usage caps apply to this application path. They are not an account-wide
  R2 spend cap. Other account activity, direct dashboard/API use, or switching
  to a paid plan can still create charges. Cloudflare budget alerts are notices,
  not automatic shutoffs.

## Current deployment

- Worker: `buddy-songs`
- Endpoint: `https://buddy-songs.mous-buddy.workers.dev`
- Account workers.dev subdomain: `mous-buddy.workers.dev`
- R2 binding: `SONGS` → `buddy-songs` (bucket remains private)
- Worker secrets `SONGS_ADMIN_TOKEN` and `SONGS_DEVICE_TOKEN` are configured.
- The private secret file is local and gitignored. Never commit it or paste its
  contents into chat.
- The Vercel dashboard has a private song-library manager. Connect it using the
  local owner token in `.buddy-songs-secrets.json`; the token is kept in that
  browser's encrypted IndexedDB and is not part of the static site.
- One personal MP3 is in the private bucket. Dashboard upload and removal are
  subject to the limits above. Device playback is still a separate firmware
  update: the ESP32 must stream `/v1/tracks/<id>/audio` with its device token and
  decode MP3 to I2S. Do not put either token in public source control.

The account subdomain is account-wide. Changing it moves existing Workers to the
new hostname; the previous `cloudflare-songs.workers.dev` hostname no longer
routes. The health endpoint was confirmed over HTTPS at the endpoint above.

## Re-deploy

From this folder, run `npx wrangler deploy` using the signed-in Cloudflare
account. The Wrangler plan must remain **Workers Free**. The existing bucket
binding and limits are in `wrangler.toml`; do not enable a public bucket domain
or upgrade to Workers Paid.
