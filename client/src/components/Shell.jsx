import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, Footprints, Hand } from 'lucide-react';
import { fetchConfirmedMomentIds } from '../lib/api.js';
import { ExploreScreen } from './ExploreScreen.jsx';
import { KnockScreen } from './KnockScreen.jsx';
import { ProfileScreen } from './ProfileScreen.jsx';

const TABS = [
  { id: 'knock', label: 'Knock', icon: Hand },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'profile', label: 'Profile', icon: Footprints },
];

/* Direction-aware, finger-following tab pager. Horizontal drags are axis-
   locked after ~8px so they never fight vertical scroll; releases snap with
   momentum. All movement is transform-only. */
function TabPager({ index, onIndexChange, locked, children }) {
  const trackRef = useRef(null);
  const pagerRef = useRef(null);
  const drag = useRef(null);
  const indexRef = useRef(index);
  indexRef.current = index;

  // A focused element inside an overflow:hidden container can still scroll
  // it (focus-scroll), desyncing the visual position from the transform.
  // Pin scrollLeft to zero — the transform is the only source of truth.
  function guardScroll() {
    const pager = pagerRef.current;
    if (pager && pager.scrollLeft !== 0) pager.scrollLeft = 0;
  }

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = 'transform var(--dur-slide) var(--ease-out)';
    track.style.transform = `translate3d(${-index * 100}%, 0, 0)`;
  }, [index]);

  function settle(next) {
    const track = trackRef.current;
    track.style.transition = 'transform var(--dur-slide) var(--ease-out)';
    track.style.transform = `translate3d(${-next * 100}%, 0, 0)`;
    if (next !== indexRef.current) onIndexChange(next);
  }

  function onPointerDown(event) {
    if (locked) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      lastX: event.clientX,
      lastT: performance.now(),
      velocity: 0,
    };
  }

  function onPointerMove(event) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    if (!state.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      state.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (state.axis === 'x') {
        trackRef.current.setPointerCapture(event.pointerId);
        trackRef.current.style.transition = 'none';
      }
    }
    if (state.axis !== 'x') return;

    const now = performance.now();
    state.velocity = 0.75 * state.velocity
      + 0.25 * ((event.clientX - state.lastX) / Math.max(1, now - state.lastT));
    state.lastX = event.clientX;
    state.lastT = now;

    const at = indexRef.current;
    const resist = (at === 0 && dx > 0) || (at === TABS.length - 1 && dx < 0) ? 0.32 : 1;
    trackRef.current.style.transform = `translate3d(calc(${-at * 100}% + ${dx * resist}px), 0, 0)`;
  }

  function onPointerEnd(event) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    if (state.axis !== 'x') return;
    const dx = event.clientX - state.startX;
    const width = trackRef.current.clientWidth || 1;
    let next = indexRef.current;
    // Distance OR a real flick — but never a micro-jitter that merely
    // registered a high instantaneous velocity (sloppy taps must not swipe).
    if (Math.abs(dx) > width * 0.3 || (Math.abs(dx) > 28 && Math.abs(state.velocity) > 0.45)) {
      next += dx < 0 ? 1 : -1;
    }
    settle(Math.max(0, Math.min(TABS.length - 1, next)));
  }

  function onPointerCancel(event) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    if (state.axis === 'x') settle(indexRef.current);
  }

  return (
    <div className="pager" ref={pagerRef} onScroll={guardScroll}>
      <div
        className="pager__track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerCancel}
      >
        {children.map((child, childIndex) => (
          <section
            key={TABS[childIndex].id}
            className="pager__panel"
            data-active={childIndex === index}
            aria-hidden={childIndex !== index}
          >
            {child}
          </section>
        ))}
      </div>
    </div>
  );
}

