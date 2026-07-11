export const APP_TITLE = 'place-app';
export const SESSION_TOKEN_KEY = 'place-app.session-token';
export const NICKNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

export const CONTENT_EVENT_TABS = Object.freeze({
  knock_new: 'knock',
  moment_new: 'explore',
  memory_engraved: 'explore',
});
