const CATALOG_KEY = "_buddy/catalog.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATALOG_WRITE_COOLDOWN_MS = 1200;

function limits(env) {
  return {
    tracks: Number(env.MAX_TRACKS || 10),
    trackBytes: Number(env.MAX_TRACK_BYTES || 5 * 1024 * 1024),
    totalBytes: Number(env.MAX_TOTAL_BYTES || 50 * 1024 * 1024),
    mutations: Number(env.MAX_LIFETIME_MUTATIONS || 100),
  };
}

function response(request, env, body, status = 200, extra = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  const origin = request.headers.get("Origin");
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "600");
  }
  if (status === 204 || status === 304) return new Response(null, { status, headers });
  if (body instanceof ReadableStream) return new Response(body, { status, headers });
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function error(request, env, status, message) {
  return response(request, env, { error: message }, status);
}

function tokenMatches(request, expected) {
  if (!expected) return false;
  const supplied = request.headers.get("Authorization") || "";
  const prefix = "Bearer ";
  if (!supplied.startsWith(prefix)) return false;
  const actual = supplied.slice(prefix.length);
  if (!actual || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function canAdmin(request, env) {
  return tokenMatches(request, env.SONGS_ADMIN_TOKEN);
}

function canDevice(request, env) {
  return tokenMatches(request, env.SONGS_DEVICE_TOKEN);
}

async function readCatalog(bucket) {
  const object = await bucket.get(CATALOG_KEY);
  if (!object) return { catalog: { revision: 1, mutations: 0, tracks: [] }, etag: null };
  try {
    const catalog = await object.json();
    if (catalog?.revision !== 1 || !Array.isArray(catalog.tracks) || !Number.isInteger(catalog.mutations)) {
      throw new Error("invalid catalog");
    }
    // R2Conditional expects the raw etag. httpEtag is the quoted HTTP-header form.
    return { catalog, etag: object.etag };
  } catch {
    throw new Error("Song catalogue is unreadable; stop and repair it before making changes.");
  }
}

async function writeCatalog(bucket, catalog, etag) {
  const options = {
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
  };
  return await bucket.put(CATALOG_KEY, JSON.stringify(catalog), options);
}

function publicTrack(track) {
  return { id: track.id, title: track.title, bytes: track.bytes, addedAt: track.addedAt };
}

function safeTitle(value) {
  if (typeof value !== "string") return "";
  const title = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64);
  return title.length >= 1 ? title : "";
}

async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;

  if (method === "OPTIONS") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.ALLOWED_ORIGIN) return error(request, env, 403, "Origin is not allowed.");
    return response(request, env, null, 204);
  }

  if (method === "GET" && url.pathname === "/health") {
    return response(request, env, { ok: true, service: "buddy-songs" });
  }

  if (parts[0] !== "v1" || parts[1] !== "tracks") return error(request, env, 404, "Route not found.");
  if (!env.SONGS) return error(request, env, 503, "Song storage is not configured.");

  if (parts.length === 2 && method === "GET") {
    if (!canAdmin(request, env) && !canDevice(request, env)) return error(request, env, 401, "Song access needs a valid token.");
    let state;
    try { state = await readCatalog(env.SONGS); }
    catch { return error(request, env, 503, "Song catalogue is unavailable."); }
    return response(request, env, {
      tracks: state.catalog.tracks.map(publicTrack),
      limits: { maxTracks: limits(env).tracks, maxTrackBytes: limits(env).trackBytes },
    });
  }

  if (parts.length === 2 && method === "POST") {
    if (!canAdmin(request, env)) return error(request, env, 401, "Owner access is required to upload songs.");
    const title = safeTitle(url.searchParams.get("title"));
    if (!title) return error(request, env, 400, "Add a song title (up to 64 characters).");
    if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("audio/mpeg")) {
      return error(request, env, 415, "Upload an MP3 audio file.");
    }
    const contentLength = Number(request.headers.get("Content-Length"));
    const cap = limits(env);
    if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > cap.trackBytes) {
      return error(request, env, 413, `Each MP3 must be 1 byte to ${cap.trackBytes} bytes.`);
    }
    let state;
    try { state = await readCatalog(env.SONGS); }
    catch { return error(request, env, 503, "Song catalogue is unavailable."); }
    const catalog = state.catalog;
    const used = catalog.tracks.reduce((sum, track) => sum + track.bytes, 0);
    if (catalog.tracks.length >= cap.tracks) return error(request, env, 409, `The library is capped at ${cap.tracks} songs.`);
    if (used + contentLength > cap.totalBytes) return error(request, env, 409, "The library storage limit has been reached.");
    if (catalog.mutations >= cap.mutations) return error(request, env, 409, "The library change safety limit has been reached.");

    // This personal library accepts one upload at a time. The dashboard disables
    // the upload button during transfer; serializing avoids quota races.
    const id = crypto.randomUUID();
    const key = `tracks/${id}.mp3`;
    let bytes;
    try { bytes = await request.arrayBuffer(); }
    catch { return error(request, env, 400, "Could not read the uploaded file."); }
    if (bytes.byteLength !== contentLength || bytes.byteLength > cap.trackBytes) {
      return error(request, env, 413, "The uploaded file did not match its declared size.");
    }

    // Reserve a lifetime mutation before attempting the object write. Even
    // repeated failed uploads cannot create unbounded billable R2 write calls.
    catalog.mutations++;
    let reservation;
    try { reservation = await writeCatalog(env.SONGS, catalog, state.etag); }
    catch (cause) {
      console.error("Song catalog reservation failed", cause?.name, cause?.message);
      return error(request, env, 503, "Could not reserve a safe upload slot.");
    }
    if (!reservation) return error(request, env, 409, "The library changed during upload. Refresh and retry.");

    const reservedAt = Date.now();
    let audioSaved = false;
    try {
      await env.SONGS.put(key, bytes, {
        httpMetadata: { contentType: "audio/mpeg", cacheControl: "private, no-store" },
        customMetadata: { title },
      });
      audioSaved = true;
      catalog.tracks.push({ id, key, title, bytes: bytes.byteLength, addedAt: new Date().toISOString() });
      // R2 limits writes to the same object key. The reservation and final
      // catalogue write target the same key, so leave a small margin after the
      // first write before committing the completed track.
      const waitMs = CATALOG_WRITE_COOLDOWN_MS - (Date.now() - reservedAt);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const saved = await writeCatalog(env.SONGS, catalog, reservation.etag);
      if (!saved) {
        await env.SONGS.delete(key);
        return error(request, env, 409, "The upload slot was reserved, but the library changed. Refresh before trying again.");
      }
    } catch (cause) {
      console.error("Song upload save failed", cause?.name, cause?.message);
      if (audioSaved) {
        try { await env.SONGS.delete(key); }
        catch { console.error("Could not remove an incomplete song object."); }
      }
      return error(request, env, 503, "Upload could not be saved. No extra song was added.");
    }
    return response(request, env, { track: publicTrack(catalog.tracks[catalog.tracks.length - 1]) }, 201);
  }

  if (parts.length === 3 && method === "DELETE") {
    if (!canAdmin(request, env)) return error(request, env, 401, "Owner access is required to remove songs.");
    const id = parts[2];
    if (!UUID.test(id)) return error(request, env, 400, "Invalid track ID.");
    let state;
    try { state = await readCatalog(env.SONGS); }
    catch { return error(request, env, 503, "Song catalogue is unavailable."); }
    const catalog = state.catalog;
    const index = catalog.tracks.findIndex((track) => track.id === id);
    if (index < 0) return error(request, env, 404, "Song not found.");
    if (catalog.mutations >= limits(env).mutations) return error(request, env, 409, "The library change safety limit has been reached.");
    const [track] = catalog.tracks.splice(index, 1);
    catalog.mutations++;
    try {
      const saved = await writeCatalog(env.SONGS, catalog, state.etag);
      if (!saved) return error(request, env, 409, "The library changed during removal. Refresh and retry.");
      await env.SONGS.delete(track.key);
    } catch { return error(request, env, 503, "Song could not be removed from the library."); }
    return response(request, env, { removed: id });
  }

  if (parts.length === 4 && parts[3] === "audio" && method === "GET") {
    if (!canDevice(request, env)) return error(request, env, 401, "Buddy playback access is not authorized.");
    const id = parts[2];
    if (!UUID.test(id)) return error(request, env, 400, "Invalid track ID.");
    // Uploaded objects use this deterministic key. Skipping a catalogue lookup
    // means each play request causes only one R2 read, preserving the free-tier
    // operation bound even at the Worker's full daily request allowance.
    const object = await env.SONGS.get(`tracks/${id}.mp3`);
    if (!object) return error(request, env, 404, "Song file is missing.");
    return response(request, env, object.body, 200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(object.size),
      "Content-Disposition": "inline",
      "Accept-Ranges": "none",
    });
  }

  return error(request, env, 404, "Route not found.");
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch { return error(request, env, 500, "Song service error."); }
  },
};
