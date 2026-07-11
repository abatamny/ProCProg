// Deterministic geometry (SPEC §3): the same content looks identical on every
// device because everything derives from a hash of the stable id.

export function fnv1a(id) {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function tiltFor(id) {
  return (fnv1a(id) % 17) - 8;
}

// Field-ledger prints: a whisper of tilt (±1.5°), never the old ±8°.
export function printTiltFor(id) {
  return ((fnv1a(id) % 31) / 10) - 1.5;
}

// Darkroom-print layout: photos alternate sides down the ledger, vary in
// width, and consecutive tilts must lean in opposite directions — all
// deterministic from the stable id so every device sees the same page.
export function layoutPrints(items) {
  let photoIndex = 0;
  let previousTilt = null;
  return items.map((item) => {
    if (item.type !== 'image') return item;
    let tilt = printTiltFor(item.id);
    if (tilt !== 0 && previousTilt !== null && Math.sign(tilt) === Math.sign(previousTilt)) {
      tilt = -tilt;
    }
    if (tilt !== 0) previousTilt = tilt;
    const side = photoIndex % 2 === 0 ? 'left' : 'right';
    const width = 72 + ((fnv1a(`w:${item.id}`) >>> 4) % 13); // 72–84%
    photoIndex += 1;
    return { ...item, tilt, side, width };
  });
}

// LIVE NOW bubble cluster: size encodes sqrt(presence). Motion is a slow
// orbital float (3 hash-derived waypoints, 10–14px travel) layered with a
// scale "breath" — big enough to read as alive at a glance, still
// transform-only. Time remaining is a green arc ring, never opacity.
const BUBBLE_MIN = 58;
const BUBBLE_MAX = 118;
const BUBBLE_K = 13;

export function bubbleSize(presenceCount) {
  return Math.min(BUBBLE_MAX, BUBBLE_MIN + BUBBLE_K * Math.sqrt(Math.max(0, presenceCount)));
}

export function driftFor(id) {
  const hash = fnv1a(`drift:${id}`);
  const amplitude = 10 + (hash % 5); // 10–14px orbit
  const baseAngle = (hash >>> 3) % 360;
  const points = [0, 1, 2].map((step) => {
    const jitter = (hash >>> (6 + step * 4)) % 40;
    const angle = ((baseAngle + step * 120 + jitter) * Math.PI) / 180;
    const radius = amplitude * (0.7 + ((hash >>> (step * 5)) % 30) / 100);
    return {
      x: Math.round(Math.cos(angle) * radius),
      y: Math.round(Math.sin(angle) * radius),
    };
  });
  return {
    duration: 7 + (hash % 31) / 10,          // 7.0–10.0s loop
    delay: -(((hash >>> 4) % 70) / 10),      // desync phases
    breath: 4.2 + ((hash >>> 8) % 18) / 10,  // 4.2–6.0s scale breath
    points,
  };
}

// 13 hand-placed slots (12 bubbles + overflow) forming a loose cluster.
// Percent coordinates of bubble centers inside the bubble field.
export const BUBBLE_SLOTS = [
  { x: 30, y: 32 }, { x: 62, y: 26 }, { x: 46, y: 58 },
  { x: 79, y: 52 }, { x: 16, y: 60 }, { x: 66, y: 78 },
  { x: 34, y: 84 }, { x: 88, y: 26 }, { x: 12, y: 24 },
  { x: 52, y: 12 }, { x: 86, y: 80 }, { x: 10, y: 88 },
  { x: 94, y: 56 },
];
