import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchConfirmedMomentIds } from '../lib/api.js';
import { ExploreScreen } from './ExploreScreen.jsx';
import { KnockScreen } from './KnockScreen.jsx';
import { ProfileScreen } from './ProfileScreen.jsx';
import { Logo } from './Logo.jsx';

/* Explore is the home canvas. Knock rises over it as a paper sheet with the
   place blurred behind; Profile slides in from the identity chip. No nav. */
export function Shell({
  snapshot,
  nickname,
  connectionStatus,
  preMorph,
  sendEvent,
  subscribeFrames,
  onLogout,
}) {
  const [knockOpen, setKnockOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [knockBadge, setKnockBadge] = useState(0);
  const [toast, setToast] = useState(null); // {nickname, text}
  const [chipDot, setChipDot] = useState(false);
  const [confirmedIds, setConfirmedIds] = useState(() => new Set());
  const [profileVersion, setProfileVersion] = useState(0);
  const knockOpenRef = useRef(knockOpen);
  knockOpenRef.current = knockOpen;
  const profileOpenRef = useRef(profileOpen);
  profileOpenRef.current = profileOpen;
  const toastTimer = useRef(null);
  const sheetRef = useRef(null);
  const sheetDrag = useRef(null);

  const place = snapshot.place;

  useEffect(() => {
    let cancelled = false;
    fetchConfirmedMomentIds()
      .then((ids) => { if (!cancelled) setConfirmedIds(new Set(ids)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [place.id]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Live events → gentle surfacing: a knock peek + badge while the sheet is
  // closed; a dot on the identity chip when a memory includes you.
  useEffect(() => subscribeFrames((frame) => {
    if (frame.type === 'knock_new' && frame.payload?.knock) {
      if (knockOpenRef.current) return;
      const knock = frame.payload.knock;
      if (knock.nickname === nickname) return; // your own echo isn't news
      setKnockBadge((count) => count + 1);
      setToast({
        nickname: knock.nickname,
        text: knock.type === 'image'
          ? (knock.content ? `📷 ${knock.content}` : 'left a photo here')
          : knock.content,
      });
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 4_200);
    }
    if (frame.type === 'memory_engraved') {
      const mine = frame.payload?.participants?.some((entry) => entry.nickname === nickname);
      if (mine) {
        setProfileVersion((value) => value + 1);
        if (!profileOpenRef.current) setChipDot(true);
      }
    }
  }), [subscribeFrames, nickname]);

  const confirmMoment = useCallback((momentId) => {
    if (!sendEvent('moment_presence_confirm', { digId: momentId })) return;
    setConfirmedIds((current) => {
      if (current.has(momentId)) return current;
      const next = new Set(current);
      next.add(momentId);
      return next;
    });
  }, [sendEvent]);

  function openKnock() {
    setKnockOpen(true);
    setKnockBadge(0);
    setToast(null);
  }

  function closeKnock() {
    setKnockOpen(false);
  }

  function openProfile() {
    setProfileOpen(true);
    setChipDot(false);
  }

  // Pull the sheet down by its handle to dismiss it.
  function sheetPointerDown(event) {
    sheetDrag.current = { id: event.pointerId, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function sheetPointerMove(event) {
    const drag = sheetDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dy = Math.max(0, event.clientY - drag.startY);
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }

  function sheetPointerEnd(event) {
    const drag = sheetDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    sheetDrag.current = null;
    const dy = event.clientY - drag.startY;
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
    if (dy > 110) {
      sheet.style.transform = 'translateY(105%)';
      window.setTimeout(closeKnock, 290);
    } else {
      sheet.style.transform = 'translateY(0)';
    }
  }

  return (
    <div className={`shell${preMorph ? ' shell--pre' : ''}`}>
      {connectionStatus !== 'connected' ? (
        <div className="reconnect" role="status">
          <span className="reconnect__dot" aria-hidden="true" />
          Reconnecting…
        </div>
      ) : null}

      <div className={`shell__home${knockOpen ? ' shell__home--dimmed' : ''}`}>
        <ExploreScreen
          snapshot={snapshot}
          nickname={nickname}
          connected={connectionStatus === 'connected'}
          confirmedIds={confirmedIds}
          onConfirmMoment={confirmMoment}
          knockBadge={knockBadge}
          chipDot={chipDot}
          suspended={knockOpen || profileOpen}
          onOpenKnock={openKnock}
          onOpenProfile={openProfile}
        />
      </div>

      {/* the knock peek: who + the first words, tap to open */}
      {toast && !knockOpen ? (
        <button type="button" className="knock-toast" onClick={openKnock}>
          <span className="knock-toast__who">{toast.nickname} · just now</span>
          <span className="knock-toast__txt">{toast.text}</span>
        </button>
      ) : null}

      {knockOpen ? (
        <div className="ksheet-layer">
          <button
            type="button"
            className="ksheet-scrim"
            aria-label="Close knocks"
            onClick={closeKnock}
          />
          <div className="ksheet" ref={sheetRef} role="dialog" aria-label="Notes left at this place">
            <div
              className="ksheet__handle"
              onPointerDown={sheetPointerDown}
              onPointerMove={sheetPointerMove}
              onPointerUp={sheetPointerEnd}
              onPointerCancel={sheetPointerEnd}
            >
              <span className="ksheet__grab" aria-hidden="true" />
              <div className="ksheet__hd">
                <Logo size={16} />
                <span className="ksheet__title">NOTES LEFT AT THIS PLACE</span>
                <span className="ksheet__pres">
                  <span className="live-dot live-dot--pulse" aria-hidden="true" />
                  {snapshot.presenceCount}
                </span>
              </div>
            </div>
            <KnockScreen
              snapshot={snapshot}
              nickname={nickname}
              connected={connectionStatus === 'connected'}
              sendEvent={sendEvent}
            />
          </div>
        </div>
      ) : null}

      {profileOpen ? (
        <ProfileScreen
          nickname={nickname}
          profileVersion={profileVersion}
          placeName={place.name}
          onClose={() => setProfileOpen(false)}
          onLogout={onLogout}
        />
      ) : null}
    </div>
  );
}
