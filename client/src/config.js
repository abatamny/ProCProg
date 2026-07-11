// The visible app title is deliberately one constant (SPEC: project name TBD).
export const APP_TITLE = 'place-app';
export const SESSION_TOKEN_KEY = 'place-app.session-token';
export const NICKNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
export const DAY_MS = 24 * 60 * 60 * 1_000;
