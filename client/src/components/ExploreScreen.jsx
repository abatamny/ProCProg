import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  ChevronDown,
  Grid3X3,
  Layers,
  MapPin,
  RectangleVertical,
  RefreshCw,
  X,
} from 'lucide-react';
import { DAY_MS } from '../config.js';
import { createMoment, fetchAlbum, fetchMemoriesPage, uploadMedia } from '../lib/api.js';
import { avatarFor } from '../lib/avatar.js';
import { compressToWebp } from '../lib/compress.js';
import { BUBBLE_SLOTS, bubbleSize, driftFor } from '../lib/pebble.js';
import { remainingFraction, strataLabel } from '../lib/time.js';
import { InkViewer } from './InkViewer.jsx';

const BUBBLE_CAP = 12;
const CHAMBER_MS = 640; // now ↔ kept travel time

/* Engrave flight beats (ms). The demo's peak moment — deliberately longer
   than a UI transition so 100 people can track it on a projector. */
const FLIGHT = {
  select: 380,
  gather: 680,
  descend: 850,
  stagger: 70,
  resolve: 450,
  glow: 1000,
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function KnockGlyph({ size = 23 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 4v7a4 4 0 0 1-8 0V6" />
      <path d="M7 11a4 4 0 0 0 8 0" />
      <path d="M11 20v-3" />
      <path d="M8 20h6" />
    </svg>
  );
}

function CaptureSheet({ file, connected, onCancel, onSubmit }) {
  const [caption, setCaption] = useState('');
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  return createPortal(
    <div className="capture" role="dialog" aria-modal="true" aria-label="Capture this moment">
      <header className="capture__top">
        <span className="capture__title">Capture</span>
        <button type="button" className="viewer__close" aria-label="Cancel" onClick={onCancel}>
          <X size={24} aria-hidden="true" />
        </button>
      </header>
      <div className="capture__preview">
        <img className="capture__photo" src={objectUrl} alt="Capture preview" />
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
  snapshot, nickname, connected, confirmedIds, onConfirmMoment,
  knockBadge, chipDot, suspended, onOpenKnock, onOpenProfile,
}) {
  const place = snapshot.place;
  const [deep, setDeep] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [layersOpen, setLayersOpen] = useState(false);
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
  const [flight, setFlight] = useState(null);
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
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
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

  const myAvatar = useMemo(() => avatarFor(nickname), [nickname]);
  const parentLayer = snapshot.layerStack[1] ?? null;

  // First memories page over REST: brings coverMediumUrl + the real cursor.
  useEffect(() => {
    let cancelled = false;
    setEnrich(new Map());
    setExtraMemories([]);
    setCursor(null);
    setDeep(false);
    setLayersOpen(false);
    fetchMemoriesPage({ placeId: place.id })
      .then((page) => {
        if (cancelled) return;
        setEnrich(new Map(page.memories.map((memory) => [memory.id, memory])));
        setCursor(page.nextCursor);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [place.id]);

  // New moments: pop-in for fresh arrivals; when the user is in Kept,
  // a live dot appears on the "Now" tab instead of yanking them back.
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

  // ---- Now ↔ Kept: one toggle, and swipes travel the same road ----

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

  useEffect(() => {
    function realign() { setTrackOffset(deepRef.current ? -chamberHeight() : 0, false); }
    window.addEventListener('resize', realign);
    return () => window.removeEventListener('resize', realign);
  }, []);

  function beginChamberDrag(event, mode) {
    if (suspendedRef.current || flight) return;
    if (event.target.closest?.('.gallery-switch')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // In Kept, only take over when the archive is scrolled to its top.
    if (mode === 'kept' && (keptScrollerRef.current?.scrollTop ?? 0) > 2) return;
    chamberDrag.current = {
      id: event.pointerId,
      startY: event.clientY,
      startX: event.clientX,
      mode,
      engaged: false,
      lastY: event.clientY,
      lastT: performance.now(),
      velocity: 0,
      target: event.currentTarget,
    };
  }

  function moveChamberDrag(event) {
    const drag = chamberDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dy = event.clientY - drag.startY;
    const dx = event.clientX - drag.startX;
    if (!drag.engaged) {
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        chamberDrag.current = null;
        return;
      }
      // Only the meaningful direction engages: up on Now digs; down in Kept surfaces.
      if (drag.mode === 'surface' && dy > 0) { chamberDrag.current = null; return; }
      if (drag.mode === 'kept' && dy < 0) { chamberDrag.current = null; return; }
      drag.engaged = true;
      drag.target.setPointerCapture?.(event.pointerId);
    }
    const timeNow = performance.now();
    drag.velocity = 0.75 * drag.velocity
      + 0.25 * ((event.clientY - drag.lastY) / Math.max(1, timeNow - drag.lastT));
    drag.lastY = event.clientY;
    drag.lastT = timeNow;

    const height = chamberHeight();
    if (drag.mode === 'surface') {
      setTrackOffset(Math.max(Math.min(dy, 0), -height), false);
    } else {
      setTrackOffset(-height + Math.min(Math.max(dy, 0), height), false);
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
      if (-dy > height * 0.2 || drag.velocity < -0.5) travel(true);
      else setTrackOffset(0, true);
    } else if (dy > height * 0.2 || drag.velocity > 0.5) {
      travel(false);
    } else {
      setTrackOffset(-height, true);
    }
  }

  // ---- Engrave flight (unchanged choreography, toggle-aware) ----

  useLayoutEffect(() => {
    const newMemory = snapshot.memories.find((memory) => memory.justEngraved);
    if (!newMemory || lastFlightMemory.current === newMemory.id) return;
    lastFlightMemory.current = newMemory.id;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sources = snapshot.liveMoments.filter((moment) => moment.engraving);
    const clones = [];
    if (!reduced && !suspendedRef.current) {
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

  const flightRunRef = useRef(null);
  useEffect(() => {
    if (!flight || flightRunRef.current === flight.memoryId) return undefined;
    flightRunRef.current = flight.memoryId;

    let cancelled = false;
    const watchdog = window.setTimeout(() => {
      if (!cancelled) setFlight(null);
    }, 7_000);
    (async () => {
      const keptScroller = keptScrollerRef.current;
      const card = keptScroller?.querySelector(`[data-memory-id="${flight.memoryId}"]`);

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

      await wait(FLIGHT.select);
      if (cancelled) return;

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

      const cover = card.querySelector('.gallery-item__photo');
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

      setFlight((f) => (f ? { ...f, phase: 'resolve' } : f));
      await wait(FLIGHT.resolve);
      if (cancelled) return;

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
    travel(false); // a new moment belongs to Now
    processCapture(localId, file, caption);
  }

  function retryCapture(item) {
    if (!connected) return;
    updatePending(item.localId, { state: 'uploading', error: null });
    processCapture(item.localId, item.file, item.caption, item.blob, item.mediaId);
  }

  // ---- Viewers ----

  const openViewer = useCallback((config) => setViewer(config), []);

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
    <div className="explore">
      {/* ---- quiet top: place (tap → layers) · you ---- */}
      <div className="explore-top">
        <div className="explore-top__row">
          <div className="explore-top__heading">
            <button
              type="button"
              className="place-name"
              data-morph-title
              aria-expanded={layersOpen}
              aria-controls="place-layers"
              onClick={() => setLayersOpen((open) => !open)}
            >
              {place.name}
              <span
                className={`place-name__chev${layersOpen ? ' is-open' : ''}`}
                aria-hidden="true"
              >
                <ChevronDown size={14} strokeWidth={2.2} />
              </span>
            </button>
            <p className="place-cue">
              <MapPin size={11} strokeWidth={2.2} aria-hidden="true" />
              around you now
              <span
                className={`live-dot${connected ? ' live-dot--pulse' : ' live-dot--off'}`}
                aria-hidden="true"
              />
              {snapshot.presenceCount} present
            </p>

            {layersOpen ? (
              <>
                <button
                  type="button"
                  className="layers-scrim"
                  aria-label="Close layers"
                  onClick={() => setLayersOpen(false)}
                />
                <div id="place-layers" className="layers-sheet" role="menu" aria-label="Place layers">
                  {snapshot.layerStack.map((layer, depth) => (
                    <button
                      key={layer.id}
                      type="button"
                      role="menuitem"
                      className={`lyr${depth === 0 ? ' lyr--here' : ''}`}
                      onClick={() => setLayersOpen(false)}
                    >
                      <span className="lyr__name">
                        {depth > 0 ? <span className="lyr__depth" aria-hidden="true">↳</span> : null}
                        {layer.name}
                      </span>
                      <span className="lyr__cnt">
                        <span className={`live-dot${depth === 0 ? ' live-dot--pulse' : ''}`} aria-hidden="true" />
                        {layer.presenceCount}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          <button type="button" className="idchip" onClick={onOpenProfile} aria-label="Your profile">
            <span className="idchip__disc" style={{ background: 'var(--ink)' }}>
              {myAvatar.initial}
            </span>
            <span className="idchip__name">{nickname}</span>
            {chipDot ? <span className="idchip__dot" aria-hidden="true" /> : null}
          </button>
        </div>

        <div className={`nk-toggle${deep ? ' nk-toggle--kept' : ''}`} role="tablist">
          <span className="nk-toggle__knob" aria-hidden="true" />
          <button
            type="button"
            role="tab"
            aria-selected={!deep}
            className={!deep ? 'is-on-now' : ''}
            onClick={() => travel(false)}
          >
            <span className={`live-dot${newWhileDeep ? ' live-dot--pulse' : ''}`} aria-hidden="true" />
            Now
            <span className="nk-toggle__cnt">{liveMoments.length + pending.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={deep}
            className={deep ? 'is-on-kept' : ''}
            onClick={() => travel(true)}
          >
            Kept
            <span className="nk-toggle__cnt">{memories.length}{cursor ? '+' : ''}</span>
          </button>
        </div>
      </div>

      {/* ---- the two chambers (toggle or swipe travels between them) ---- */}
      <div className="chambers-frame">
        <div className="chambers" ref={trackRef}>
          <section
            className="chamber chamber--surface"
            aria-hidden={deep}
            onPointerDown={(event) => beginChamberDrag(event, 'surface')}
            onPointerMove={moveChamberDrag}
            onPointerUp={endChamberDrag}
            onPointerCancel={endChamberDrag}
          >
            <div className={`surface-field${liveEmpty ? ' surface-field--empty' : ''}`}>
              {liveEmpty ? (
                <div className="ghost ghost--surface">
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
                <>
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
                </>
              )}
            </div>
          </section>

          <section
            className="chamber chamber--kept"
            aria-hidden={!deep}
            onPointerDown={(event) => beginChamberDrag(event, 'kept')}
            onPointerMove={moveChamberDrag}
            onPointerUp={endChamberDrag}
            onPointerCancel={endChamberDrag}
          >
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
              ) : (
                <div className={`kept-gallery kept-gallery--${viewMode}`}>
                  <header className="gallery-header">
                    <p className="gallery-header__count">
                      {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
                    </p>
                    <div className="gallery-switch" role="group" aria-label="Gallery view">
                      <button
                        type="button"
                        className={viewMode === 'grid' ? 'is-active' : ''}
                        aria-label="Grid view"
                        aria-pressed={viewMode === 'grid'}
                        onClick={() => setViewMode('grid')}
                      >
                        <Grid3X3 size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={viewMode === 'single' ? 'is-active' : ''}
                        aria-label="Single photo view"
                        aria-pressed={viewMode === 'single'}
                        onClick={() => setViewMode('single')}
                      >
                        <RectangleVertical size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </header>

                  {strata.map((group, groupIndex) => (
                    <section
                      key={group.label}
                      className="gallery-stratum"
                      style={{ '--stratum-fade': Math.max(0.78, 1 - groupIndex * 0.06) }}
                    >
                      <p className="gallery-period">{group.label}</p>
                      <div className="gallery-items">
                        {group.items.map((memory) => (
                          <article
                            key={memory.id}
                            data-memory-id={memory.id}
                            className={[
                              'gallery-item',
                              memory.photoCount > 1 ? 'gallery-item--album' : '',
                              fanning === memory.id ? 'is-fanning' : '',
                            ].filter(Boolean).join(' ') + flightClassFor(memory.id)}
                          >
                            <button
                              type="button"
                              className="gallery-item__photo"
                              style={{ backgroundColor: memory.dominantColor || 'var(--hairline)' }}
                              aria-label={`Open memory: ${memory.title}`}
                              onClick={(event) => openMemory(memory, event)}
                            >
                              {memory.coverMediumUrl ? (
                                <img src={memory.coverMediumUrl} alt="" loading="lazy" draggable="false" />
                              ) : null}
                              {memory.photoCount > 1 ? (
                                <span className="gallery-item__stack" aria-hidden="true">
                                  <Layers size={13} strokeWidth={2.2} />
                                </span>
                              ) : null}
                              <span className="gallery-item__glow" aria-hidden="true" />
                            </button>
                            {viewMode === 'single' ? (
                              <p className="gallery-item__caption">{memory.title}</p>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}

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
      </div>

      {/* ---- the two place actions: say something · capture something ---- */}
      <div className="place-actions">
        <button type="button" className="act" onClick={onOpenKnock}>
          <span className="act__btn act__btn--knock">
            <KnockGlyph />
            {knockBadge > 0 ? <span className="act__badge">{knockBadge}</span> : null}
          </span>
          <span className="act__label act__label--knock">Knock</span>
        </button>
        <button type="button" className="act" onClick={() => fileInputRef.current?.click()}>
          <span className="act__btn act__btn--capture">
            <Camera size={23} strokeWidth={1.9} aria-hidden="true" />
          </span>
          <span className="act__label act__label--capture">Capture</span>
        </button>
      </div>
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
          onClose={() => setViewer(null)}
        />
      ) : null}
    </div>
  );
}
