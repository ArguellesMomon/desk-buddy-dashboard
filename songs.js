'use strict';
(() => {
  const API = 'https://buddy-songs.mous-buddy.workers.dev';
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);
  let token = null;
  let busy = false;

  class SongTokenStore {
    async open() {
      if (!globalThis.indexedDB || !globalThis.crypto?.subtle) throw Error('Private browser storage is unavailable here.');
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('buddy-song-private', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('owner-key');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(Error('Private browser storage could not be opened.'));
        request.onblocked = () => reject(Error('Close other Buddy tabs, then try again.'));
      });
    }
    async record(value, write = false) {
      const db = await this.open();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('owner-key', write ? 'readwrite' : 'readonly');
          const store = tx.objectStore('owner-key');
          const request = write ? (value === null ? store.delete('saved') : store.put(value, 'saved')) : store.get('saved');
          let result;
          request.onsuccess = () => { result = request.result; };
          tx.oncomplete = () => resolve(result);
          tx.onerror = tx.onabort = () => reject(Error('The private song key could not be saved.'));
        });
      } finally { db.close(); }
    }
    async save(value) {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
      await this.record({ version: 1, key, iv, sealed }, true);
    }
    async load() {
      const saved = await this.record();
      if (!saved) return null;
      if (saved.version !== 1) throw Error('Reconnect the song library to update its saved key.');
      const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: saved.iv }, saved.key, saved.sealed);
      return new TextDecoder().decode(clear);
    }
    async forget() { await this.record(null, true); }
  }

  const keyStore = new SongTokenStore();
  function showNotice(message = '', isError = false) {
    const notice = $('songsNotice');
    notice.textContent = message;
    notice.hidden = !message;
    notice.dataset.kind = isError ? 'error' : 'info';
  }
  function setBusy(value, label) {
    busy = value;
    $('songsConnectButton').disabled = value;
    $('songUploadButton').disabled = value;
    $('refreshSongs').disabled = value;
    $('forgetSongsToken').disabled = value;
    if (label) $('songsConnectionState').textContent = label;
  }
  async function call(path, options = {}, accessToken = token) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    const response = await fetch(API + path, { ...options, headers, credentials: 'omit', cache: 'no-store' });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 401) throw Error('That owner key was refused. Check the local private credentials file and try again.');
      throw Error(payload.error || `The song service returned ${response.status}.`);
    }
    return payload;
  }
  function bytesLabel(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  }
  function renderTracks(tracks, limits) {
    const list = $('songsList');
    list.replaceChildren();
    $('songLibraryCount').textContent = `${tracks.length} / ${limits.maxTracks}`;
    if (!tracks.length) {
      const empty = document.createElement('p');
      empty.className = 'fine-print songs-empty';
      empty.textContent = 'Your library is empty. Add a song below.';
      list.append(empty);
      return;
    }
    for (const track of tracks) {
      const row = document.createElement('article');
      row.className = 'song-row';
      const info = document.createElement('div');
      info.className = 'song-row-info';
      const title = document.createElement('strong');
      title.textContent = track.title;
      const size = document.createElement('span');
      size.textContent = bytesLabel(track.bytes);
      info.append(title, size);
      const remove = document.createElement('button');
      remove.className = 'text-button danger';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${track.title}`);
      remove.addEventListener('click', () => removeTrack(track));
      row.append(info, remove);
      list.append(row);
    }
  }
  async function refresh(force = false) {
    if (!token || (busy && !force)) return;
    try {
      $('songsConnectionState').textContent = 'Refreshing library…';
      const data = await call('/v1/tracks');
      renderTracks(data.tracks || [], data.limits || { maxTracks: 10, maxTrackBytes: MAX_FILE_BYTES });
      $('songsConnectionState').textContent = 'Private library connected';
      showNotice();
    } catch (error) {
      $('songsConnectionState').textContent = 'Library needs attention';
      showNotice(error.message, true);
    }
  }
  async function removeTrack(track) {
    if (busy || !globalThis.confirm(`Remove “${track.title}” from Buddy’s library?`)) return;
    setBusy(true, 'Removing song…');
    try {
      await call(`/v1/tracks/${encodeURIComponent(track.id)}`, { method: 'DELETE' });
      showNotice('Song removed.');
      await refresh(true);
    } catch (error) { showNotice(error.message, true); }
    finally { setBusy(false, 'Private library connected'); }
  }
  async function connect(event) {
    event.preventDefault();
    if (busy) return;
    const entered = $('songsToken').value.trim();
    if (!entered) { showNotice('Paste the owner key from your local private credentials file.', true); return; }
    setBusy(true, 'Checking owner key…');
    try {
      const data = await call('/v1/tracks', {}, entered);
      await keyStore.save(entered);
      token = entered;
      $('songsToken').value = '';
      $('songsConnect').hidden = true;
      $('songsManager').hidden = false;
      renderTracks(data.tracks || [], data.limits || { maxTracks: 10, maxTrackBytes: MAX_FILE_BYTES });
      showNotice();
    } catch (error) { showNotice(error.message, true); }
    finally { setBusy(false, token ? 'Private library connected' : 'Song library not connected'); }
  }
  async function upload(event) {
    event.preventDefault();
    if (busy || !token) return;
    const file = $('songFile').files?.[0];
    const title = $('songTitle').value.trim();
    if (!file) { showNotice('Choose an MP3 file first.', true); return; }
    if (!file.name.toLowerCase().endsWith('.mp3') || (file.type && file.type !== 'audio/mpeg')) { showNotice('Choose an MP3 audio file.', true); return; }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) { showNotice('Each MP3 must be 5 MiB or smaller.', true); return; }
    if (!title || title.length > 64) { showNotice('Enter a title up to 64 characters.', true); return; }
    setBusy(true, 'Uploading song…');
    try {
      const query = new URLSearchParams({ title });
      await call(`/v1/tracks?${query}`, { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: file });
      $('songUploadForm').reset();
      showNotice('Song added to Buddy’s private library.');
      await refresh(true);
    } catch (error) { showNotice(error.message, true); }
    finally { setBusy(false, 'Private library connected'); }
  }
  async function forgetKey() {
    if (busy) return;
    await keyStore.forget();
    token = null;
    $('songsManager').hidden = true;
    $('songsConnect').hidden = false;
    $('songsToken').value = '';
    $('songsList').replaceChildren();
    showNotice('Owner key forgotten from this browser.');
  }
  async function open() {
    showNotice();
    $('songsConnect').hidden = true;
    $('songsManager').hidden = true;
    try {
      token = token || await keyStore.load();
      if (!token) { $('songsConnect').hidden = false; return; }
      $('songsManager').hidden = false;
      await refresh();
    } catch (error) {
      token = null;
      $('songsConnect').hidden = false;
      showNotice(error.message, true);
    }
  }
  $('songsConnectForm').addEventListener('submit', connect);
  $('songUploadForm').addEventListener('submit', upload);
  $('songFile').addEventListener('change', () => {
    const file = $('songFile').files?.[0];
    if (file && !$('songTitle').value.trim()) $('songTitle').value = file.name.replace(/\.mp3$/i, '').slice(0, 64);
  });
  $('refreshSongs').addEventListener('click', refresh);
  $('forgetSongsToken').addEventListener('click', forgetKey);
  globalThis.BuddySongs = { open };
})();
