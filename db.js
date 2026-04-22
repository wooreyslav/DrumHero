import { SUPABASE_URL, SUPABASE_KEY, STORAGE_BUCKET } from './config.js';

// ── Supabase client (no SDK — raw fetch) ────────────────────────────────────
const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

// ── DATABASE ─────────────────────────────────────────────────────────────────

export async function fetchTracks() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tracks?order=created_at.desc`, {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('fetchTracks error', res.status, body);
    throw new Error(`DB ${res.status}: ${body.slice(0,120)}`);
  }
  return res.json();
}

export async function insertTrack(track) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tracks`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(track),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Insert error: ${err}`);
  }
  const rows = await res.json();
  return rows[0];
}

export async function deleteTrack(id) {
  // Delete DB row
  await fetch(`${SUPABASE_URL}/rest/v1/tracks?id=eq.${id}`, {
    method: 'DELETE',
    headers,
  });
}

// ── STORAGE ──────────────────────────────────────────────────────────────────

export async function uploadFile(path, file, onProgress) {
  // Supabase Storage REST: POST to /storage/v1/object/{bucket}/{path}
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`);
    xhr.setRequestHeader('apikey', SUPABASE_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_KEY}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'true');

    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

export async function deleteStorageFiles(paths) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
  return res.ok;
}

export function getPublicUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}
