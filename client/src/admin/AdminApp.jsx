import { useCallback, useEffect, useMemo, useState } from 'react';
import './admin.css';

const PASSWORD_KEY = 'place-app.admin-password';

function weekdayDaypart(iso) {
  const date = new Date(iso);
  const hour = date.getHours();
  const daypart = hour >= 5 && hour < 12 ? 'morning'
    : hour >= 12 && hour < 17 ? 'afternoon'
      : hour >= 17 && hour < 22 ? 'evening' : 'night';
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
  return `${weekday} ${daypart}`;
}

function timeAgo(iso) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (60 * 24))}d`;
}

export default function AdminApp() {
  const [password, setPassword] = useState(() => window.sessionStorage.getItem(PASSWORD_KEY) ?? '');
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState('engrave');
  const [notice, setNotice] = useState('');

  const call = useCallback(async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: {
        'x-admin-password': password,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (response.status === 401) {
      setAuthed(false);
      throw new Error('unauthorized');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `failed:${response.status}`);
    return body;
  }, [password]);

  function flash(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3_500);
  }

  async function unlock(event) {
    event.preventDefault();
    try {
      await call('/api/admin/places');
      window.sessionStorage.setItem(PASSWORD_KEY, password);
      setAuthed(true);
    } catch {
      flash('Wrong password.');
    }
  }

  useEffect(() => {
    if (password && !authed) {
      call('/api/admin/places').then(() => setAuthed(true)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authed) {
    return (
      <main className="adm adm--gate">
        <form className="adm__gate" onSubmit={unlock}>
          <h1>Worker console</h1>
          <input
            type="password"
            value={password}
            placeholder="Admin password"
            autoFocus
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit" className="adm__btn adm__btn--ink">Open</button>
          {notice ? <p className="adm__notice">{notice}</p> : null}
        </form>
      </main>
    );
  }

  return (
    <main className="adm">
      <header className="adm__head">
        <h1>Worker console</h1>
        <nav className="adm__tabs">
          {['engrave', 'content', 'users', 'data'].map((id) => (
            <button
              key={id}
              type="button"
              data-active={tab === id}
              onClick={() => setTab(id)}
            >
              {id[0].toUpperCase() + id.slice(1)}
            </button>
          ))}
        </nav>
      </header>
      {notice ? <p className="adm__notice">{notice}</p> : null}
      {tab === 'engrave' ? <EngraveTab call={call} flash={flash} /> : null}
      {tab === 'content' ? <ContentTab call={call} flash={flash} /> : null}
      {tab === 'users' ? <UsersTab call={call} flash={flash} /> : null}
      {tab === 'data' ? <DataTab call={call} flash={flash} /> : null}
    </main>
  );
}

function EngraveTab({ call, flash }) {
  const [places, setPlaces] = useState([]);
  const [placeId, setPlaceId] = useState('');
  const [force, setForce] = useState(null);
  const [moments, setMoments] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (chosenPlace) => {
    const [placesBody, forceBody] = await Promise.all([
      call('/api/admin/places'),
      call('/api/admin/force-location'),
    ]);
    setPlaces(placesBody.places);
    setForce(forceBody.forcePlaceId);
    // Default to the forced place — that is where the demo audience lives.
    const usePlace = chosenPlace || forceBody.forcePlaceId || placesBody.places[0]?.id || '';
    setPlaceId((current) => current || usePlace);
    const momentsBody = await call(
      `/api/admin/moments?placeId=${encodeURIComponent(chosenPlace || usePlace)}&status=live`,
    );
    setMoments(momentsBody.moments);
  }, [call]);

  useEffect(() => {
    refresh().catch(() => flash('Could not load the console.'));
  }, [refresh, flash]);

  useEffect(() => {
    if (!placeId) return;
    call(`/api/admin/moments?placeId=${encodeURIComponent(placeId)}&status=live`)
      .then((body) => {
        setMoments(body.moments);
        setSelected(new Set());
      })
      .catch(() => {});
    setTarget(placeId);
  }, [placeId, call]);

  const chosen = useMemo(
    () => moments.filter((moment) => selected.has(moment.id)),
    [moments, selected],
  );

  // SPEC §4 fallback chain prefill: highest-presence caption, else time template.
  useEffect(() => {
    if (titleEdited || chosen.length === 0) return;
    const captioned = [...chosen]
      .filter((moment) => moment.caption)
      .sort((a, b) => b.presenceCount - a.presenceCount);
    if (captioned.length > 0) {
      setTitle(captioned[0].caption.slice(0, 40));
    } else {
      const latest = [...chosen].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      )[0];
      setTitle(weekdayDaypart(latest.createdAt));
    }
  }, [chosen, titleEdited]);

  const currentPlace = places.find((place) => place.id === placeId);
  const parentPlace = places.find((place) => place.id === currentPlace?.parentPlaceId);

  async function toggleForce() {
    try {
      const body = await call('/api/admin/force-location', {
        method: 'PUT',
        body: JSON.stringify({ forcePlaceId: force ? null : (placeId || 'faculty-data-decision-sciences') }),
      });
      setForce(body.forcePlaceId);
      flash(body.forcePlaceId ? `Force ON → ${body.place?.name}` : 'Force OFF');
    } catch {
      flash('Force toggle failed.');
    }
  }

  async function engrave() {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    try {
      await call('/api/admin/engrave', {
        method: 'POST',
        body: JSON.stringify({
          momentIds: [...selected],
          title: title.trim() || null,
          targetPlaceId: target || null,
        }),
      });
      flash(`Engraved ${chosen.length} ${chosen.length === 1 ? 'moment' : 'moments'} as a memory.`);
      setSelected(new Set());
      setTitleEdited(false);
      setTitle('');
      const body = await call(`/api/admin/moments?placeId=${encodeURIComponent(placeId)}&status=live`);
      setMoments(body.moments);
    } catch (error) {
      flash(`Engrave failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adm__panel">
      <div className="adm__force">
        <div>
          <strong>Force location</strong>
          <p>{force ? `ON → everyone is in ${places.find((p) => p.id === force)?.name ?? force}` : 'OFF — real geolocation'}</p>
        </div>
        <button type="button" className={`adm__btn ${force ? 'adm__btn--live' : ''}`} onClick={toggleForce}>
          {force ? 'Turn OFF' : 'Turn ON'}
        </button>
      </div>

      <label className="adm__field">
        Place
        <select value={placeId} onChange={(event) => setPlaceId(event.target.value)}>
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name} · {place.presenceCount} live
            </option>
          ))}
        </select>
      </label>

      <div className="adm__list-head">
        <strong>Live moments ({moments.length})</strong>
        <button
          type="button"
          className="adm__btn adm__btn--small"
          onClick={() => setSelected(
            selected.size === moments.length
              ? new Set()
              : new Set(moments.map((moment) => moment.id)),
          )}
        >
          {selected.size === moments.length && moments.length > 0 ? 'Select none' : 'Select all'}
        </button>
      </div>

      <div className="adm__rows">
        {moments.length === 0 ? <p className="adm__empty">No live moments in this place.</p> : null}
        {moments.map((moment) => (
          <label key={moment.id} className="adm__row">
            <input
              type="checkbox"
              checked={selected.has(moment.id)}
              onChange={() => setSelected((current) => {
                const next = new Set(current);
                if (next.has(moment.id)) next.delete(moment.id);
                else next.add(moment.id);
                return next;
              })}
            />
            <img src={moment.thumbUrl} alt="" style={{ backgroundColor: moment.dominantColor }} />
            <span className="adm__row-main">
              <span className="adm__row-caption">{moment.caption || <em>no caption</em>}</span>
              <span className="adm__row-meta">
                {moment.nickname} · {timeAgo(moment.createdAt)} ago · {moment.presenceCount} were here
                {moment.isSeed ? <span className="adm__seed">SEED</span> : null}
              </span>
            </span>
          </label>
        ))}
      </div>

      <label className="adm__field">
        Memory title
        <input
          type="text"
          value={title}
          maxLength={80}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleEdited(true);
          }}
        />
      </label>

      <label className="adm__field">
        Engrave into
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          {currentPlace ? <option value={currentPlace.id}>{currentPlace.name}</option> : null}
          {parentPlace ? <option value={parentPlace.id}>{parentPlace.name} (one layer up)</option> : null}
        </select>
      </label>

      <button
        type="button"
        className="adm__btn adm__btn--clay"
        disabled={chosen.length === 0 || busy}
        onClick={engrave}
      >
        {busy ? 'Engraving…' : `Engrave ${chosen.length || ''} ${chosen.length === 1 ? 'moment' : 'moments'} as memory`}
      </button>
    </section>
  );
}

