import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ImagePlus, RefreshCw, Send } from 'lucide-react';
import { compressImage, uploadImage } from '../lib/media.js';
import { MediaViewer } from './MediaViewer.jsx';

const DAY_MS = 24 * 60 * 60 * 1_000;

function hashMessageId(id) {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function relativeTime(createdAt, now) {
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  return `${Math.floor(elapsedMinutes / 60)}h ago`;
}

function ageOpacity(createdAt, now) {
  const remainingFraction = Math.max(0, Math.min(1, (
    DAY_MS - (now - Date.parse(createdAt))
  ) / DAY_MS));
  return 0.28 + remainingFraction * 0.72;
}

function layoutKnocks(knocks) {
  let photoIndex = 0;
  let previousTilt = null;
  return knocks.map((knock) => {
    if (knock.type !== 'image') return knock;
    const hash = hashMessageId(knock.id);
    let tilt = (hash % 17) - 8;
    if (tilt !== 0 && previousTilt !== null && Math.sign(tilt) === Math.sign(previousTilt)) {
      tilt *= -1;
    }
    if (tilt !== 0) previousTilt = tilt;
    const aspectRatio = 1.15 + ((hash >>> 8) % 31) / 100;
    const offset = photoIndex % 2 === 0 ? 'left' : 'right';
    photoIndex += 1;
    return { ...knock, tilt, aspectRatio, offset };
  });
}

function KnockImage({ src, alt, eager = false }) {
  const [loaded, setLoaded] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(eager);
  const frameRef = useRef(null);

  useEffect(() => {
    if (eager || typeof IntersectionObserver !== 'function') {
      setShouldLoad(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: '240px 0px' });
    if (frameRef.current) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [eager, src]);

  if (!src) return null;
  return (
    <span className="knock-image" ref={frameRef}>
      {shouldLoad ? (
        <img
          className={loaded ? 'is-loaded' : ''}
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </span>
  );
}

export function KnockPanel({ snapshot, nickname, token, connectionStatus, onSendEvent }) {
  const [draft, setDraft] = useState('');
  const [targetPlaceId, setTargetPlaceId] = useState(snapshot.place.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [rippleId, setRippleId] = useState(null);
  const [viewerId, setViewerId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const nearBottom = useRef(true);
  const previousKnockCount = useRef(snapshot.knocks.length);
  const feedEnd = useRef(null);
  const pendingPhotosRef = useRef(pendingPhotos);

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);

  useEffect(() => () => {
    for (const pending of pendingPhotosRef.current) URL.revokeObjectURL(pending.objectUrl);
  }, []);

  useEffect(() => {
    setTargetPlaceId(snapshot.place.id);
    setPickerOpen(false);
    setNewCount(0);
    previousKnockCount.current = snapshot.knocks.length;
  }, [snapshot.place.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function updateLandingEdge() {
      const documentHeight = document.documentElement.scrollHeight;
      const distance = documentHeight - (window.scrollY + window.innerHeight);
      nearBottom.current = distance < 150;
      if (nearBottom.current) setNewCount(0);
    }
    updateLandingEdge();
    window.addEventListener('scroll', updateLandingEdge, { passive: true });
    window.addEventListener('resize', updateLandingEdge);
    return () => {
      window.removeEventListener('scroll', updateLandingEdge);
      window.removeEventListener('resize', updateLandingEdge);
    };
  }, []);

  useEffect(() => {
    const delta = snapshot.knocks.length - previousKnockCount.current;
    previousKnockCount.current = snapshot.knocks.length;
    if (delta <= 0) return;
    if (nearBottom.current) {
      const latest = snapshot.knocks.at(-1);
      setRippleId(latest?.id ?? null);
      window.setTimeout(() => setRippleId(null), 700);
      window.requestAnimationFrame(() => {
        feedEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    } else {
      setNewCount((count) => count + delta);
    }
  }, [snapshot.knocks]);

  useEffect(() => {
    const completedMediaIds = new Set(
      snapshot.knocks.map((knock) => knock.mediaId).filter(Boolean),
    );
    if (completedMediaIds.size === 0) return;
    setPendingPhotos((current) => current.filter((pending) => {
      if (!pending.mediaId || !completedMediaIds.has(pending.mediaId)) return true;
      URL.revokeObjectURL(pending.objectUrl);
      return false;
    }));
  }, [snapshot.knocks]);

  const knocks = useMemo(() => {
    const optimistic = pendingPhotos.map((pending) => ({
      id: pending.localId,
      placeId: pending.targetPlaceId,
      placeName: pending.placeName,
      type: 'image',
      content: null,
      mediaId: pending.mediaId ?? null,
      createdAt: pending.createdAt,
      nickname,
      originalUrl: pending.objectUrl,
      optimistic: true,
      uploadState: pending.state,
      error: pending.error,
    }));
    return layoutKnocks([...snapshot.knocks, ...optimistic].filter((knock) => (
      now - Date.parse(knock.createdAt) < DAY_MS
    )));
  }, [nickname, now, pendingPhotos, snapshot.knocks]);
  const mediaKnocks = useMemo(() => knocks.filter((knock) => knock.type === 'image'), [knocks]);
  const selectedLayer = snapshot.layerStack.find((layer) => layer.id === targetPlaceId)
    ?? snapshot.layerStack[0];
  const connected = connectionStatus === 'connected';

  function submitKnock(event) {
    event.preventDefault();
    if (!connected || !draft.trim()) return;
    const sent = onSendEvent('knock_send', {
      targetPlaceId,
      type: 'text',
      content: draft,
    });
    if (sent) setDraft('');
  }

  function revealNewKnocks() {
    setNewCount(0);
    feedEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function updatePending(localId, patch) {
    setPendingPhotos((current) => current.map((pending) => (
      pending.localId === localId ? { ...pending, ...patch } : pending
    )));
  }

  async function processPhoto(localId, file, target, compressedBlob = null) {
    try {
      updatePending(localId, { state: 'compressing', error: null });
      const blob = compressedBlob ?? await compressImage(file);
      updatePending(localId, { state: 'uploading', compressedBlob: blob });
      const { mediaId } = await uploadImage(blob, token);
      updatePending(localId, { state: 'developing', mediaId });
      const sent = onSendEvent('knock_send', {
        targetPlaceId: target.id,
        type: 'image',
        mediaId,
      });
      if (!sent) throw new Error('The place is reconnecting.');
    } catch (error) {
      updatePending(localId, {
        state: 'failed',
        error: error.message || 'The photo could not be placed here.',
      });
    }
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const localId = `local-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
    const objectUrl = URL.createObjectURL(file);
    const pending = {
      localId,
      objectUrl,
      file,
      compressedBlob: null,
      mediaId: null,
      targetPlaceId: selectedLayer.id,
      placeName: selectedLayer.name,
      createdAt: new Date().toISOString(),
      state: 'compressing',
      error: null,
    };
    setPendingPhotos((current) => [...current, pending]);
    processPhoto(localId, file, selectedLayer);
  }

  function retryPhoto(knock) {
    const pending = pendingPhotos.find((item) => item.localId === knock.id);
    if (!pending || !connected) return;
    if (pending.mediaId) {
      updatePending(pending.localId, { state: 'developing', error: null });
      const sent = onSendEvent('knock_send', {
        targetPlaceId: pending.targetPlaceId,
        type: 'image',
        mediaId: pending.mediaId,
      });
      if (!sent) updatePending(pending.localId, { state: 'failed' });
      return;
    }
    processPhoto(
      pending.localId,
      pending.file,
      { id: pending.targetPlaceId, name: pending.placeName },
      pending.compressedBlob,
    );
  }

  return (
    <div className="shell-panel knock-panel">
      <div className="panel-intro">
        <p className="eyebrow">Knock</p>
        <h2>Notes left at this place.</h2>
      </div>

      <div className="knock-feed" aria-live="polite">
        {knocks.length === 0 ? (
          <p className="margin-note-empty">No one has knocked here in the last 24 hours. Be the first.</p>
        ) : knocks.map((knock) => {
          const opacity = ageOpacity(knock.createdAt, now);
          if (knock.type === 'image') {
            const imageUrl = knock.thumbUrl ?? knock.mediumUrl ?? knock.originalUrl;
            return (
              <article
                className={`photo-knock photo-knock--${knock.offset}${rippleId === knock.id ? ' knock-arrival' : ''}`}
                key={knock.id}
                style={{ opacity }}
              >
                <div className={`photo-knock__media${knock.optimistic ? ' photo-knock__media--processing' : ''}`}>
                  <button
                    className="photo-knock__ellipse"
                    type="button"
                    style={{
                      '--tilt': `${knock.tilt}deg`,
                      '--ar': knock.aspectRatio,
                      backgroundColor: knock.dominantColor || '#E5E3DB',
                    }}
                    aria-label={`Open photo by ${knock.nickname}`}
                    onClick={() => setViewerId(knock.id)}
                  >
                    <KnockImage
                      src={imageUrl}
                      alt={knock.content || `Photo left by ${knock.nickname}`}
                      eager={knock.optimistic}
                    />
                  </button>
                  {knock.uploadState === 'failed' ? (
                    <button
                      className="photo-knock__retry"
                      type="button"
                      aria-label="Retry photo upload"
                      disabled={!connected}
                      onClick={() => retryPhoto(knock)}
                    >
                      <RefreshCw aria-hidden="true" size={18} />
                    </button>
                  ) : null}
                </div>
                {knock.content ? <p className="photo-knock__caption">{knock.content}</p> : null}
                <p className="knock-meta">
                  {knock.nickname} · {relativeTime(knock.createdAt, now)}
                  {knock.optimistic ? ` · ${knock.uploadState === 'failed' ? 'upload paused' : 'developing…'}` : ''}
                </p>
                {knock.error ? <p className="photo-knock__error">{knock.error}</p> : null}
              </article>
            );
          }
          return (
            <article
              className={`text-knock${rippleId === knock.id ? ' knock-arrival' : ''}`}
              key={knock.id}
              style={{ opacity }}
            >
              <p>{knock.content}</p>
              <p className="knock-meta">{knock.nickname} · {relativeTime(knock.createdAt, now)}</p>
            </article>
          );
        })}
        <div ref={feedEnd} />
      </div>

      {newCount > 0 ? (
        <button className="new-knocks-pill" type="button" onClick={revealNewKnocks}>
          <span className="live-dot live-dot--small" aria-hidden="true" />
          {newCount} new {newCount === 1 ? 'knock' : 'knocks'} ↓
        </button>
      ) : null}

      <div className="knock-composer">
        <div className="layer-picker">
          <button
            className="layer-picker__chip"
            type="button"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            To {selectedLayer.name} · {selectedLayer.presenceCount}
            <ChevronDown aria-hidden="true" size={15} />
          </button>
          {pickerOpen ? (
            <div className="layer-picker__menu" role="menu" aria-label="Choose the knock audience">
              {snapshot.layerStack.map((layer, index) => (
                <button
                  key={layer.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={layer.id === targetPlaceId}
                  style={{ '--layer-depth': index }}
                  onClick={() => {
                    setTargetPlaceId(layer.id);
                    setPickerOpen(false);
                  }}
                >
                  <span>{layer.name}</span>
                  <span><span className="live-dot live-dot--small" aria-hidden="true" />{layer.presenceCount}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <form className="knock-composer__form" onSubmit={submitKnock}>
          <label htmlFor="knock-content">Leave a note here</label>
          <textarea
            id="knock-content"
            rows="1"
            value={draft}
            disabled={!connected}
            placeholder={connected ? 'Knock on this place…' : 'The place is reconnecting…'}
            onChange={(event) => setDraft(event.target.value)}
          />
          <label className="photo-picker" aria-label="Add a photo knock">
            <ImagePlus aria-hidden="true" size={19} />
            <input
              type="file"
              accept="image/*"
              disabled={!connected}
              onChange={choosePhoto}
            />
          </label>
          <button type="submit" aria-label="Send knock" disabled={!connected || !draft.trim()}>
            <Send aria-hidden="true" size={19} />
          </button>
        </form>
      </div>

      {viewerId ? (
        <MediaViewer
          items={mediaKnocks}
          initialId={viewerId}
          place={snapshot.place}
          onClose={() => setViewerId(null)}
        />
      ) : null}
    </div>
  );
}
