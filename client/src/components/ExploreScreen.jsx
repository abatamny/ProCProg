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

/* Engrave flight beats (ms). The demo's peak moment — deliberately longer
   than a UI transition so 100 people can track it on a projector. */
const FLIGHT = {
  select: 380,     // clay ring flash on the chosen bubbles, drift freezes
  gather: 650,     // bubbles cluster; the feed auto-scrolls in sync
  descend: 850,    // the cluster travels down into the Memories zone
  stagger: 70,     // per-bubble start offset during descent
  resolve: 450,    // bubbles collapse into the materializing card
  glow: 1000,      // clay afterglow on the settled card
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function smoothScrollTo(el, top, duration) {
  return new Promise((resolve) => {
    const start = el.scrollTop;
    const delta = top - start;
    if (Math.abs(delta) < 4 || duration <= 0) {
      el.scrollTop = top;
      resolve();
      return;
    }
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      el.scrollTop = top;
      resolve();
    }
    // rAF never fires in a hidden tab — without this guard the flight would
    // hang forever if the user backgrounds the app mid-engrave.
    const guard = window.setTimeout(finish, duration + 250);
    const t0 = performance.now();
    function step(t) {
      if (done) return;
      const p = Math.min(1, (t - t0) / duration);
      const eased = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
      el.scrollTop = start + delta * eased;
      if (p < 1) requestAnimationFrame(step);
      else {
        window.clearTimeout(guard);
        finish();
      }
    }
    requestAnimationFrame(step);
  });
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
  const [enrich, setEnrich] = useState(() => new Map());
  const [extraMemories, setExtraMemories] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pending, setPending] = useState([]);
  const [captureFile, setCaptureFile] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [fanning, setFanning] = useState(null);
  const [newAtTop, setNewAtTop] = useState(0);
  const [freshIds, setFreshIds] = useState(() => new Set());
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [flight, setFlight] = useState(null); // {memoryId, phase, clones:[...]}
  const [now, setNow] = useState(Date.now());
  const scrollerRef = useRef(null);
  const depthRef = useRef(null);
  const fileInputRef = useRef(null);
  const bubbleRefs = useRef(new Map());
  const cloneRefs = useRef(new Map());
  const lastFlightMemory = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;
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
    fetchMemoriesPage({ placeId: place.id })
      .then((page) => {
        if (cancelled) return;
        setEnrich(new Map(page.memories.map((memory) => [memory.id, memory])));
        setCursor(page.nextCursor);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [place.id]);

  // New moments: pop-in animation for fresh arrivals, and the "N new
  // moments ↑" pill when the user is scrolled deep.
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

    const scroller = scrollerRef.current;
    if (scroller && scroller.scrollTop > 320) {
      setNewAtTop((count) => count + arrivals.length);
    }
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

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (scroller.scrollTop <= 320) setNewAtTop(0);
    // "Going underground": the paper leans toward stone as you dig.
    if (depthRef.current) {
      depthRef.current.style.opacity = String(Math.min(0.55, scroller.scrollTop / 1600));
    }
  }

  const liveMoments = useMemo(() => (
    snapshot.liveMoments.filter((moment) => now - Date.parse(moment.createdAt) < DAY_MS)
  ), [snapshot.liveMoments, now]);

  // Size order decides slot placement so big bubbles sit central. Moments
  // taken by an engrave flight are dropped here (their clones own the story).
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

  // ---- Engrave flight: bubbles detach, travel down, become the card ----

  // Trigger: a freshly engraved memory landed in the snapshot. Capture the
  // source bubbles' screen rects BEFORE hiding them (layout effect runs
  // pre-paint, so the originals never flash frozen).
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
    }, 6_500);
    (async () => {
      const scroller = scrollerRef.current;
      const card = scroller?.querySelector(`[data-memory-id="${flight.memoryId}"]`);

      // Reduced-motion / no-visible-bubbles / no-card path: resolve + glow only.
      if (flight.clones.length === 0 || !scroller || !card) {
        setFlight((f) => (f ? { ...f, phase: 'resolve' } : f));
        await wait(FLIGHT.resolve);
        if (cancelled) return;
        setFlight((f) => (f ? { ...f, phase: 'glow' } : f));
        await wait(FLIGHT.glow);
        if (!cancelled) setFlight(null);
        return;
      }

      // Beat 1 — selection flash plays via CSS on the mounted clones.
      await wait(FLIGHT.select);
      if (cancelled) return;

      // Beat 2 — gather into a loose cluster while the feed scrolls the
      // landing point into view (the clones are fixed-position, so they
      // visibly "lift off the page" as it moves under them).
      const scrollerRect = scroller.getBoundingClientRect();
      const cardTopInScroller = card.getBoundingClientRect().top - scrollerRect.top + scroller.scrollTop;
      const targetScroll = Math.max(0, Math.min(
        cardTopInScroller - scrollerRect.height * 0.42,
        scroller.scrollHeight - scroller.clientHeight,
      ));
      const scrollPromise = smoothScrollTo(scroller, targetScroll, FLIGHT.gather);

      const centers = flight.clones.map((clone) => ({
        x: clone.rect.left + clone.rect.width / 2,
        y: clone.rect.top + clone.rect.height / 2,
      }));
      const gatherX = scrollerRect.left + scrollerRect.width / 2;
      const gatherY = scrollerRect.top + scrollerRect.height * 0.38;

      flight.clones.forEach((clone, index) => {
        const el = cloneRefs.current.get(clone.id);
        if (!el) return;
        const angle = (index / flight.clones.length) * Math.PI * 2;
        const gx = gatherX + Math.cos(angle) * 16 - centers[index].x;
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

      await Promise.all([scrollPromise, wait(FLIGHT.gather + flight.clones.length * 45)]);
      if (cancelled) return;

      // Beat 3 — descend into the card's cover (recomputed after the scroll).
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
        // A gentle arc: the midpoint bows slightly toward the page center.
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
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
    <div className="explore">
      <div className="explore__depth" ref={depthRef} aria-hidden="true" />
      <div className="explore__scroller" ref={scrollerRef} onScroll={handleScroll}>

        <section className="explore__live">
          <div className="section-rule section-rule--live">
            <span className="live-dot live-dot--pulse" aria-hidden="true" />
            <h2>LIVE NOW · fades in 24h</h2>
          </div>

          {liveEmpty ? (
            <p className="explore__live-empty">
              Nothing live right now. Be the first to capture this place. ↘
            </p>
          ) : (
            <div className="bubble-field" style={{ touchAction: 'pan-y' }}>
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
        </section>

        <section className="explore__memories">
          <div className="section-rule section-rule--engraved">
            <h2>MEMORIES</h2>
          </div>

          {memories.length === 0 ? (
            <p className="explore__memories-empty">
              This place has no memory yet. Be here when something happens.
            </p>
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
                    {/* Covers always use the 800px medium — never the thumb
                        tier — so full-width cards stay sharp. */}
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
        </section>
        <div className="explore__tail" />
      </div>

      {newAtTop > 0 ? (
        <button
          type="button"
          className="pill pill--top"
          onClick={() => {
            setNewAtTop(0);
            scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <span className="live-dot" aria-hidden="true" />
          {newAtTop} new {newAtTop === 1 ? 'moment' : 'moments'} ↑
        </button>
      ) : null}

      {active ? (
        <>
          <button
            type="button"
            className="fab"
            aria-label="Capture this place"
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
