import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const DAY_MS = 24 * 60 * 60 * 1_000;

function relativeTime(createdAt, now) {
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  return `${hours}h ago`;
}

function fadeLabel(createdAt, now) {
  const remaining = Math.max(0, DAY_MS - (now - Date.parse(createdAt)));
  const hours = Math.max(1, Math.ceil(remaining / (60 * 60 * 1_000)));
  return `fades in ${hours}h`;
}

export function MediaViewer({ items, initialId, place, onClose }) {
  const initialIndex = Math.max(0, items.findIndex((item) => item.id === initialId));
  const [index, setIndex] = useState(initialIndex);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const gestureStart = useRef(null);
  const now = Date.now();
  const item = items[index];

  const imageUrl = useMemo(() => (
    item?.mediumUrl ?? item?.originalUrl ?? item?.thumbUrl ?? null
  ), [item]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeyDown(event) {
      if (event.key === 'Escape') requestClose();
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1));
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(items.length - 1, value + 1));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [items.length]);

  useEffect(() => {
    const next = items[index + 1];
    const nextUrl = next?.mediumUrl ?? next?.originalUrl ?? next?.thumbUrl;
    if (nextUrl) {
      const image = new Image();
      image.src = nextUrl;
    }
  }, [index, items]);

  function requestClose() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 350);
  }

  function onTouchStart(event) {
    const touch = event.touches[0];
    gestureStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchMove(event) {
    if (!gestureStart.current) return;
    const touch = event.touches[0];
    const x = touch.clientX - gestureStart.current.x;
    const y = Math.max(0, touch.clientY - gestureStart.current.y);
    setDrag({ x, y });
  }

  function onTouchEnd() {
    if (drag.y > 96 && drag.y > Math.abs(drag.x)) {
      requestClose();
    } else if (drag.x < -64 && index < items.length - 1) {
      setIndex((value) => value + 1);
    } else if (drag.x > 64 && index > 0) {
      setIndex((value) => value - 1);
    }
    gestureStart.current = null;
    setDrag({ x: 0, y: 0 });
  }

  if (!item) return null;

  return (
    <div
      className={`media-viewer${closing ? ' media-viewer--closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Photo knock"
    >
      <header className="media-viewer__header">
        <div className="media-viewer__place">
          <span className="live-dot live-dot--small" aria-hidden="true" />
          <span>{place.name}</span>
        </div>
        <button className="viewer-close" type="button" aria-label="Close photo" onClick={requestClose}>
          <X aria-hidden="true" size={24} />
        </button>
      </header>

      <div
        className="media-viewer__stage"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="media-viewer__media-wrap"
          style={{
            '--source-tilt': `${item.tilt}deg`,
            '--drag-x': `${drag.x}px`,
            '--drag-y': `${drag.y}px`,
          }}
        >
          {imageUrl ? (
            <img src={imageUrl} alt={item.content || `Photo left by ${item.nickname}`} />
          ) : (
            <div
              className="media-viewer__placeholder"
              style={{ backgroundColor: item.dominantColor || '#E5E3DB' }}
            />
          )}
        </div>

        <div className="media-viewer__caption">
          {item.content ? <p>{item.content}</p> : null}
          <div className="media-viewer__meta">
            <span>{item.nickname} · {relativeTime(item.createdAt, now)}</span>
            <span>{fadeLabel(item.createdAt, now)}</span>
          </div>
        </div>
      </div>

      {items.length > 1 ? (
        <div className="media-viewer__paging" aria-label="Photo navigation">
          <button
            type="button"
            aria-label="Previous photo"
            disabled={index === 0}
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span>{index + 1} / {items.length}</span>
          <button
            type="button"
            aria-label="Next photo"
            disabled={index === items.length - 1}
            onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="media-viewer__handle" aria-hidden="true" />
    </div>
  );
}
