import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ImagePlus, PenLine, RefreshCw, Send } from 'lucide-react';
import { DAY_MS } from '../config.js';
import { compressToWebp } from '../lib/compress.js';
import { uploadMedia } from '../lib/api.js';
import { layoutPrints } from '../lib/pebble.js';
import { relativeTime, remainingFraction } from '../lib/time.js';
import { InkViewer } from './InkViewer.jsx';

function LazyPrint({ src, alt, dominantColor, eager = false }) {
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(eager);
  const frameRef = useRef(null);

  useEffect(() => {
    if (eager || typeof IntersectionObserver !== 'function') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '280px 0px' });
    if (frameRef.current) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [eager, src]);

  return (
    <span
      ref={frameRef}
      className="print__img"
      style={{ backgroundColor: dominantColor || 'var(--hairline)' }}
    >
      {visible && src ? (
        <img
          className={loaded ? 'is-loaded' : ''}
          src={src}
          alt={alt}
          loading="lazy"
          draggable="false"
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </span>
  );
}

export function KnockScreen({
  snapshot, nickname, active, connected, sendEvent, onViewerToggle,
}) {
  const [draft, setDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [targetPlaceId, setTargetPlaceId] = useState(snapshot.place.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [arrivalId, setArrivalId] = useState(null);
  const [pending, setPending] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [now, setNow] = useState(Date.now());

  const scrollerRef = useRef(null);
  const nearBottom = useRef(true);
  const prevCount = useRef(snapshot.knocks.length);
  const pendingRef = useRef(pending);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => {
    for (const item of pendingRef.current) URL.revokeObjectURL(item.objectUrl);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setTargetPlaceId(snapshot.place.id);
    setPickerOpen(false);
    setNewCount(0);
    prevCount.current = snapshot.knocks.length;
  }, [snapshot.place.id]);

  // The screen must open already anchored to the newest knock — scroll is
  // set before paint, so there is never a visible jump.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    nearBottom.current = true;
  }, [snapshot.place.id]);

  // The composer sheet changes the feed's height — keep the newest knock
  // pinned when it unfolds.
  useLayoutEffect(() => {
    if (!composerOpen) return;
    const scroller = scrollerRef.current;
    if (scroller && nearBottom.current) scroller.scrollTop = scroller.scrollHeight;
  }, [composerOpen]);

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    nearBottom.current = distance < 140;
    if (nearBottom.current) setNewCount(0);
  }

  // While at the bottom, new knocks slide in and the feed stays pinned;
  // while reading history, the floating pill counts instead of yanking.
  useLayoutEffect(() => {
    const delta = snapshot.knocks.length - prevCount.current;
    prevCount.current = snapshot.knocks.length;
    if (delta <= 0) return;
    if (nearBottom.current) {
      const scroller = scrollerRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      const latest = snapshot.knocks.at(-1);
      setArrivalId(latest?.id ?? null);
      window.setTimeout(() => setArrivalId(null), 700);
    } else {
      setNewCount((count) => count + delta);
    }
  }, [snapshot.knocks]);

  // Reconcile optimistic photos once the server copy lands (match by mediaId).
  useEffect(() => {
    const arrived = new Set(snapshot.knocks.map((knock) => knock.mediaId).filter(Boolean));
    if (arrived.size === 0) return;
    setPending((current) => current.filter((item) => {
      if (!item.mediaId || !arrived.has(item.mediaId)) return true;
      URL.revokeObjectURL(item.objectUrl);
      return false;
    }));
  }, [snapshot.knocks]);

  const knocks = useMemo(() => {
    const optimistic = pending.map((item) => ({
      id: item.localId,
      placeId: item.targetPlaceId,
      type: 'image',
      content: null,
      mediaId: item.mediaId ?? null,
      createdAt: item.createdAt,
      nickname,
      originalUrl: item.objectUrl,
      optimistic: true,
      uploadState: item.state,
      error: item.error,
    }));
    return layoutPrints(
      [...snapshot.knocks, ...optimistic]
        .filter((knock) => now - Date.parse(knock.createdAt) < DAY_MS),
    );
  }, [snapshot.knocks, pending, nickname, now]);

  const photoKnocks = useMemo(
    () => knocks.filter((knock) => knock.type === 'image'),
    [knocks],
  );

  const selectedLayer = snapshot.layerStack.find((layer) => layer.id === targetPlaceId)
    ?? snapshot.layerStack[0];

  function submitText(event) {
    event.preventDefault();
    if (!connected || !draft.trim()) return;
    const sent = sendEvent('knock_send', { targetPlaceId, type: 'text', content: draft });
    if (sent) setDraft('');
  }

  function updatePending(localId, patchValues) {
    setPending((current) => current.map((item) => (
      item.localId === localId ? { ...item, ...patchValues } : item
    )));
  }

  async function processPhoto(localId, file, target, priorBlob = null) {
    try {
      updatePending(localId, { state: 'compressing', error: null });
      const blob = priorBlob ?? await compressToWebp(file);
      updatePending(localId, { state: 'uploading', blob });
      const mediaId = await uploadMedia(blob);
      updatePending(localId, { state: 'developing', mediaId });
      const sent = sendEvent('knock_send', { targetPlaceId: target, type: 'image', mediaId });
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
    setPending((current) => [...current, {
      localId,
      objectUrl: URL.createObjectURL(file),
      file,
      blob: null,
      mediaId: null,
      targetPlaceId: selectedLayer.id,
      createdAt: new Date().toISOString(),
      state: 'compressing',
      error: null,
    }]);
    nearBottom.current = true;
    window.requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    processPhoto(localId, file, selectedLayer.id);
  }

  function retryPhoto(knock) {
    const item = pending.find((entry) => entry.localId === knock.id);
    if (!item || !connected) return;
    if (item.mediaId) {
      updatePending(item.localId, { state: 'developing', error: null });
      const sent = sendEvent('knock_send', {
        targetPlaceId: item.targetPlaceId,
        type: 'image',
        mediaId: item.mediaId,
      });
      if (!sent) updatePending(item.localId, { state: 'failed' });
      return;
    }
    processPhoto(item.localId, item.file, item.targetPlaceId, item.blob);
  }

  function revealNew() {
    setNewCount(0);
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }

  function openViewer(knock, event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setViewer({ id: knock.id, origin: { rect, tilt: knock.tilt ?? 0, radius: '3px' } });
    onViewerToggle(true);
  }

  function closeViewer() {
    setViewer(null);
    onViewerToggle(false);
  }

  const viewerItems = photoKnocks.map((knock) => ({
    id: knock.id,
    kind: 'live',
    caption: knock.content,
    nickname: knock.nickname,
    createdAt: knock.createdAt,
    mediumUrl: knock.mediumUrl ?? knock.originalUrl,
    thumbUrl: knock.thumbUrl,
    dominantColor: knock.dominantColor,
    tilt: knock.tilt ?? 0,
  }));

  return (
    <div className="knock">
      <div className="knock__scroller" ref={scrollerRef} onScroll={handleScroll}>
        <div className="knock__intro">
          <p className="section-rule section-rule--plain">NOTES LEFT AT THIS PLACE</p>
        </div>

        <div className="ledger">
          {knocks.length === 0 ? (
            <div className="lg-entry lg-entry--empty">
              <p className="lg-text">No one has knocked here in the last 24 hours. Be the first.</p>
            </div>
          ) : knocks.map((knock) => {
            // Ink dries as the note ages — text fades, the paper stays.
            const fresh = remainingFraction(knock.createdAt, now);
            const arriving = arrivalId === knock.id;

            if (knock.type === 'image') {
              const src = knock.mediumUrl ?? knock.originalUrl ?? knock.thumbUrl;
              return (
                <article
                  key={knock.id}
                  className={`print print--${knock.side}${arriving ? ' is-arriving' : ''}`}
                  style={{
                    '--tilt': `${knock.tilt}deg`,
                    '--print-w': `${knock.width}%`,
                    '--fresh': fresh,
                  }}
                >
                  <button
                    type="button"
                    className={`print__frame${knock.optimistic ? ' print__frame--busy' : ''}`}
                    aria-label={`Open photo by ${knock.nickname}`}
                    onClick={(event) => !knock.optimistic && openViewer(knock, event)}
                  >
                    <LazyPrint
                      src={src}
                      alt={knock.content || `Photo left by ${knock.nickname}`}
                      dominantColor={knock.dominantColor}
                      eager={Boolean(knock.optimistic)}
                    />
                    {knock.content ? (
                      <span className="print__caption">{knock.content}</span>
                    ) : null}
                  </button>
                  {knock.uploadState === 'failed' ? (
                    <button
                      type="button"
                      className="print__retry"
                      aria-label="Retry photo upload"
                      disabled={!connected}
                      onClick={() => retryPhoto(knock)}
                    >
                      <RefreshCw size={17} aria-hidden="true" />
                    </button>
                  ) : null}
                  <p className="lg-meta">
                    <span className="lg-meta__nick">{knock.nickname}</span>
                    <span className="lg-meta__time">
                      {relativeTime(knock.createdAt, now)}
                      {knock.optimistic
                        ? ` · ${knock.uploadState === 'failed' ? 'upload paused' : 'developing…'}`
                        : ''}
                    </span>
                  </p>
                  {knock.error ? <p className="print__error">{knock.error}</p> : null}
                </article>
              );
            }

            return (
              <article
                key={knock.id}
                className={`lg-entry${arriving ? ' is-arriving' : ''}`}
                style={{ '--fresh': fresh }}
              >
                <p className="lg-text">{knock.content}</p>
                <p className="lg-meta">
                  <span className="lg-meta__nick">{knock.nickname}</span>
                  <span className="lg-meta__time">{relativeTime(knock.createdAt, now)}</span>
                </p>
              </article>
            );
          })}
        </div>
        <div className="knock__tail" />
      </div>

      {newCount > 0 ? (
        <button type="button" className="pill" onClick={revealNew}>
          <span className="live-dot" aria-hidden="true" />
          {newCount} new {newCount === 1 ? 'knock' : 'knocks'} ↓
        </button>
      ) : null}

      <div className={`composer${composerOpen ? ' composer--open' : ''}`}>
        {!composerOpen ? (
          <button
            type="button"
            className="composer__rest"
            onClick={() => setComposerOpen(true)}
          >
            <span className="composer__rest-line">
              {connected ? 'Leave a note here…' : 'The place is reconnecting…'}
            </span>
            <span className="composer__rest-pen" aria-hidden="true">
              <PenLine size={16} strokeWidth={1.9} />
            </span>
          </button>
        ) : (
          <div className="composer__sheet">
            <div className="composer__sheet-top">
              <div className="composer__audience">
                <button
                  type="button"
                  className="chip"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((open) => !open)}
                >
                  To {selectedLayer.name} · {selectedLayer.presenceCount}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {pickerOpen ? (
                  <div className="chip-menu" role="menu" aria-label="Choose your audience">
                    {snapshot.layerStack.map((layer, depth) => (
                      <button
                        key={layer.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={layer.id === targetPlaceId}
                        className="chip-menu__item"
                        style={{ '--depth': snapshot.layerStack.length - 1 - depth }}
                        onClick={() => {
                          setTargetPlaceId(layer.id);
                          setPickerOpen(false);
                        }}
                      >
                        <span>{layer.name}</span>
                        <span className="chip-menu__count">
                          <span className="live-dot" aria-hidden="true" />
                          {layer.presenceCount}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="composer__fold"
                aria-label="Fold the writing sheet"
                onClick={() => {
                  setComposerOpen(false);
                  setPickerOpen(false);
                }}
              >
                <ChevronDown size={17} aria-hidden="true" />
              </button>
            </div>
            <form className="composer__row" onSubmit={submitText}>
              <textarea
                rows="2"
                value={draft}
                disabled={!connected}
                placeholder={connected ? 'Knock on this place…' : 'The place is reconnecting…'}
                aria-label="Knock on this place"
                enterKeyHint="send"
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="composer__actions">
                <label className="composer__photo" aria-label="Add a photo knock">
                  <ImagePlus size={19} aria-hidden="true" />
                  <input type="file" accept="image/*" disabled={!connected} onChange={choosePhoto} />
                </label>
                <button
                  type="submit"
                  className="composer__send"
                  aria-label="Send knock"
                  disabled={!connected || !draft.trim()}
                >
                  <Send size={18} aria-hidden="true" />
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {viewer ? (
        <InkViewer
          items={viewerItems}
          initialId={viewer.id}
          origin={viewer.origin}
          placeName={snapshot.place.name}
          onClose={closeViewer}
        />
      ) : null}
    </div>
  );
}
