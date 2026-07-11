import { useEffect, useMemo, useState } from 'react';
import { Compass, Footprints, Hand, MoveDown, MoveUpRight } from 'lucide-react';
import { KnockPanel } from './KnockPanel.jsx';

const NAV_ITEMS = [
  { id: 'knock', label: 'Knock', icon: Hand },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'profile', label: 'Profile', icon: Footprints },
];

function ExplorePanel() {
  return (
    <div className="shell-panel explore-panel">
      <section className="place-section place-section--live">
        <div className="section-rule section-rule--live">
          <span className="live-dot live-dot--small" aria-hidden="true" />
          <h2>LIVE NOW · fades in 24h</h2>
        </div>
        <p className="empty-copy">Nothing live right now. Be the first to capture this place.</p>
      </section>
      <section className="place-section place-section--engraved">
        <div className="section-rule section-rule--engraved">
          <h2>ENGRAVED</h2>
        </div>
        <p className="empty-copy">This place has no memory yet. Be here when something happens.</p>
      </section>
    </div>
  );
}

function ProfilePanel({ nickname }) {
  return (
    <div className="shell-panel profile-panel">
      <div className="panel-intro">
        <p className="eyebrow">Your trail</p>
        <h2>Your memories</h2>
        <p className="private-line">only you see this page</p>
        <p className="profile-meta">{nickname} · 1 place · 0 moments</p>
      </div>
      <section className="profile-placeholder">
        <h3>PLACES</h3>
        <p>Your first belong stamp is being pressed here.</p>
      </section>
      <section className="profile-placeholder">
        <h3>MEMORIES YOU ARE PART OF</h3>
        <p>Shared moments will settle here after they are engraved.</p>
      </section>
    </div>
  );
}

export function AppShell({
  snapshot,
  nickname,
  token,
  activeTab,
  notificationDots,
  connectionStatus,
  onTabChange,
  onSendEvent,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [viewedLayerIndex, setViewedLayerIndex] = useState(0);

  useEffect(() => {
    setViewedLayerIndex(0);
  }, [snapshot.place.id]);

  useEffect(() => {
    let scheduled = false;
    function onScroll() {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        setCollapsed(window.scrollY > 42);
        scheduled = false;
      });
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const layers = snapshot.layerStack;
  const viewedPlace = layers[viewedLayerIndex] ?? layers[0];
  const parentLayer = layers[viewedLayerIndex + 1] ?? null;
  const innerLayer = viewedLayerIndex > 0 ? layers[viewedLayerIndex - 1] : null;
  const presenceCount = viewedPlace?.presenceCount ?? snapshot.presenceCount;

  const panel = useMemo(() => {
    if (activeTab === 'knock') {
      return (
        <KnockPanel
          snapshot={snapshot}
          nickname={nickname}
          token={token}
          connectionStatus={connectionStatus}
          onSendEvent={onSendEvent}
        />
      );
    }
    if (activeTab === 'profile') return <ProfilePanel nickname={nickname} />;
    return <ExplorePanel />;
  }, [activeTab, connectionStatus, nickname, onSendEvent, snapshot, token]);

  function changeLayer(nextIndex) {
    setViewedLayerIndex(nextIndex);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="app-shell">
      <header className={`place-header${collapsed ? ' place-header--collapsed' : ''}`}>
        {connectionStatus !== 'connected' ? (
          <div className="reconnect-banner" role="status">
            <span className="offline-dot" aria-hidden="true" />
            Reconnecting…
          </div>
        ) : null}
        <div className="place-header__inner">
          <div className="place-heading">
            <p className="place-heading__eyebrow">You are in</p>
            <h1>{viewedPlace?.name ?? snapshot.place.name}</h1>
            {parentLayer ? (
              <button
                className="place-layer-button"
                type="button"
                onClick={() => changeLayer(viewedLayerIndex + 1)}
              >
                inside {parentLayer.name}
                <MoveUpRight aria-hidden="true" size={13} />
              </button>
            ) : innerLayer ? (
              <button
                className="place-layer-button"
                type="button"
                onClick={() => changeLayer(viewedLayerIndex - 1)}
              >
                back inside {innerLayer.name}
                <MoveDown aria-hidden="true" size={13} />
              </button>
            ) : null}
          </div>
          <div className="presence-counter" aria-label={`${presenceCount} people here now`}>
            <span className="live-dot" aria-hidden="true" />
            <strong>{presenceCount}</strong>
            <span>here now</span>
          </div>
        </div>
      </header>

      <main id="active-panel" className="app-content" role="tabpanel" aria-label={activeTab}>
        {panel}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = id === activeTab;
          const dot = notificationDots[id];
          return (
            <button
              key={id}
              className={`nav-button nav-button--${id}`}
              type="button"
              data-active={active}
              aria-current={active ? 'page' : undefined}
              aria-label={`${label}${dot ? ', new activity' : ''}`}
              aria-controls="active-panel"
              onClick={() => onTabChange(id)}
            >
              <span className="nav-icon-wrap">
                <Icon aria-hidden="true" size={22} strokeWidth={1.8} />
                {dot ? <span className={`nav-dot nav-dot--${id}`} aria-hidden="true" /> : null}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
