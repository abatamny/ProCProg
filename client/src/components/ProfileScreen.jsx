import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, LogOut, MapPinCheck, Settings, Stamp } from 'lucide-react';
import { APP_TITLE } from '../config.js';
import { avatarFor } from '../lib/avatar.js';
import { fetchAlbum, fetchProfile } from '../lib/api.js';
import { shortDate } from '../lib/time.js';
import { InkViewer } from './InkViewer.jsx';

/* The private home: your mark, your places, the memories you're part of.
   Deliberately place-free — this page is yours, not any place's. */
export function ProfileScreen({
  nickname, profileVersion, placeName, onClose, onLogout,
}) {
  const [profile, setProfile] = useState(null);
  const [failed, setFailed] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [arrivedId, setArrivedId] = useState(null);
  const knownFirstMemory = useRef(null);
  const avatar = useMemo(() => avatarFor(nickname), [nickname]);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((data) => {
        if (cancelled) return;
        const firstId = data.memories[0]?.id ?? null;
        if (knownFirstMemory.current !== null && firstId && firstId !== knownFirstMemory.current) {
          setArrivedId(firstId);
          window.setTimeout(() => setArrivedId(null), 900);
        }
        knownFirstMemory.current = firstId;
        setProfile(data);
        setFailed(false);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [profileVersion]);

  async function openMemory(memory, event) {
    const rect = event.currentTarget.getBoundingClientRect();
    try {
      const album = await fetchAlbum(memory.id);
      setViewer({
        items: album.items.map((item) => ({
          id: item.mediaId,
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
      // leave the card; the viewer just doesn't open
    }
  }

  const places = profile?.places ?? [];
  const memories = profile?.memories ?? [];
  const captured = memories.filter((memory) => memory.role === 'contributor').length;

  return (
    <div className="pfpage" role="dialog" aria-label="Your profile">
      <header className="pfpage__top">
        <button type="button" className="pfpage__back" aria-label="Back to the place" onClick={onClose}>
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
      </header>

      <div className="pfpage__scroll">
        <div className="pfpage__head">
          <span className="pfpage__disc" style={{ background: avatar.tone }}>
            {avatar.initial}
          </span>
          <h2 className="pfpage__name">{nickname}</h2>
          <p className="meta pfpage__private">only you see this page</p>
          <div className="pfstats">
            <div className="pfstats__cell">
              <b>{places.length}</b>
              <span>PLACES</span>
            </div>
            <div className="pfstats__cell">
              <b>{memories.length}</b>
              <span>MOMENTS</span>
            </div>
            <div className="pfstats__cell">
              <b>{captured}</b>
              <span>CAPTURED</span>
            </div>
          </div>
        </div>

        {failed ? (
          <p className="profile__empty">Your trail could not be read. Pull yourself back later.</p>
        ) : null}

        <section>
          <p className="section-rule section-rule--plain">YOUR PLACES</p>
          {places.length === 0 ? (
            <p className="profile__empty">Your first belong stamp is being pressed here.</p>
          ) : places.map((entry) => (
            <div key={entry.id} className="place-row">
              {entry.rank === 'belong' ? (
                <span className="place-row__stamp" aria-hidden="true">
                  <Stamp size={18} strokeWidth={1.7} />
                </span>
              ) : (
                <span className="place-row__ring" aria-hidden="true">{entry.visitCount}/5</span>
              )}
              <div>
                <h3 className="place-row__name">{entry.name}</h3>
                <p className="meta">
                  {entry.rank === 'belong'
                    ? `You belong here · ${entry.visitCount} ${entry.visitCount === 1 ? 'visit' : 'visits'}`
                    : `Visitor · ${Math.max(0, 5 - entry.visitCount)} more visits to belong`}
                </p>
              </div>
            </div>
          ))}
        </section>

        <section>
          <p className="section-rule section-rule--plain">MEMORIES YOU'RE PART OF</p>
          {memories.length === 0 ? (
            <p className="profile__empty">
              Shared moments will settle here after they are engraved.
            </p>
          ) : memories.map((memory) => (
            <button
              key={memory.id}
              type="button"
              className={`trail-card${arrivedId === memory.id ? ' is-arriving' : ''}`}
              onClick={(event) => openMemory(memory, event)}
            >
              <span
                className="trail-card__thumb"
                style={{ backgroundColor: memory.dominantColor || 'var(--hairline)' }}
              >
                <img src={memory.thumbUrl} alt="" loading="lazy" draggable="false" />
              </span>
              <span className="trail-card__body">
                <span className="trail-card__title">{memory.title}</span>
                <span className="meta">
                  {memory.placeName} · {shortDate(memory.engravedAt)} · {memory.presenceTotal} were here
                </span>
                <span className={`role-tag role-tag--${memory.role}`}>
                  {memory.role === 'contributor'
                    ? (<><Camera size={12} aria-hidden="true" /> You captured this</>)
                    : (<><MapPinCheck size={12} aria-hidden="true" /> You were here</>)}
                </span>
              </span>
            </button>
          ))}
        </section>
        <div className="pfpage__tail" />
      </div>

      <footer className="pfpage__foot">
        <button type="button" className="pfpage__btn" onClick={() => setSettingsOpen(true)}>
          <Settings size={16} aria-hidden="true" />
          Settings
        </button>
        <button type="button" className="pfpage__btn pfpage__btn--logout" onClick={onLogout}>
          <LogOut size={16} aria-hidden="true" />
          Log out
        </button>
      </footer>

      {settingsOpen ? (
        <>
          <button
            type="button"
            className="sset-scrim"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="sset" role="dialog" aria-label="Settings">
            <span className="sset__grab" aria-hidden="true" />
            <h3 className="sset__title">Settings</h3>
            <div className="sset__row"><span>Nickname</span><span className="sset__v">{nickname}</span></div>
            <div className="sset__row"><span>Location</span><span className="sset__v">On · detected</span></div>
            <div className="sset__row"><span>Version</span><span className="sset__v">{APP_TITLE} 0.1</span></div>
            <button type="button" className="sset__logout" onClick={onLogout}>
              Log out
            </button>
          </div>
        </>
      ) : null}

      {viewer ? (
        <InkViewer
          items={viewer.items}
          initialId={viewer.initialId}
          origin={viewer.origin}
          placeName={placeName}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </div>
  );
}
