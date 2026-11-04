# Buddy dashboard · 4.6

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

Commands keep the existing firmware wire format: random request ID, boot ID,
15-second expiry, QoS0 and no retention/offline queue. Chat content is rendered
as text. Unknown acknowledgements require checking device state before retrying.

## Validation

Local tests execute the actual transport, speech controller and app in simulated
DOM/broker environments. They cover auth/close races, bounds, encrypted storage,
restore/pause/forget, safe rendering and one hold-release submission. One live
negative broker login with deliberately nonexistent fixture credentials returned
code5 and mapped to auth_error. No actual user password or chat command was sent.

Windows Computer Use stopped before visual QA because it could not establish the
active browser URL. Actual Safari rendering, microphone permission and the user's
live device login remain to be checked. No claim of a physical end-to-end pass.