export function Shell({
  snapshot,
  nickname,
  connectionStatus,
  preMorph,
  sendEvent,
  subscribeFrames,
  onLogout,
}) {
  const [tabIndex, setTabIndex] = useState(1); // Explore is the landing page
  const [dots, setDots] = useState({ knock: false, explore: false, profile: false });
  const [confirmedIds, setConfirmedIds] = useState(() => new Set());
  const [profileVersion, setProfileVersion] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const activeTab = TABS[tabIndex].id;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const place = snapshot.place;
  const parentLayer = snapshot.layerStack[1] ?? null;

  useEffect(() => {
    let cancelled = false;
    fetchConfirmedMomentIds()
      .then((ids) => { if (!cancelled) setConfirmedIds(new Set(ids)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [place.id]);

  // Cross-page notification dots (SPEC §2): dot only, meaning-colored,
  // cleared on tab entry.
  useEffect(() => subscribeFrames((frame) => {
    const map = { knock_new: 'knock', moment_new: 'explore', memory_engraved: 'explore' };
    const targetTab = map[frame.type];
    if (targetTab && targetTab !== activeTabRef.current) {
      setDots((current) => ({ ...current, [targetTab]: true }));
    }
    if (frame.type === 'memory_engraved') {
      const mine = frame.payload?.participants?.some((entry) => entry.nickname === nickname);
      if (mine) {
        setProfileVersion((value) => value + 1);
        if (activeTabRef.current !== 'profile') {
          setDots((current) => ({ ...current, profile: true }));
        }
      }
    }
  }), [subscribeFrames, nickname]);

  const changeTab = useCallback((nextIndex) => {
    setTabIndex(nextIndex);
    setDots((current) => ({ ...current, [TABS[nextIndex].id]: false }));
  }, []);

  const confirmMoment = useCallback((momentId) => {
    // Only flip optimistically if the frame actually left the socket;
    // otherwise the button stays tappable and the user tries again.
    if (!sendEvent('moment_presence_confirm', { digId: momentId })) return;
    setConfirmedIds((current) => {
      if (current.has(momentId)) return current;
      const next = new Set(current);
      next.add(momentId);
      return next;
    });
  }, [sendEvent]);

  return (
    <div className={`shell${preMorph ? ' shell--pre' : ''}`}>
      <header className="hdr">
        {connectionStatus !== 'connected' ? (
          <div className="hdr__reconnect" role="status">
            <span className="hdr__offline-dot" aria-hidden="true" />
            Reconnecting…
          </div>
        ) : null}
        <div className="hdr__row">
          <div className="hdr__heading">
            <h1 className="hdr__title" data-morph-title>{place.name}</h1>
            {parentLayer ? (
              <p className="hdr__parent">inside {parentLayer.name}</p>
            ) : null}
          </div>
          <div
            className="hdr__presence"
            aria-label={`${snapshot.presenceCount} people here now`}
          >
            <span
              className={`live-dot${connectionStatus === 'connected' ? ' live-dot--pulse' : ' live-dot--off'}`}
              aria-hidden="true"
            />
            <strong>{snapshot.presenceCount}</strong>
            <span className="hdr__presence-label">here</span>
          </div>
        </div>
      </header>

      <TabPager index={tabIndex} onIndexChange={changeTab} locked={viewerOpen}>
        {[
          <KnockScreen
            key="knock"
            snapshot={snapshot}
            nickname={nickname}
            active={activeTab === 'knock'}
            connected={connectionStatus === 'connected'}
            sendEvent={sendEvent}
            onViewerToggle={setViewerOpen}
          />,
          <ExploreScreen
            key="explore"
            snapshot={snapshot}
            nickname={nickname}
            active={activeTab === 'explore'}
            connected={connectionStatus === 'connected'}
            confirmedIds={confirmedIds}
            onConfirmMoment={confirmMoment}
            onViewerToggle={setViewerOpen}
          />,
          <ProfileScreen
            key="profile"
            nickname={nickname}
            active={activeTab === 'profile'}
            profileVersion={profileVersion}
            place={place}
            onViewerToggle={setViewerOpen}
            onLogout={onLogout}
          />,
        ]}
      </TabPager>

      {/* Three ink seals resting on the paper — no bar, no app chrome. */}
      <nav className="seals" aria-label="Main navigation">
        {TABS.map(({ id, label, icon: Icon }, navIndex) => {
          const active = navIndex === tabIndex;
          return (
            <button
              key={id}
              type="button"
              className={`seal seal--${id}`}
              data-active={active}
              aria-current={active ? 'page' : undefined}
              aria-label={`${label}${dots[id] ? ', new activity' : ''}`}
              onClick={() => changeTab(navIndex)}
            >
              <span className="seal__disc">
                <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                {dots[id] ? <span className="seal__dot" aria-hidden="true" /> : null}
              </span>
              <span className="seal__label">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
