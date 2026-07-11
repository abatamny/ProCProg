import { DAY_MS } from '../config.js';

export function relativeTime(createdAt, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function fadesLabel(createdAt, now = Date.now()) {
  const remaining = Math.max(0, DAY_MS - (now - Date.parse(createdAt)));
  return `fades in ${Math.max(1, Math.ceil(remaining / 3_600_000))}h`;
}

// Older live content fades toward the 24h edge (SPEC §3).
export function ageOpacity(createdAt, now = Date.now()) {
  const remaining = Math.max(0, Math.min(1, (DAY_MS - (now - Date.parse(createdAt))) / DAY_MS));
  return 0.3 + remaining * 0.7;
}

export function remainingFraction(createdAt, now = Date.now()) {
  return Math.max(0, Math.min(1, (DAY_MS - (now - Date.parse(createdAt))) / DAY_MS));
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function season(month) {
  if (month === 11 || month <= 1) return 'WINTER';
  if (month <= 4) return 'SPRING';
  if (month <= 7) return 'SUMMER';
  return 'AUTUMN';
}

// Time strata dividers (SPEC §4): "THIS WEEK", "MAY 2026", "WINTER 2025".
export function strataLabel(engravedAt, now = Date.now()) {
  const date = new Date(engravedAt);
  if (now - date.getTime() < 7 * DAY_MS) return 'THIS WEEK';
  const nowYear = new Date(now).getFullYear();
  if (date.getFullYear() === nowYear) return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return `${season(date.getMonth())} ${date.getFullYear()}`;
}

export function shortDate(iso) {
  const date = new Date(iso);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
