import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPinCheck, X } from 'lucide-react';
import { fadesLabel, relativeTime, shortDate } from '../lib/time.js';

const MELT_MS = 350;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The shared "paper-to-ink inversion" viewer (SPEC §3): the tapped ellipse
 * melts into a rounded rectangle while the paper fades to full ink. Swipe
 * down follows the finger and releases past a threshold; swipe left/right
 * moves between items with the next image prefetched.
 */
export function InkViewer({
  items,
  initialId,
  origin = null,
  placeName,
  confirmedIds = null,
  onConfirm = null,
  onClose,
}) {
  const initialIndex = Math.max(0, items.findIndex((item) => item.id === initialId));
  const [index, setIndex] = useState(initialIndex);
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const [slideDir, setSlideDir] = useState(0);
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const mediaRef = useRef(null);
  const gesture = useRef(null);
  const now = Date.now();
  const item = items[Math.min(index, items.length - 1)];

  // Melt-open from the tapped ellipse into the final rounded rectangle.
  useLayoutEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (!origin || prefersReducedMotion()) {
      setEntered(true);
      return;
    }
    const to = media.getBoundingClientRect();
    const from = origin.rect;
    const sx = from.width / Math.max(1, to.width);
    const sy = from.height / Math.max(1, to.height);
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    media.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) rotate(${origin.tilt}deg) scale(${sx}, ${sy})`,
          borderRadius: origin.radius ?? '50%',
        },
        { transform: 'translate(0, 0) rotate(0deg) scale(1, 1)', borderRadius: '24px' },
      ],
      { duration: MELT_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
    );
    const timer = window.setTimeout(() => setEntered(true), MELT_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Body scroll lock while the ink sheet is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') requestClose();
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);

  // Prefetch neighbours so swiping always feels instant.
  useEffect(() => {
    for (const neighbour of [items[index + 1], items[index - 1]]) {
      if (neighbour?.mediumUrl) {
        const image = new Image();
        image.src = neighbour.mediumUrl;
      }
    }
  }, [index, items]);

  function step(direction) {
    const next = index + direction;
    if (next < 0 || next >= items.length) return;
    setSlideDir(direction);
    setIndex(next);
  }

  function requestClose() {
    if (closing) return;
    setClosing(true);
    const media = mediaRef.current;
    const root = rootRef.current;
    const reduced = prefersReducedMotion();
    if (media && origin && !reduced && index === initialIndex) {
      const to = media.getBoundingClientRect();
      const from = origin.rect;
      const sx = from.width / Math.max(1, to.width);
      const sy = from.height / Math.max(1, to.height);
      const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
      const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
      media.animate(
        [
          { transform: media.style.transform || 'translate(0,0)', borderRadius: '24px' },
          {
            transform: `translate(${dx}px, ${dy}px) rotate(${origin.tilt}deg) scale(${sx}, ${sy})`,
            borderRadius: origin.radius ?? '50%',
          },
        ],
        { duration: MELT_MS, easing: 'cubic-bezier(0.55, 0, 0.55, 0.2)', fill: 'forwards' },
      );
    } else if (media && !reduced) {
      media.animate(
        [{ transform: media.style.transform || 'none', opacity: 1 },
          { transform: 'translateY(46vh)', opacity: 0.4 }],
        { duration: 260, easing: 'ease-in', fill: 'forwards' },
      );
    }
    root?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: reduced ? 120 : MELT_MS,
      easing: 'ease-out',
      fill: 'forwards',
    });
    window.setTimeout(onClose, reduced ? 130 : MELT_MS + 10);
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    gesture.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      lastT: performance.now(),
      lastX: event.clientX,
      velocityX: 0,
    };
  }

  function onPointerMove(event) {
    const state = gesture.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      state.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      stageRef.current?.setPointerCapture(event.pointerId);
    }
    const media = mediaRef.current;
    if (!media) return;
    const timeNow = performance.now();
    state.velocityX = 0.75 * state.velocityX
      + 0.25 * ((event.clientX - state.lastX) / Math.max(1, timeNow - state.lastT));
    state.lastX = event.clientX;
    state.lastT = timeNow;

    if (state.axis === 'y' && dy > 0) {
      const scale = Math.max(0.86, 1 - dy / 900);
      media.style.transform = `translateY(${dy}px) scale(${scale})`;
      if (rootRef.current) {
        rootRef.current.style.setProperty('--sheet-dim', String(Math.max(0.4, 1 - dy / 500)));
      }
    } else if (state.axis === 'x') {
      media.style.transform = `translateX(${dx}px)`;
    }
  }

  function onPointerEnd(event) {
    const state = gesture.current;
    if (!state || state.id !== event.pointerId) return;
    gesture.current = null;
    const media = mediaRef.current;
    if (!media || !state.axis) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    if (state.axis === 'y' && dy > 100) {
      requestClose();
      return;
    }
    if (state.axis === 'x'
      && (Math.abs(dx) > 72 || Math.abs(state.velocityX) > 0.5)) {
      const direction = dx < 0 ? 1 : -1;
      const next = index + direction;
      if (next >= 0 && next < items.length) {
        media.style.transform = '';
        rootRef.current?.style.removeProperty('--sheet-dim');
        step(direction);
        return;
      }
    }
    // snap back
    media.animate(
      [{ transform: media.style.transform }, { transform: 'translate(0, 0) scale(1)' }],
      { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    media.style.transform = '';
    rootRef.current?.style.removeProperty('--sheet-dim');
  }

  const confirmed = item?.moment ? confirmedIds?.has(item.moment.id) : false;

  const metaRight = useMemo(() => {
    if (!item) return null;
    if (item.fades) return <span className="viewer__fades">{fadesLabel(item.createdAt, now)}</span>;
    if (item.memoryMeta) {
      return <span className="viewer__engraved-meta">{item.memoryMeta.presenceTotal} were here</span>;
    }
    return null;
  }, [item, now]);

  if (!item) return null;

  // Portal to <body>: the viewer must never live inside the transformed
  // pager track, or position:fixed resolves against the track and the
  // overlay lands on the wrong panel.
  return createPortal(
    <div
      className={`viewer${entered ? ' is-entered' : ''}${closing ? ' is-closing' : ''}`}
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={item.caption || 'Photo'}
    >
      <header className="viewer__top">
        <div className="viewer__place">
          <span className="live-dot" aria-hidden="true" />
          <span>{placeName}</span>
        </div>
        <button type="button" className="viewer__close" aria-label="Close" onClick={requestClose}>
          <X size={24} aria-hidden="true" />
        </button>
      </header>

      <div
        className="viewer__stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <figure
          className={`viewer__media${slideDir !== 0 ? ` slide-${slideDir > 0 ? 'left' : 'right'}` : ''}`}
          key={item.id}
          ref={mediaRef}
          style={{ backgroundColor: item.dominantColor || '#2a2a28' }}
        >
          {item.mediumUrl ? (
            <img src={item.mediumUrl} alt={item.caption || 'Captured moment'} draggable="false" />
          ) : null}
        </figure>
      </div>

      <div className="viewer__below">
        {item.moment && onConfirm ? (
          <button
            type="button"
            className={`was-here${confirmed ? ' is-confirmed' : ''}`}
            disabled={confirmed}
            onClick={() => onConfirm(item.moment.id)}
          >
            <MapPinCheck size={17} aria-hidden="true" />
            {confirmed ? 'You were here' : 'I was here'}
          </button>
        ) : null}

        {item.caption ? <p className="viewer__caption">{item.caption}</p> : null}
        {item.memoryMeta ? (
          <p className="viewer__memory-title">{item.memoryMeta.title}</p>
        ) : null}

        <div className="viewer__meta">
          <span className="meta meta--on-ink">
            {item.memoryMeta
              ? `engraved · ${shortDate(item.memoryMeta.engravedAt)}`
              : `${item.nickname} · ${relativeTime(item.createdAt, now)}`}
          </span>
          {metaRight}
        </div>

        {items.length > 1 ? (
          <div className="viewer__pager meta meta--on-ink" aria-label="Photo position">
            {index + 1} / {items.length}
          </div>
        ) : null}
      </div>

      <div className="viewer__handle" aria-hidden="true" />
    </div>,
    document.body,
  );
}
