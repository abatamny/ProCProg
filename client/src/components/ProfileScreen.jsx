import { useEffect, useRef, useState } from 'react';
import { Camera, LogOut, MapPinCheck, Stamp } from 'lucide-react';
import { fetchAlbum, fetchProfile } from '../lib/api.js';
import { shortDate } from '../lib/time.js';
import { InkViewer } from './InkViewer.jsx';

export function ProfileScreen({
  nickname, active, profileVersion, place, onViewerToggle, onLogout,
}) {
  const [profile, setProfile] = useState(null);
  const [failed, setFailed] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [arrivedId, setArrivedId] = useState(null);
  const knownFirstMemory = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((data) => {
        if (cancelled) return;
        // A memory that just appeared at the top slides into the trail live
        // (the demo's peak moment on this screen).
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
      onViewerToggle(true);
    } catch {
      // leave the card; the viewer just doesn't open
    }
  }

  const places = profile?.places ?? [];
  const memories = profile?.memories ?? [];

  return (
    <div className="profile">
      <div className="profile__scroller">
        <header className="profile__head">
          <h2 className="profile__title">Your memories</h2>
          <p className="meta profile__private">only you see this page</p>
          <p className="meta">
            {nickname} · {places.length} {places.length === 1 ? 'place' : 'places'} · {memories.length} {memories.length === 1 ? 'moment' : 'moments'}
          </p>
        </header>

        {failed ? (
          <p className="profile__empty">Your trail could not be read. Pull yourself back later.</p>
        ) : null}

        <section>
          <p className="section-rule section-rule--plain">PLACES</p>
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
          <p className="section-rule section-rule--plain">MEMORIES YOU ARE PART OF</p>
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

        <button type="button" className="logout" onClick={onLogout}>
          <LogOut size={15} aria-hidden="true" />
          Leave quietly
        </button>
        <div className="profile__tail" />
      </div>

      {viewer ? (
        <InkViewer
          items={viewer.items}
          initialId={viewer.initialId}
          origin={viewer.origin}
          placeName={place.name}
          onClose={() => {
            setViewer(null);
            onViewerToggle(false);
          }}
        />
      ) : null}
    </div>
  );
}
