import { SESSION_TOKEN_KEY } from '../config.js';

export function getToken() {
  return window.localStorage.getItem(SESSION_TOKEN_KEY);
}

export function storeToken(token) {
  window.localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

async function parseJson(response) {
  return response.json().catch(() => ({}));
}

export async function fetchHealth() {
  const response = await fetch('/api/health', { cache: 'no-store' });
  if (!response.ok) throw new Error('health_failed');
  return response.json();
}

export async function validateSession(token) {
  const response = await fetch('/api/session', {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('session_failed');
  return (await response.json()).user;
}

export async function register(nickname) {
  const response = await fetch('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  const body = await parseJson(response);
  return { status: response.status, body };
}

// 202 = accepted; readiness arrives later over the socket.
export async function uploadMedia(blob) {
  const response = await fetch('/api/media', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${getToken()}`,
      'content-type': 'image/webp',
    },
    body: blob,
  });
  const body = await parseJson(response);
  if (response.status !== 202 || !body.mediaId) {
    throw new Error(body.error || 'upload_failed');
  }
  return body.mediaId;
}

async function authedGet(url) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${getToken()}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`request_failed:${response.status}`);
  return response.json();
}

export async function createMoment({ mediaId, caption }) {
  const response = await fetch('/api/moments', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${getToken()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mediaId, caption: caption || null }),
  });
  const body = await parseJson(response);
  if (!response.ok || !body.moment) throw new Error(body.error || 'capture_failed');
  return body.moment;
}

export function fetchConfirmedMomentIds() {
  return authedGet('/api/moments/confirmed').then((body) => body.momentIds ?? []);
}

export function fetchMemoriesPage({ placeId, cursor = null, limit = 10 }) {
  const params = new URLSearchParams({ placeId, limit: String(limit) });
  if (cursor) {
    params.set('beforeEngravedAt', cursor.beforeEngravedAt);
    params.set('beforeId', cursor.beforeId);
  }
  return authedGet(`/api/memories?${params}`);
}

export function fetchAlbum(memoryId) {
  return authedGet(`/api/memories/${encodeURIComponent(memoryId)}`);
}

export function fetchProfile() {
  return authedGet('/api/profile');
}
