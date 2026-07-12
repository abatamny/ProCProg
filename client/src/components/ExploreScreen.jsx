import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Layers, RefreshCw, X } from 'lucide-react';
import { DAY_MS } from '../config.js';
import { createMoment, fetchAlbum, fetchMemoriesPage, uploadMedia } from '../lib/api.js';
import { compressToWebp } from '../lib/compress.js';
import { BUBBLE_SLOTS, bubbleSize, driftFor, tiltFor } from '../lib/pebble.js';
import { remainingFraction, shortDate, strataLabel } from '../lib/time.js';
import { InkViewer } from './InkViewer.jsx';

const BUBBLE_CAP = 12;
const CHAMBER_MS = 640; // surface ↔ kept travel time

/* Engrave flight beats (ms). The demo's peak moment — deliberately longer
   than a UI transition so 100 people can track it on a projector. */
const FLIGHT = {
  select: 380,     // clay ring flash on the chosen bubbles, drift freezes
  gather: 680,     // bubbles cluster while the page descends underground
  descend: 850,    // the cluster travels down into the new memory card
  stagger: 70,     // per-bubble start offset during descent
  resolve: 450,    // bubbles collapse into the materializing card
  glow: 1000,      // clay afterglow on the settled card
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function CaptureSheet({ file, connected, onCancel, onSubmit }) {
  const [caption, setCaption] = useState('');
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);
  const tilt = useMemo(() => tiltFor(file.name + file.size), [file]);

  // Portaled for the same reason as the ink viewer: position:fixed must not
  // resolve against the transformed pager track.
  return createPortal(
    <div className="capture" role="dialog" aria-modal="true" aria-label="Capture this moment">
      <header className="capture__top">
        <span className="capture__title">Capture</span>
        <button type="button" className="viewer__close" aria-label="Cancel" onClick={onCancel}>
          <X size={24} aria-hidden="true" />
        </button>
      </header>
      <div className="capture__preview">
        <span
          className="capture__ellipse"
          style={{ '--tilt': `${tilt}deg`, backgroundImage: `url(${objectUrl})` }}
        />
      </div>
      <form
        className="capture__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(caption.trim());
        }}
      >
        <input
          type="text"
          value={caption}
          maxLength={100}
          placeholder="Say something about this moment…"
          aria-label="Caption"
          onChange={(event) => setCaption(event.target.value)}
        />
        <button type="submit" className="btn-clay" disabled={!connected}>
          Capture it
        </button>
        <p className="meta meta--on-ink capture__hint">
          Lives here for 24 hours. What the place keeps, it keeps together.
        </p>
      </form>
    </div>,
    document.body,
  );
}

