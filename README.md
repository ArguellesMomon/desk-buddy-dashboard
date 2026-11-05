# Buddy dashboard · 4.7.1

A static Vercel dashboard for a personal ESP32 Buddy. Landing, connection and
chat are separate routes. Settings holds connection details, voice preferences,
About, FAQs, disconnect and forget. Manrope is self-hosted under its SIL licence.

## Deployment

Vercel preset Other, empty build command, output directory `.`. No environment
variables or API keys. `vercel.json` supplies route rewrites and security headers.
Use the stable production URL for saved connections; preview URLs have separate
browser storage. Existing V4.5 device firmware is compatible; no new flash needed.

## Connection

The user enters the `buddy-phone` MQTT credential, not their EMQX account password,
device credential or Gemini key. The broker/device defaults are public. Passwords
are never committed here. A successful actual device response completes setup.
“Remember this device” is on by default and saves encrypted credentials in
IndexedDB with a non-exportable AES-GCM CryptoKey. Same-origin malicious scripts
or someone using the unlocked browser can still use that connection. This is
browser-local pairing, not a server-backed login or password manager.

Authentication refusals stop and remain visible; they cannot be overwritten by
a later socket-close event. First connection has a 12-second network bound,
subscription has an 8-second bound, and no device reply after 22 seconds shows
that broker login succeeded but Buddy is unavailable. Previously live connections
retry three times with backoff. Offline, clock, permission, broker and stale-device
cases are separate. Auto reconnect never replays a voice/chat command.

The MQTT browser client explicitly uses native timers and WebSockets. Its default
`auto` timer selection creates a blob worker, which this site's strict security
policy blocks. That can interrupt the accepted-CONNACK handler before `connect`
is emitted, eventually showing a misleading reachability error. Native timers
avoid that dependency without allowing blob workers or loosening the policy.
Mobile browsers can still suspend a background tab; the existing foreground
sync/reconnect path restores it without replaying messages.

Commands keep the existing firmware wire format: random request ID, boot ID,
15-second expiry, QoS0 and no retention/offline queue. Chat content is rendered
as text. Unknown acknowledgements require checking device state before retrying.

## Validation

Local tests execute the actual transport, speech controller and app in simulated
DOM/broker environments. They cover auth/close races, bounds, encrypted storage,
restore/pause/forget, safe rendering and one hold-release submission. One live
negative broker login with deliberately nonexistent fixture credentials returned
code5 and mapped to auth_error. No actual user password or chat command was sent.

Run `node tests/browser-mqtt.cjs` with Node 22+ for the dependency-free regression.
It executes the shipped MQTT browser bundle with a simulated WebSocket peer and
a worker constructor denied by policy: default timers reproduce the exception;
the actual fixed transport reaches ready and still preserves authentication
refusals. This does not substitute for testing the user's physical iPhone.

## Personality, sound and learning

Firmware 4.7 reports its current face and quiet-hours state. The dashboard follows
that face on each state heartbeat, while message avatars retain the reply mood.
Older firmware remains compatible with a cosmetic browser-only idle fallback.
Physical OLED idle/nap improvements and the expanded emotion vocabulary require
flashing 4.7; the dashboard alone cannot change old firmware.

Learn together opens a bounded local library (12 topics, 100 review cards). Six
explicit learning actions compose normal, visible chat requests within 400 UTF-8
bytes. They never send automatically or replay on reconnect. Firmware teaching
guidance asks one question at a time, uses hints, checks reasoning and admits
uncertainty. This is guided tutoring, not model training or an automatic mastery
assessment. Chat history still contains only four recent exchanges.

Cards are explicitly saved and self-rated. Review scheduling is a transparent
increasing 1/3/7/14/30/60-day schedule with 10-minute Again and 1-day Hard; it is
not an FSRS implementation. No AI is called for saved-card review. Local browser
storage is not cloud synchronization: export/import merges backups. Failed writes
do not advance reviews; corrupt stored data is retained and can be exported as-is.
Study records are ordinary localStorage data, separate from encrypted credentials.

Optional phone robot sounds use original Web Audio chirps, off each visit until
the user enables them. They respect quiet state, stop on recording/background/
disconnect and never create an AI request. ESP32 speaker output is a separate,
disabled-by-default firmware option; the phone setting cannot turn it on. Gemini
Live still generates native audio; local chirps do not remove provider audio use.

Checks: `node tests/learning.cjs`, `node tests/chirps.cjs`, and
`node tests/browser-mqtt.cjs`. Extended app regression tests cover study actions,
literal-text card rendering, answer reveal and review scheduling as well as
connection storage and one hold-release submission. A browser check at 390px
verified topic/card creation, answer reveal and a successful review. A physical
iPhone, physical OLED nap and amplifier playback remain hardware checks.

## Reply reliability (4.7.1)

Reply failures now show distinct quota, access, working-memory, timeout, network,
text-length and protocol messages. Reply details exposes the bounded error code,
not credentials or raw API frames. Text already received remains visible with a
Partial reply label. For older firmware that clears its failed reply, a draft
already seen by this tab is retained; reopening the tab cannot recover text the
old device no longer supplies. Pre-tool filler is cleared instead of preserved.

Firmware 4.7.1 accepts confirmed generation with text even if no PCM arrives,
handles a close after confirmed generation, and prefers output transcription to
text-part fallback without duplicating streams or displaying thought parts. It
still requires generation completion and blocks pending tools, active background
work and incomplete frames. Incomplete/oversized answers are not stored as good
conversation history. There is no automatic AI retry or device-action replay.

The broader prompt covers general knowledge, reasoning, relevant follow-ups and
teaching while keeping replies within the device text budget. An expression tool
call is optional when useful; ordinary explanations already use a discussing face.
It does not add training data, unlimited memory or live web access.

`node tests/reply-status.cjs` and the extended app checks cover partial/legacy
draft preservation, error categories, safe text display and post-tool filler.
