import { fnv1a } from './pebble.js';

// Demo profile pictures: deterministic monogram discs. Muted, paper-friendly
// tones only — never the meaning colors (clay / live green).
const AVATAR_TONES = [
  '#B8886B', '#7C8B74', '#8A93A6', '#9A8C6E',
  '#B3776A', '#77808F', '#A98F7D', '#8F9B7A',
];

export function avatarFor(nickname = '?') {
  const hash = fnv1a(`avatar:${nickname.toLowerCase()}`);
  return {
    tone: AVATAR_TONES[hash % AVATAR_TONES.length],
    initial: (nickname[0] ?? '?').toUpperCase(),
  };
}