function ContentTab({ call, flash }) {
  const [content, setContent] = useState({ knocks: [], moments: [], memories: [] });

  const refresh = useCallback(() => {
    call('/api/admin/content').then(setContent).catch(() => flash('Could not load content.'));
  }, [call, flash]);

  useEffect(() => { refresh(); }, [refresh]);

  async function remove(kind, id) {
    try {
      await call(`/api/admin/content/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      flash(`Deleted ${kind}. It vanished from every open client.`);
      refresh();
    } catch {
      flash('Delete failed.');
    }
  }

  function rows(kind, items, describe) {
    return (
      <>
        <div className="adm__list-head"><strong>{kind[0].toUpperCase() + kind.slice(1)}s ({items.length})</strong></div>
        <div className="adm__rows">
          {items.map((item) => (
            <div key={item.id} className="adm__row">
              {item.thumbUrl ? <img src={item.thumbUrl} alt="" /> : <span className="adm__row-noimg">txt</span>}
              <span className="adm__row-main">
                <span className="adm__row-caption">{describe(item)}</span>
                <span className="adm__row-meta">
                  {item.nickname ? `${item.nickname} · ` : ''}
                  {timeAgo(item.createdAt ?? item.engravedAt)} ago
                  {item.isSeed ? <span className="adm__seed">SEED</span> : null}
                </span>
              </span>
              <button type="button" className="adm__btn adm__btn--danger adm__btn--small" onClick={() => remove(kind, item.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <section className="adm__panel">
      <button type="button" className="adm__btn adm__btn--small" onClick={refresh}>Refresh</button>
      {rows('knock', content.knocks, (item) => item.content || 'photo knock')}
      {rows('moment', content.moments, (item) => item.caption || 'no caption')}
      {rows('memory', content.memories, (item) => item.title)}
    </section>
  );
}

function UsersTab({ call, flash }) {
  const [users, setUsers] = useState([]);

  const refresh = useCallback(() => {
    call('/api/admin/users').then((body) => setUsers(body.users)).catch(() => {});
  }, [call]);

  useEffect(() => { refresh(); }, [refresh]);

  async function remove(user) {
    if (!window.confirm(`Delete ${user.nickname} and all their content?`)) return;
    try {
      await call(`/api/admin/users/${encodeURIComponent(user.phoneNumber)}`, { method: 'DELETE' });
      flash(`Deleted ${user.nickname}.`);
      refresh();
    } catch {
      flash('Delete failed.');
    }
  }

  return (
    <section className="adm__panel">
      <div className="adm__list-head"><strong>Users ({users.length})</strong>
        <button type="button" className="adm__btn adm__btn--small" onClick={refresh}>Refresh</button>
      </div>
      <div className="adm__rows">
        {users.map((user) => (
          <div key={user.phoneNumber} className="adm__row">
            <span className="adm__row-main">
              <span className="adm__row-caption">{user.nickname}</span>
              <span className="adm__row-meta">
                joined {timeAgo(user.createdAt)} ago
                {user.isSeed ? <span className="adm__seed">SEED</span> : null}
              </span>
            </span>
            <button type="button" className="adm__btn adm__btn--danger adm__btn--small" onClick={() => remove(user)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function DataTab({ call, flash }) {
  const [busy, setBusy] = useState(false);
  const [confirmWord, setConfirmWord] = useState('');

  async function run(label, path, options) {
    setBusy(true);
    try {
      await call(path, options);
      flash(`${label} done.`);
    } catch (error) {
      flash(`${label} failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adm__panel">
      <div className="adm__data-block">
        <strong>Seed world</strong>
        <p>Fake users, knocks, live moments and memories, all marked SEED. Loading replaces any previous seed.</p>
        <button
          type="button"
          className="adm__btn adm__btn--ink"
          disabled={busy}
          onClick={() => run('Load seed', '/api/admin/seed', { method: 'POST', body: '{}' })}
        >
          Load seed data
        </button>
        <button
          type="button"
          className="adm__btn"
          disabled={busy}
          onClick={() => run('Wipe seed', '/api/admin/seed', { method: 'DELETE' })}
        >
          Wipe seed only (safe)
        </button>
      </div>

      <div className="adm__data-block adm__data-block--danger">
        <strong>Danger zone</strong>
        <p>Deletes every user and all content, real included. Places stay. Type <code>ERASE</code> to arm.</p>
        <input
          type="text"
          value={confirmWord}
          placeholder="ERASE"
          onChange={(event) => setConfirmWord(event.target.value)}
        />
        <button
          type="button"
          className="adm__btn adm__btn--danger"
          disabled={busy || confirmWord !== 'ERASE'}
          onClick={() => run('Wipe EVERYTHING', '/api/admin/wipe-everything', {
            method: 'POST',
            body: JSON.stringify({ confirm: confirmWord }),
          }).then(() => setConfirmWord(''))}
        >
          Wipe EVERYTHING
        </button>
      </div>
    </section>
  );
}