export function ExploreScreen({
  snapshot, active, connected, confirmedIds, onConfirmMoment, onViewerToggle,
}) {
  const place = snapshot.place;
  const [deep, setDeep] = useState(false);
  const [enrich, setEnrich] = useState(() => new Map());
  const [extraMemories, setExtraMemories] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pending, setPending] = useState([]);
  const [captureFile, setCaptureFile] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [fanning, setFanning] = useState(null);
  const [freshIds, setFreshIds] = useState(() => new Set());
  const [newWhileDeep, setNewWhileDeep] = useState(false);
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [flight, setFlight] = useState(null); // {memoryId, phase, clones:[...]}
  const [now, setNow] = useState(Date.now());

  const trackRef = useRef(null);
  const keptScrollerRef = useRef(null);
  const fileInputRef = useRef(null);
  const bubbleRefs = useRef(new Map());
  const cloneRefs = useRef(new Map());
  const lastFlightMemory = useRef(null);
  const chamberDrag = useRef(null);
  const deepRef = useRef(deep);
  deepRef.current = deep;
  const activeRef = useRef(active);
  activeRef.current = active;
  const overlayOpen = Boolean(viewer || captureFile);
  const overlayRef = useRef(overlayOpen);
  overlayRef.current = overlayOpen;
  const prevMomentIds = useRef(new Set(snapshot.liveMoments.map((moment) => moment.id)));
  const pendingRef = useRef(pending);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => {
    for (const item of pendingRef.current) URL.revokeObjectURL(item.objectUrl);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // First memories page over REST: brings coverMediumUrl + the real cursor
  // (the socket snapshot carries thumbs only and no cursor).
  useEffect(() => {
    let cancelled = false;
    setEnrich(new Map());
    setExtraMemories([]);
    setCursor(null);
    setDeep(false);
    fetchMemoriesPage({ placeId: place.id })
      .then((page) => {
        if (cancelled) return;
        setEnrich(new Map(page.memories.map((memory) => [memory.id, memory])));
        setCursor(page.nextCursor);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [place.id]);

  // New moments: pop-in for fresh arrivals; if the user is underground,
  // a live dot appears on the "back to now" lip instead of yanking them up.
  useEffect(() => {
    const currentIds = new Set(snapshot.liveMoments.map((moment) => moment.id));
    const arrivals = [];
    for (const id of currentIds) {
      if (!prevMomentIds.current.has(id)) arrivals.push(id);
    }
    prevMomentIds.current = currentIds;
    if (arrivals.length === 0) return undefined;

    setFreshIds((current) => new Set([...current, ...arrivals]));
    const timer = window.setTimeout(() => {
      setFreshIds((current) => {
        const next = new Set(current);
        for (const id of arrivals) next.delete(id);
        return next;
      });
    }, 1_500);

    if (deepRef.current) setNewWhileDeep(true);
    return () => window.clearTimeout(timer);
  }, [snapshot.liveMoments]);

  // Reconcile optimistic captures with the server copies.
  useEffect(() => {
    const arrivedMedia = new Set(snapshot.liveMoments.map((moment) => moment.mediaId).filter(Boolean));
    const arrivedIds = new Set(snapshot.liveMoments.map((moment) => moment.id));
    setPending((current) => current.filter((item) => {
      const landed = (item.mediaId && arrivedMedia.has(item.mediaId))
        || (item.momentId && arrivedIds.has(item.momentId));
      if (landed) URL.revokeObjectURL(item.objectUrl);
      return !landed;
    }));
  }, [snapshot.liveMoments]);

  const liveMoments = useMemo(() => (
    snapshot.liveMoments.filter((moment) => now - Date.parse(moment.createdAt) < DAY_MS)
  ), [snapshot.liveMoments, now]);

  const bubbles = useMemo(() => {
    const sorted = [...liveMoments]
      .filter((moment) => !hiddenIds.has(moment.id))
      .sort((a, b) => b.presenceCount - a.presenceCount);
    const visible = sorted.slice(0, BUBBLE_CAP);
    const overflow = sorted.length - visible.length;
    return { visible, overflow };
  }, [liveMoments, hiddenIds]);

  const memories = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const memory of snapshot.memories) {
      seen.add(memory.id);
      merged.push({ ...memory, ...(enrich.get(memory.id) ?? {}), justEngraved: memory.justEngraved });
    }
    for (const memory of extraMemories) {
      if (!seen.has(memory.id)) {
        seen.add(memory.id);
        merged.push(memory);
      }
    }
    return merged;
  }, [snapshot.memories, enrich, extraMemories]);

  const strata = useMemo(() => {
    const groups = [];
    for (const memory of memories) {
      const label = strataLabel(memory.engravedAt, now);
      const group = groups.at(-1);
      if (group && group.label === label) group.items.push(memory);
      else groups.push({ label, items: [memory] });
    }
    return groups;
  }, [memories, now]);

  // ---- The two chambers: surface (this moment) ↕ kept (the archive) ----

  function travel(toDeep) {
    setDeep(toDeep);
    if (!toDeep) setNewWhileDeep(false);
  }

  function chamberHeight() {
    return (trackRef.current?.clientHeight ?? 0) / 2;
  }

  function setTrackOffset(px, animate) {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = animate
      ? `transform ${CHAMBER_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`
      : 'none';
    track.style.transform = `translateY(${px}px)`;
  }

  useEffect(() => {
    setTrackOffset(deep ? -chamberHeight() : 0, true);
  }, [deep]);

  // Keep the track aligned when the viewport resizes (keyboard, rotation).
  useEffect(() => {
    function realign() { setTrackOffset(deepRef.current ? -chamberHeight() : 0, false); }
    window.addEventListener('resize', realign);
    return () => window.removeEventListener('resize', realign);
  }, []);

  function beginChamberDrag(event, mode) {
    if (overlayRef.current || flight) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    chamberDrag.current = {
      id: event.pointerId,
      startY: event.clientY,
      startX: event.clientX,
      mode, // 'surface' (drag up to dig) | 'lip' (drag down to ascend)
      engaged: false,
      lastY: event.clientY,
      lastT: performance.now(),
      velocity: 0,
    };
  }

  function moveChamberDrag(event) {
    const drag = chamberDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dy = event.clientY - drag.startY;
    const dx = event.clientX - drag.startX;
    if (!drag.engaged) {
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
      if (Math.abs(dx) > Math.abs(dy)) { // horizontal → the tab pager owns it
        chamberDrag.current = null;
        return;
      }
      drag.engaged = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const timeNow = performance.now();
    drag.velocity = 0.75 * drag.velocity
      + 0.25 * ((event.clientY - drag.lastY) / Math.max(1, timeNow - drag.lastT));
    drag.lastY = event.clientY;
    drag.lastT = timeNow;

    const height = chamberHeight();
    if (drag.mode === 'surface') {
      // digging: only upward drags travel; downward gets gentle resistance
      const offset = dy < 0 ? Math.max(dy, -height) : dy * 0.15;
      setTrackOffset(offset, false);
    } else {
      // ascending: only downward drags travel
      const offset = dy > 0 ? Math.min(dy, height) : dy * 0.15;
      setTrackOffset(-height + offset, false);
    }
  }

  function endChamberDrag(event) {
    const drag = chamberDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    chamberDrag.current = null;
    if (!drag.engaged) return;
    const dy = event.clientY - drag.startY;
    const height = chamberHeight();
    if (drag.mode === 'surface') {
      const commit = -dy > height * 0.2 || drag.velocity < -0.5;
      if (commit) travel(true);
      else setTrackOffset(0, true);
    } else {
      const commit = dy > height * 0.2 || drag.velocity > 0.5;
      if (commit) travel(false);
      else setTrackOffset(-height, true);
    }
  }

  // ---- Engrave flight: bubbles dive under the surface into the archive ----

  useLayoutEffect(() => {
    const newMemory = snapshot.memories.find((memory) => memory.justEngraved);
    if (!newMemory || lastFlightMemory.current === newMemory.id) return;
    lastFlightMemory.current = newMemory.id;
    if (!activeRef.current) return; // nav dot tells the story on other tabs

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sources = snapshot.liveMoments.filter((moment) => moment.engraving);
    const clones = [];
    if (!reduced) {
      for (const moment of sources) {
        const el = bubbleRefs.current.get(moment.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) continue;
        clones.push({
          id: moment.id,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          img: moment.thumbUrl,
          color: moment.dominantColor,
        });
      }
    }
    setHiddenIds((current) => new Set([...current, ...sources.map((moment) => moment.id)]));
    setFlight({ memoryId: newMemory.id, phase: clones.length > 0 ? 'select' : 'resolve', clones });
  }, [snapshot.memories, snapshot.liveMoments]);

  // Choreography driver. Keyed to the flight id only — phase changes come
  // from inside the sequence and must not cancel it.
  const flightRunRef = useRef(null);
  useEffect(() => {
    if (!flight || flightRunRef.current === flight.memoryId) return undefined;
    flightRunRef.current = flight.memoryId;

    let cancelled = false;
    // Watchdog: whatever happens (hidden tab, stalled animation), the card
    // must never stay masked — force the end state if the beats overrun.
    const watchdog = window.setTimeout(() => {
      if (!cancelled) setFlight(null);
    }, 7_000);
    (async () => {
      const keptScroller = keptScrollerRef.current;
      const card = keptScroller?.querySelector(`[data-memory-id="${flight.memoryId}"]`);

      // Reduced-motion / no-visible-bubbles / no-card path: descend + glow.
      if (flight.clones.length === 0 || !keptScroller || !card) {
        if (keptScroller) keptScroller.scrollTop = 0;
        travel(true);
        setFlight((f) => (f ? { ...f, phase: 'resolve' } : f));
        await wait(Math.max(FLIGHT.resolve, CHAMBER_MS));
        if (cancelled) return;
        setFlight((f) => (f ? { ...f, phase: 'glow' } : f));
        await wait(FLIGHT.glow);
        if (!cancelled) setFlight(null);
        return;
      }

      // Beat 1 — selection flash plays via CSS on the mounted clones.
      await wait(FLIGHT.select);
      if (cancelled) return;

      // Beat 2 — gather into a loose cluster while the page itself descends
      // underground (the fixed clones visibly stay above the moving page).
      keptScroller.scrollTop = 0;
      const wasDeep = deepRef.current;
      if (!wasDeep) travel(true);

      const trackRect = trackRef.current.getBoundingClientRect();
      const viewCenterX = trackRect.left + trackRect.width / 2;
      const viewTop = trackRect.top;
      const centers = flight.clones.map((clone) => ({
        x: clone.rect.left + clone.rect.width / 2,
        y: clone.rect.top + clone.rect.height / 2,
      }));
      const gatherY = viewTop + (trackRect.height / 2) * 0.3;

      flight.clones.forEach((clone, index) => {
        const el = cloneRefs.current.get(clone.id);
        if (!el) return;
        const angle = (index / flight.clones.length) * Math.PI * 2;
        const gx = viewCenterX + Math.cos(angle) * 16 - centers[index].x;
        const gy = gatherY + Math.sin(angle) * 12 - centers[index].y;
        clone.gathered = { x: gx, y: gy };
        el.animate(
          [
            { transform: 'translate(0px, 0px) scale(1)' },
            { transform: `translate(${gx}px, ${gy}px) scale(0.72)` },
          ],
          { duration: FLIGHT.gather, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards', delay: index * 45 },
        );
      });

      await wait(Math.max(FLIGHT.gather + flight.clones.length * 45, wasDeep ? 0 : CHAMBER_MS + 60));
      if (cancelled) return;

      // Beat 3 — descend into the card's cover (recomputed after the travel).
      const cover = card.querySelector('.memory-card__cover');
      const coverRect = (cover ?? card).getBoundingClientRect();
      const landX = coverRect.left + coverRect.width / 2;
      const landY = coverRect.top + coverRect.height / 2;

      flight.clones.forEach((clone, index) => {
        const el = cloneRefs.current.get(clone.id);
        if (!el || !clone.gathered) return;
        const from = clone.gathered;
        const toX = landX - centers[index].x;
        const toY = landY - centers[index].y;
        const midX = (from.x + toX) / 2 + (toX - from.x) * 0.08;
        const midY = from.y + (toY - from.y) * 0.58;
        el.animate(
          [
            { transform: `translate(${from.x}px, ${from.y}px) scale(0.72)`, opacity: 1 },
            { transform: `translate(${midX}px, ${midY}px) scale(0.6)`, opacity: 1, offset: 0.55 },
            { transform: `translate(${toX}px, ${toY}px) scale(0.3)`, opacity: 0 },
          ],
          {
            duration: FLIGHT.descend,
            easing: 'cubic-bezier(0.5, 0, 0.25, 1)',
            fill: 'forwards',
            delay: index * FLIGHT.stagger,
          },
        );
      });

      await wait(FLIGHT.descend + flight.clones.length * FLIGHT.stagger);
      if (cancelled) return;

      // Beat 4 — the card resolves out of the landed bubbles.
      setFlight((f) => (f ? { ...f, phase: 'resolve' } : f));
      await wait(FLIGHT.resolve);
      if (cancelled) return;

      // Beat 5 — clay afterglow, then clean up.
      setFlight((f) => (f ? { ...f, phase: 'glow' } : f));
      await wait(FLIGHT.glow);
      if (!cancelled) setFlight(null);
    })().finally(() => window.clearTimeout(watchdog));

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight?.memoryId]);

  const hasOlder = Boolean(cursor) || (snapshot.memories.length >= 10 && enrich.size === 0);

  async function loadOlder() {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMemoriesPage({ placeId: place.id, cursor });
      setExtraMemories((current) => [...current, ...page.memories]);
      setCursor(page.nextCursor);
    } catch {
      // leave the trigger for another tap
    } finally {
      setLoadingOlder(false);
    }
  }

  // ---- Capture pipeline (optimistic, SPEC §5b) ----

  function updatePending(localId, patchValues) {
    setPending((current) => current.map((item) => (
      item.localId === localId ? { ...item, ...patchValues } : item
    )));
  }

  async function processCapture(localId, file, caption, priorBlob = null, priorMediaId = null) {
    try {
      updatePending(localId, { state: 'uploading', error: null });
      const blob = priorBlob ?? await compressToWebp(file);
      updatePending(localId, { blob });
      const mediaId = priorMediaId ?? await uploadMedia(blob);
      updatePending(localId, { mediaId, state: 'developing' });
      const moment = await createMoment({ mediaId, caption });
      updatePending(localId, { momentId: moment.id });
    } catch (error) {
      updatePending(localId, {
        state: 'failed',
        error: error.message === 'capture_rate_limited'
          ? 'One capture at a time — try again in a few seconds.'
          : 'This moment could not be captured.',
      });
    }
  }

  function submitCapture(caption) {
    const file = captureFile;
    setCaptureFile(null);
    if (!file) return;
    const localId = `capture-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
    setPending((current) => [...current, {
      localId,
      objectUrl: URL.createObjectURL(file),
      file,
      blob: null,
      mediaId: null,
      momentId: null,
      caption,
      createdAt: new Date().toISOString(),
      state: 'uploading',
      error: null,
    }]);
    travel(false); // a new moment belongs to the surface
    processCapture(localId, file, caption);
  }

  function retryCapture(item) {
    if (!connected) return;
    updatePending(item.localId, { state: 'uploading', error: null });
    processCapture(item.localId, item.file, item.caption, item.blob, item.mediaId);
  }

  // ---- Viewers ----

  const openViewer = useCallback((config) => {
    setViewer(config);
    onViewerToggle(true);
  }, [onViewerToggle]);

  function closeViewer() {
    setViewer(null);
    onViewerToggle(false);
  }

  function openBubble(moment, event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ordered = [...liveMoments].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    openViewer({
      kind: 'live-moments',
      items: ordered.map((entry) => ({
        id: entry.id,
        caption: entry.caption,
        nickname: entry.nickname,
        createdAt: entry.createdAt,
        mediumUrl: entry.mediumUrl,
        thumbUrl: entry.thumbUrl,
        dominantColor: entry.dominantColor,
        fades: true,
        moment: { id: entry.id, presenceCount: entry.presenceCount },
      })),
      initialId: moment.id,
      origin: { rect, tilt: 0 },
    });
  }

  async function openMemory(memory, event) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (memory.photoCount > 1) {
      setFanning(memory.id);
      window.setTimeout(() => setFanning(null), 260);
    }
    try {
      const album = await fetchAlbum(memory.id);
      openViewer({
        kind: 'album',
        items: album.items.map((item) => ({
          id: item.mediaId,
          caption: null,
          mediumUrl: item.mediumUrl,
          thumbUrl: item.thumbUrl,
          dominantColor: item.dominantColor,
          memoryMeta: {
            title: album.memory.title,
            presenceTotal: album.memory.presenceTotal,
            engravedAt: album.memory.engravedAt,
          },
        })),
        initialId: album.items[0]?.mediaId,
        origin: { rect, tilt: 0 },
      });
    } catch {
      // album fetch failed; leave the card as-is
    }
  }

  const liveEmpty = bubbles.visible.length === 0 && pending.length === 0;

  function flightClassFor(memoryId) {
    if (!flight || flight.memoryId !== memoryId) return '';
    if (flight.phase === 'resolve') return ' is-resolving';
    if (flight.phase === 'glow') return ' is-glowing';
    return ' is-materializing';
  }

  return (
    <div className={`explore${deep ? ' explore--deep' : ''}`}>
      <div className="chambers" ref={trackRef}>

        {/* ---- Chamber 1: the surface — this moment, today ---- */}
        <section
          className="chamber chamber--surface"
          aria-hidden={deep}
          onPointerDown={(event) => beginChamberDrag(event, 'surface')}
          onPointerMove={moveChamberDrag}
          onPointerUp={endChamberDrag}
          onPointerCancel={endChamberDrag}
        >
          <div className="surface-anchor">
            <svg width="46" height="43" viewBox="0 0 200 190" aria-hidden="true">
              <path className="surface-anchor__fill" d="M 62 34 L 150 26 L 176 96 L 128 172 L 40 146 Z" />
              <path className="surface-anchor__stroke" d="M 62 34 L 150 26 L 176 96 L 128 172 L 40 146 Z" />
            </svg>
            <div className="surface-anchor__pres">
              <span className="live-dot live-dot--pulse" aria-hidden="true" />
              <strong>{snapshot.presenceCount}</strong>
              <span>present now</span>
            </div>
          </div>
          <div className="section-rule section-rule--live section-rule--center">
            <span className="live-dot live-dot--pulse" aria-hidden="true" />
            <h2>THIS MOMENT · TODAY</h2>
          </div>

          {liveEmpty ? (
            <div className="ghost">
              <span className="ghost__bubble" aria-hidden="true" />
              <h3 className="ghost__title">Nothing is happening — yet.</h3>
              <p className="ghost__body">
                This day is still unwritten. {snapshot.presenceCount > 1
                  ? `${snapshot.presenceCount} people are here with you; someone has to go first.`
                  : 'Someone has to go first.'}
              </p>
              <button
                type="button"
                className="ghost__cta"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera size={17} strokeWidth={2} aria-hidden="true" />
                Capture this moment
              </button>
            </div>
          ) : (
            <div className="surface-field">
              {pending.map((item, pendingIndex) => {
                const slot = BUBBLE_SLOTS[(bubbles.visible.length + pendingIndex) % BUBBLE_SLOTS.length];
                return (
                  <div
                    key={item.localId}
                    className="bubble-slot bubble-slot--new"
                    style={{ '--x': `${slot.x}%`, '--y': `${slot.y}%`, '--size': '72px' }}
                  >
                    <div
                      className={`bubble bubble--pending${item.state === 'failed' ? ' bubble--failed' : ''}`}
                      style={{ backgroundImage: `url(${item.objectUrl})` }}
                    >
                      {item.state === 'failed' ? (
                        <button
                          type="button"
                          className="bubble__retry"
                          aria-label="Retry capture"
                          onClick={() => retryCapture(item)}
                        >
                          <RefreshCw size={16} aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="bubble__ring" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                );
              })}

              {bubbles.visible.map((moment, slotIndex) => {
                const slot = BUBBLE_SLOTS[slotIndex];
                const size = bubbleSize(moment.presenceCount);
                const drift = driftFor(moment.id);
                const fresh = freshIds.has(moment.id);
                return (
                  <div
                    key={moment.id}
                    ref={(el) => {
                      if (el) bubbleRefs.current.set(moment.id, el);
                      else bubbleRefs.current.delete(moment.id);
                    }}
                    className={`bubble-slot${fresh ? ' bubble-slot--new' : ''}`}
                    style={{
                      '--x': `${slot.x}%`,
                      '--y': `${slot.y}%`,
                      '--size': `${size}px`,
                      '--float-dur': `${drift.duration}s`,
                      '--float-delay': `${drift.delay}s`,
                    }}
                  >
                    <span className="bubble-shadow" aria-hidden="true" />
                    <button
                      type="button"
                      className={`bubble${moment.engraving ? ' bubble--converge' : ''}`}
                      style={{
                        '--f1x': `${drift.points[0].x}px`,
                        '--f1y': `${drift.points[0].y}px`,
                        '--f2x': `${drift.points[1].x}px`,
                        '--f2y': `${drift.points[1].y}px`,
                        '--f3x': `${drift.points[2].x}px`,
                        '--f3y': `${drift.points[2].y}px`,
                        '--breath-dur': `${drift.breath}s`,
                        '--remaining': remainingFraction(moment.createdAt, now),
                        backgroundColor: moment.dominantColor || 'var(--hairline)',
                        backgroundImage: moment.thumbUrl ? `url(${moment.thumbUrl})` : 'none',
                      }}
                      aria-label={moment.caption
                        ? `Open moment: ${moment.caption}`
                        : `Open a captured moment, ${moment.presenceCount} were here`}
                      onClick={(event) => openBubble(moment, event)}
                    >
                      {fresh ? (
                        <>
                          <span className="bubble__ripple" aria-hidden="true" />
                          <span className="bubble__ripple bubble__ripple--late" aria-hidden="true" />
                        </>
                      ) : null}
                      {moment.pulse ? (
                        <span key={moment.pulse} className="bubble__pulse" aria-hidden="true" />
                      ) : null}
                    </button>
                  </div>
                );
              })}

              {bubbles.overflow > 0 ? (
                <div
                  className="bubble-slot"
                  style={{
                    '--x': `${BUBBLE_SLOTS[12].x}%`,
                    '--y': `${BUBBLE_SLOTS[12].y}%`,
                    '--size': '52px',
                  }}
                >
                  <div className="bubble bubble--overflow">+{bubbles.overflow}</div>
                </div>
              ) : null}
            </div>
          )}

          {/* the depth marker: sediment edge + a breathing handle */}
          <button type="button" className="lip" onClick={() => travel(true)}>
            <span className="lip__grab" aria-hidden="true">⌄</span>
            <span className="lip__label">WHAT THIS PLACE KEEPS</span>
            <span className="lip__count">
              {memories.length === 0
                ? 'nothing engraved here yet'
                : `${memories.length}${cursor ? '+' : ''} ${memories.length === 1 ? 'memory' : 'memories'}, engraved where they happened`}
            </span>
          </button>
        </section>

        {/* ---- Chamber 2: what this place keeps ---- */}
        <section className="chamber chamber--kept" aria-hidden={!deep}>
          <button
            type="button"
            className="surface-lip"
            onClick={() => travel(false)}
            onPointerDown={(event) => beginChamberDrag(event, 'lip')}
            onPointerMove={moveChamberDrag}
            onPointerUp={endChamberDrag}
            onPointerCancel={endChamberDrag}
          >
            <span className="surface-lip__grab" aria-hidden="true">⌄</span>
            <span className="surface-lip__label">
              <span className={`live-dot${newWhileDeep ? ' live-dot--pulse' : ''}`} aria-hidden="true" />
              BACK TO NOW · <strong>{snapshot.presenceCount}</strong>&nbsp;PRESENT
              {newWhileDeep ? <span className="surface-lip__new">new</span> : null}
            </span>
          </button>

          <div className="kept-head">
            <h2>WHAT THIS PLACE KEEPS</h2>
          </div>

          <div className="kept-scroll" ref={keptScrollerRef}>
            {memories.length === 0 ? (
              <div className="ghost ghost--kept">
                <div className="ghost__strata" aria-hidden="true">
                  <span /><span /><span />
                </div>
                <div className="ghost__card">THE FIRST MEMORY</div>
                <h3 className="ghost__title">No memory here yet.</h3>
                <p className="ghost__body">
                  What happens here today can be engraved forever.
                  Whoever stands here a year from now will find it.
                </p>
                <button type="button" className="ghost__cta ghost__cta--quiet" onClick={() => travel(false)}>
                  ↑ Go be part of this place
                </button>
              </div>
            ) : strata.map((group, groupIndex) => (
              <div
                key={group.label}
                className="stratum"
                style={{ '--stratum-fade': Math.max(0.78, 1 - groupIndex * 0.06) }}
              >
                <p className="stratum__label">{group.label}</p>
                {group.items.map((memory) => (
                  <article
                    key={memory.id}
                    data-memory-id={memory.id}
                    className={[
                      'memory-card',
                      memory.photoCount > 1 ? 'memory-card--album' : '',
                      fanning === memory.id ? 'is-fanning' : '',
                    ].filter(Boolean).join(' ') + flightClassFor(memory.id)}
                  >
                    <button
                      type="button"
                      className="memory-card__cover"
                      style={{ backgroundColor: memory.dominantColor || 'var(--hairline)' }}
                      aria-label={`Open memory: ${memory.title}`}
                      onClick={(event) => openMemory(memory, event)}
                    >
                      {memory.coverMediumUrl ? (
                        <img
                          src={memory.coverMediumUrl}
                          alt=""
                          loading="lazy"
                          draggable="false"
                        />
                      ) : null}
                      {memory.photoCount > 1 ? (
                        <span className="memory-card__count">
                          <Layers size={12} aria-hidden="true" />
                          {memory.photoCount}
                        </span>
                      ) : null}
                      <span className="memory-card__glow" aria-hidden="true" />
                    </button>
                    <h3 className="memory-card__title">{memory.title}</h3>
                    <p className="meta">
                      {shortDate(memory.engravedAt)} · {memory.presenceTotal} were here
                      {memory.photoCount > 1 ? ` · ${memory.photoCount} photos` : ''}
                    </p>
                  </article>
                ))}
              </div>
            ))}

            {hasOlder ? (
              <button
                type="button"
                className="older-memories"
                disabled={loadingOlder}
                onClick={loadOlder}
              >
                {loadingOlder ? 'digging…' : 'older memories'}
              </button>
            ) : null}
            <div className="kept-tail" />
          </div>
        </section>
      </div>

      {active ? (
        <>
          <button
            type="button"
            className="fab"
            aria-label="Capture this place"
            aria-hidden={deep}
            tabIndex={deep ? -1 : 0}
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera size={24} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) setCaptureFile(file);
            }}
          />
        </>
      ) : null}

      {flight && flight.clones.length > 0 ? createPortal(
        <div className="flight-layer" aria-hidden="true">
          {flight.clones.map((clone) => (
            <div
              key={clone.id}
              ref={(el) => {
                if (el) cloneRefs.current.set(clone.id, el);
                else cloneRefs.current.delete(clone.id);
              }}
              className="flight-bubble"
              style={{
                left: `${clone.rect.left}px`,
                top: `${clone.rect.top}px`,
                width: `${clone.rect.width}px`,
                height: `${clone.rect.height}px`,
                backgroundColor: clone.color || 'var(--hairline)',
                backgroundImage: clone.img ? `url(${clone.img})` : 'none',
              }}
            />
          ))}
        </div>,
        document.body,
      ) : null}

      {captureFile ? (
        <CaptureSheet
          file={captureFile}
          connected={connected}
          onCancel={() => setCaptureFile(null)}
          onSubmit={submitCapture}
        />
      ) : null}

      {viewer ? (
        <InkViewer
          items={viewer.items}
          initialId={viewer.initialId}
          origin={viewer.origin}
          placeName={place.name}
          confirmedIds={confirmedIds}
          onConfirm={viewer.kind === 'live-moments' ? onConfirmMoment : null}
          onClose={closeViewer}
        />
      ) : null}
    </div>
  );
}
