import { useEffect, useRef, useState } from 'react';

const MIN_SHOW_MS = 1_500;
const ENGRAVE_MS = 950;
const MORPH_MS = 500;

/**
 * The loading-to-header signature moment (SPEC §7.1 + rebuild brief):
 * an ink circle converges onto the place polygon, the polygon is engraved
 * with a clay stroke, the place name appears — then the whole sheet
 * collapses UPWARD while the name FLIPs into its final header position.
 * The header underneath never changes again after this.
 */
export function EntryMorph({ placeName, ready, onDone }) {
  const [stage, setStage] = useState('search');
  const [engraved, setEngraved] = useState(false);
  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const titleRef = useRef(null);
  const markRef = useRef(null);
  const mountedAt = useRef(Date.now());
  const morphStarted = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    if (stage === 'search' && placeName) setStage('engrave');
  }, [placeName, stage]);

  useEffect(() => {
    if (stage !== 'engrave') return undefined;
    const timer = window.setTimeout(() => setEngraved(true), ENGRAVE_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (!ready || !engraved || morphStarted.current) return undefined;
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - mountedAt.current));
    const timer = window.setTimeout(startMorph, wait);
    return () => window.clearTimeout(timer);
  });

  function startMorph() {
    if (morphStarted.current) return;
    morphStarted.current = true;
    setStage('morph');

    const source = titleRef.current;
    const target = document.querySelector('[data-morph-title]');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!source || !target || reduced) {
      rootRef.current?.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 220, easing: 'ease-out', fill: 'forwards' },
      );
      window.setTimeout(() => onDoneRef.current(), 240);
      return;
    }

    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const scale = to.height / from.height;
    const easing = 'cubic-bezier(0.32, 0.72, 0, 1)';

    source.style.transformOrigin = 'top left';
    source.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { opacity: 1, offset: 0.55 },
        {
          transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`,
          opacity: 0,
        },
      ],
      { duration: MORPH_MS, easing, fill: 'forwards' },
    );
    sheetRef.current?.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-101%)' }],
      { duration: MORPH_MS, easing, fill: 'forwards' },
    );
    markRef.current?.animate(
      [
        { transform: 'translateY(0) scale(1)', opacity: 1 },
        { transform: 'translateY(-48px) scale(0.72)', opacity: 0 },
      ],
      { duration: MORPH_MS * 0.64, easing: 'ease-in', fill: 'forwards' },
    );
    window.setTimeout(() => onDoneRef.current(), MORPH_MS + 30);
  }

  return (
    <div className={`entry entry--${stage}`} ref={rootRef} aria-hidden={stage === 'morph'}>
      <div className="entry__sheet" ref={sheetRef}>
        <div className="entry__mark" ref={markRef}>
          <svg viewBox="0 0 200 200" width="164" height="164" aria-hidden="true">
            {/* the searching radius */}
            <circle className="entry__ring entry__ring--outer" cx="100" cy="100" r="88" />
            <circle className="entry__ring entry__ring--inner" cx="100" cy="100" r="88" />
            {/* the place polygon, engraved in clay */}
            <path
              className="entry__polygon"
              d="M 62 40 L 146 30 L 172 94 L 126 168 L 42 142 Z"
              pathLength="1"
            />
          </svg>
        </div>
        <p className="entry__status meta" aria-live="polite">
          {stage === 'search' ? 'Finding where you are…' : 'You are in'}
        </p>
      </div>
      {placeName ? (
        <h1 className="entry__title" ref={titleRef}>{placeName}</h1>
      ) : null}
    </div>
  );
}
