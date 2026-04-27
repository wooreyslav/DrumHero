// ── Drum Hero — Storage: Yandex Object Storage (S3) ──────────────────────────
// Метаданные треков хранятся в index.json внутри того же бакета.
// Файлы (MP3, MIDI) — рядом, в папках по slug-у.

import {
  YS3_BUCKET, YS3_REGION, YS3_ENDPOINT,
  YS3_ACCESS_KEY, YS3_SECRET_KEY,
} from './config.js';

// ══════════════════════════════════════════════════════════════════════════════
// AWS Signature Version 4 (Web Crypto API, без зависимостей)
// ══════════════════════════════════════════════════════════════════════════════

const enc = new TextEncoder();

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey(
    'raw', typeof key === 'string' ? enc.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}

async function hmacHex(key, msg) {
  return toHex(await hmac(key, msg));
}

async function sha256(data) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    typeof data === 'string' ? enc.encode(data) : data
  );
  return toHex(buf);
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// Возвращает заголовки с подписью для одного запроса
async function authHeaders({ method, s3Key, body, contentType }) {
  const now       = new Date();
  const dateZ     = now.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const dateShort = dateZ.slice(0, 8);
  const scope     = `${dateShort}/${YS3_REGION}/s3/aws4_request`;
  const host      = 'storage.yandexcloud.net';

  const bodyBuf  = body
    ? (body instanceof ArrayBuffer ? body : enc.encode(body).buffer)
    : enc.encode('');
  const bodyHash = await sha256(bodyBuf);

  const canonHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${dateZ}\n`;

  const signedHdrs = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const path       = `/${YS3_BUCKET}/${s3Key}`;

  const canonical = [method, path, '', canonHeaders, signedHdrs, bodyHash].join('\n');
  const sts       = ['AWS4-HMAC-SHA256', dateZ, scope, await sha256(canonical)].join('\n');

  const kDate    = await hmac(`AWS4${YS3_SECRET_KEY}`, dateShort);
  const kRegion  = await hmac(kDate,    YS3_REGION);
  const kService = await hmac(kRegion,  's3');
  const kSign    = await hmac(kService, 'aws4_request');
  const sig      = await hmacHex(kSign, sts);

  return {
    'Content-Type':         contentType,
    'x-amz-date':           dateZ,
    'x-amz-content-sha256': bodyHash,
    'Authorization':
      `AWS4-HMAC-SHA256 Credential=${YS3_ACCESS_KEY}/${scope}, ` +
      `SignedHeaders=${signedHdrs}, Signature=${sig}`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Низкоуровневые S3-операции
// ══════════════════════════════════════════════════════════════════════════════

async function s3Get(s3Key) {
  const headers = await authHeaders({
    method: 'GET', s3Key, body: null, contentType: 'application/octet-stream',
  });
  return fetch(`${YS3_ENDPOINT}/${YS3_BUCKET}/${s3Key}`, { headers });
}

async function s3Put(s3Key, body, contentType, onProgress) {
  const bodyBuf = body instanceof ArrayBuffer ? body : enc.encode(body).buffer;
  const headers = await authHeaders({ method: 'PUT', s3Key, body: bodyBuf, contentType });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${YS3_ENDPOINT}/${YS3_BUCKET}/${s3Key}`);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    if (onProgress) {
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 PUT ${s3Key} → ${xhr.status}: ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(bodyBuf);
  });
}

async function s3Delete(s3Key) {
  const headers = await authHeaders({
    method: 'DELETE', s3Key, body: null, contentType: 'application/octet-stream',
  });
  await fetch(`${YS3_ENDPOINT}/${YS3_BUCKET}/${s3Key}`, { method: 'DELETE', headers });
}

// ══════════════════════════════════════════════════════════════════════════════
// index.json — список всех треков
// ══════════════════════════════════════════════════════════════════════════════

const INDEX_KEY = 'index.json';

async function readIndex() {
  // index.json читается публично — без подписи, просто fetch
  const res = await fetch(`${YS3_ENDPOINT}/${YS3_BUCKET}/${INDEX_KEY}`);
  if (res.status === 404) return [];   // первый запуск — треков ещё нет
  if (!res.ok) throw new Error(`Не удалось прочитать index.json: ${res.status}`);
  return res.json();
}

async function writeIndex(tracks) {
  await s3Put(INDEX_KEY, JSON.stringify(tracks, null, 2), 'application/json');
}

// ══════════════════════════════════════════════════════════════════════════════
// Публичный API (интерфейс совместим со старым Supabase-вариантом)
// ══════════════════════════════════════════════════════════════════════════════

export async function fetchTracks() {
  return readIndex();
}

export async function insertTrack(track) {
  const tracks = await readIndex();
  if (!track.id)         track.id         = track.audio_path.split('/')[0];
  if (!track.created_at) track.created_at = new Date().toISOString();
  tracks.unshift(track);       // новые треки — в начало
  await writeIndex(tracks);
  return track;
}

export async function deleteTrack(id) {
  const tracks   = await readIndex();
  const filtered = tracks.filter(t => t.id !== id);
  await writeIndex(filtered);
}

// ══════════════════════════════════════════════════════════════════════════════
// Загрузка файлов
// ══════════════════════════════════════════════════════════════════════════════

export async function uploadFile(path, file, onProgress) {
  const buf = await file.arrayBuffer();
  await s3Put(path, buf, file.type || 'application/octet-stream', onProgress);
  return { path };
}

// ══════════════════════════════════════════════════════════════════════════════
// Удаление файлов из хранилища
// ══════════════════════════════════════════════════════════════════════════════

export async function deleteStorageFiles(paths) {
  await Promise.all(paths.map(p => s3Delete(p)));
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// Публичная ссылка на файл
// ══════════════════════════════════════════════════════════════════════════════

export function getPublicUrl(path) {
  return `${YS3_ENDPOINT}/${YS3_BUCKET}/${path}`;
}
