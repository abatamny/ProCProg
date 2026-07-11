export const SERVER_EVENT_TYPES = Object.freeze([
  'place_state',
  'presence_update',
  'knock_new',
  'moment_new',
  'moment_presence',
  'memory_engraved',
  'reaction_new',
  'content_removed',
  'relocated',
]);

export const CLIENT_EVENT_TYPES = Object.freeze([
  'auth',
  'location',
  'away',
  'back',
  'knock_send',
  'moment_presence_confirm',
  'reaction',
]);

const clientEventSet = new Set(CLIENT_EVENT_TYPES);

export function serializeEvent(type, payload) {
  return JSON.stringify({ type, payload });
}

export function parseClientEvent(data) {
  try {
    const parsed = JSON.parse(data.toString());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!clientEventSet.has(parsed.type)) return null;
    if (!parsed.payload || typeof parsed.payload !== 'object' || Array.isArray(parsed.payload)) {
      return null;
    }
    return { type: parsed.type, payload: parsed.payload };
  } catch {
    return null;
  }
}
