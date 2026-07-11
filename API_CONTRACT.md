# API CONTRACT — the real, working backend surface

This document is the single bridge between the retired first-pass frontend
(now in `/legacy-frontend`, reference only) and the new frontend. Everything
below was extracted from the legacy frontend's actual calls and then verified
line-by-line against the server source (`server/src/**`). Where the legacy
code, the server, and `SPEC.md` §10 disagree, the disagreement is called out
explicitly in §6 of this file.

Backend status: **stages 1–5.** Stages 1–4 (sessions, places/presence,
text+photo Knocks, media pipeline) are untouched. Stage 5 (added during the
frontend rebuild, new code only) fills every gap that §7 originally listed:
Moments capture, "I was here", Memories pagination + albums, Profile data,
and the admin Engrave/Content/Users/Data endpoints. §7 now documents the
stage-5 surface. Only Stones & Words (`reaction`) remains a deliberate no-op
(SPEC §12 CUT list).

---

## 1. Transport & environment

- **Same origin, relative paths.** The client only ever calls `/api/*`,
  `/ws`, and `/media/*` on its own origin. In development, Vite (port 3443,
  HTTPS via mkcert) proxies all three to Fastify on `http://127.0.0.1:3000`
  (`ws: true` for `/ws`). In production Caddy terminates HTTPS and proxies the
  origin to Fastify. The client must never hardcode a host or port.
- **HTTPS is mandatory** on phones — geolocation and camera require a secure
  context. WS URL is derived from page protocol: `https:` → `wss:`.
- `GET /media/:filename` is served by Fastify from `MEDIA_PATH` in both
  development and the containerized production runtime. Media URLs arrive
  from the server already prefixed with `/media/`.
- Fastify body limit 5 MB. WS max inbound payload 64 KB.

## 2. Session model

- Register once → server returns an opaque UUID **token**.
- Legacy client stored it at localStorage key **`place-app.session-token`**.
  (New frontend may keep the key so existing test-phone sessions survive the
  swap — recommended.)
- Every REST call that needs auth sends `authorization: Bearer <token>`.
- The WS authenticates with the same token as its **first frame**.
- Logout = delete the token client-side. There is no server-side logout
  endpoint; sessions live forever.
- Invalid-session signals the client must treat as "logged out, clear token,
  return to onboarding":
  - REST: HTTP 401 from `/api/session`
  - WS: close code `1008` with reason string `invalid session`

## 3. REST endpoints

### 3.1 `GET /api/health` — boot probe (no auth)

```json
200 {
  "status": "ok",
  "database": { "journalMode": "wal", "foreignKeys": true },
  "forcePlaceId": "faculty-data-decision-sciences" | null
}
```

The legacy client reads only `forcePlaceId`: truthy ⇒ Force-location is ON ⇒
onboarding skips the geolocation permission step entirely ("This demo
already knows the room"). Also used as the reachability check; failure shows
a boot-error retry screen.

### 3.2 `POST /api/register` — create user + session (no auth)

Request: `{"nickname": "noamk"}` — 3–20 chars `[A-Za-z0-9_]`,
case-insensitively unique. Server trims before validating.

```json
201 { "conflict": false, "token": "<uuid>", "user": { "nickname": "noamk" } }
409 { "error": "nickname_taken", "suggestion": "noamk_2" }
400 { "error": "invalid_nickname", "message": "<human sentence>" }
```

Note the `conflict: false` field really is present on the 201 body.
The 409 `suggestion` is guaranteed available (server probes variants).

### 3.3 `GET /api/session` — validate a stored token

Header: `authorization: Bearer <token>`

```json
200 { "user": { "nickname": "noamk" } }
401 { "error": "invalid_session" }
```

Called once on every app open before connecting the socket.

### 3.4 `POST /api/media` — upload one photo (auth required)

- Headers: `authorization: Bearer <token>`, **`content-type: image/webp`**.
  The server registers a parser **only** for `image/webp` — any other
  content type is rejected by Fastify (415). Client must compress/convert
  to WebP before uploading (legacy used canvas, max dim 1600, q 0.8).
- Body: the raw WebP bytes (not multipart, not base64). ≤ 5 MB.

```json
202 { "mediaId": "<uuid>" }
401 { "error": "invalid_session" }
400 { "error": "image_required" }   // empty body
```

Semantics (important for optimistic UI):

- **202 means accepted, not ready.** Thumb (320px), medium (800px) and
  dominant color are generated on a background queue.
- Upload is **content-addressed (SHA-256)**: uploading identical bytes twice
  returns the same `mediaId`. Safe to retry blindly.
- There is **no endpoint to poll media status**. Readiness is signaled only
  by the `knock_new` WS broadcast, which the server withholds for an image
  knock until thumb + medium + dominant color all exist.

### 3.5 `GET /media/:filename` — image bytes

- Filename shape: `<sha256-hex>-(original|thumb|medium).webp` (regex-enforced).
- Response: `image/webp` with `cache-control: public, max-age=31536000,
  immutable` — URLs never change content; cache freely.

### 3.6 Admin (header `x-admin-password: <ADMIN_PASSWORD>`)

Only Force-location exists today:

- `GET /api/admin/force-location` →
  `200 { "forcePlaceId": string|null, "place": Place|null }` | `401 { "error": "unauthorized" }`
- `PUT /api/admin/force-location` body `{"forcePlaceId": "technion" | null}` →
  `200 { "forcePlaceId", "place": Place|null, "changed": boolean }`
  | `400 { "error": "forcePlaceId_required" }` (key absent)
  | `400 { "error": "unknown_place" }` | `401`

A changed PUT immediately relocates **all** connected sockets (see
`relocated` below). No other admin tabs (Engrave / Content / Users / Data)
exist server-side.

## 4. WebSocket protocol (as actually implemented)

- URL: `wss://<origin>/ws`. Any other upgrade path is destroyed.
- Every frame both directions is JSON `{ "type": string, "payload": object }`.
  **The server silently drops any frame whose `payload` is missing, null,
  non-object, or an array** — so even `away`/`back` must carry `payload: {}`.
  Unknown `type` values are silently dropped too. Binary frames are ignored.
- **`auth` must be the first frame**, within 10 s of connect
  (`WS_AUTH_TIMEOUT_MS`), else close `1008 "auth timeout"`.
  - Bad token → close `1008 "invalid session"` (logout signal, do not retry).
  - Any non-`auth` frame before auth → close `1008 "auth must be first"`.
  - Re-sending `auth` with the *same* token is safe (server re-sends
    `place_state`); with a *different* token → close
    `1008 "session already authenticated"`.
- **Heartbeat:** server pings every 30 s; 2 missed pongs → terminate.
  Browsers answer pings automatically; the client does nothing.
- **Reconnect (client contract, proven in the legacy hook):** exponential
  backoff 1 s, 2 s, 4 s, 8 s, then 15 s repeated. On every open, in order:
  `auth {token}` → `away`/`back` per current `document.visibilityState` →
  `location {lat,lng}` if a real coordinate is cached. Server replies with a
  fresh `place_state` that must **replace** (not merge into) client state —
  this is the self-heal path.
- **There are no acks.** `knock_send` failures (invalid target, bad caption,
  video, invalid media) are swallowed server-side with **no error frame**.
  The only confirmation any send ever gets is the resulting broadcast.

### 4.1 Client → server

| type | payload | server behavior |
|---|---|---|
| `auth` | `{ token }` | validates; enters forced place if Force ON, else restores the user's known place (if another of their sockets already resolved one), else sends `place_state` with `place: null, reason: "location_required"` |
| `location` | `{ lat: number, lng: number }` | **ignored entirely while Force is ON.** Non-finite values dropped. Resolves point-in-polygon to the innermost place; on hit, enters it and sends `place_state` to **all** the user's sockets; on miss with no current place, sends `place_state` `{place: null, reason: "outside"}`; on miss while already placed, does nothing |
| `away` / `back` | `{}` | presence visibility. `away` (or socket drop) starts a 60 s server-side grace before the counter decrements; `back` within the window cancels it |
| `knock_send` | `{ targetPlaceId, type: "text"\|"image", content?, mediaId? }` | `targetPlaceId` must be the user's current place or one of its ancestors (their subscription set), else silently dropped. **text**: non-empty `content` (trimmed). **image**: `mediaId` from §3.4, optional caption `content` ≤ 80 chars (trimmed, empty→null). `type:"video"` rejected. Image sends are **idempotent per (place, user, mediaId)** — a retry returns the existing knock instead of duplicating |
| `moment_presence_confirm` | `{ digId }` (per SPEC §10) | **accepted and ignored — not implemented** |
| `reaction` | `{ momentId, type, word? }` | **accepted and ignored — not implemented** |

Rate limits from SPEC §8 (1 knock/s, 1 capture/5 s) are **not implemented**.

### 4.2 Server → client — events that are actually emitted

**`place_state`** — the full snapshot; sent on auth, on location resolve, on
relocation, and after every reconnect. Replaces all place-scoped client state.

```json
{
  "place":        { "id", "name", "slug", "parentPlaceId" } | null,
  "layerStack":   [ { "id", "name", "slug", "parentPlaceId", "presenceCount" }, ... ],
  "presenceCount": 0,
  "knocks":       [ Knock, ... ],
  "liveMoments":  [ Moment, ... ],
  "memories":     [ Memory, ... ],
  "nextMemoriesCursor": null,
  "reason":       "location_required" | "outside"   // ONLY when place is null
}
```

- `layerStack` is ordered **inner → outer**; index 0 is the current place
  itself (e.g. `[Faculty, Technion]`). Each layer carries its own live
  `presenceCount` — this feeds the Knock audience picker.
- `knocks`: last 24 h, oldest→newest, from the current place **and all its
  ancestors** (a Technion knock appears for Faculty users).
- `liveMoments`: `status='live'`, last 24 h, **newest→oldest**, from the
  current place only.
- `memories`: latest **10** by `engravedAt` DESC. `nextMemoriesCursor` is
  **always `null`** — pagination is not implemented (gap §7).

**`presence_update`** — `{ "placeId", "count" }`. Batched at most 1/s/place.
Update the matching `layerStack` entry, and the header count when
`placeId === place.id`. Absolute values, never deltas.

**`knock_new`** — `{ "knock": Knock }`. Text knocks broadcast immediately;
image knocks **only once media processing finishes** (this is the upload
"ack"). Delivered to everyone whose subscription set contains the target
place, i.e. the target place and every place nested inside it. **Dedupe by
`knock.id`**: after a reconnect, a knock may arrive both inside `place_state`
and as a live event.

**`relocated`** — `{ "place": Place | null }`. Force-location toggled by the
admin. When `place` is non-null the server follows up immediately with a
fresh `place_state`, so the client only needs to clear any location gate.
When `place` is null (Force turned OFF and the user has no cached real
coordinate server-side), the client must re-send `location` or show the
location gate.

### 4.3 Server → client — reserved but NEVER emitted today

`moment_new`, `moment_presence`, `memory_engraved`, `reaction_new`,
`content_removed` are valid protocol constants server-side, but **no code
path sends them**. Their SPEC §10 payload shapes (`{dig}`,
`{digId, presenceCount}`, `{moment, removedDigIds, participants}`,
`{momentId, type, word?}`, `{kind, id}`) are the contract to build against
when the backend catches up — but nothing can be exercised end-to-end yet.

### 4.4 Wire shapes

```ts
Knock = {
  id: string, placeId: string, placeName: string,
  type: "text" | "image",
  content: string | null,        // text body, or image caption
  mediaId: string | null,
  createdAt: string,             // ISO-8601 UTC with ms, e.g. "2026-07-11T09:15:04.123Z"
  nickname: string,
  dominantColor: string | null,  // "#rrggbb" — null for text knocks
  thumbUrl: string | null,       // "/media/<hash>-thumb.webp" (320px)
  mediumUrl: string | null,      // 800px — viewer size
  originalUrl: string | null
}

Moment = {                        // items of place_state.liveMoments
  id, placeId, caption: string | null,
  presenceCount: number, status: "live",
  createdAt, nickname, dominantColor, thumbUrl, mediumUrl
}                                 // NB: no mediaId, no originalUrl

Memory = {                        // items of place_state.memories
  id, placeId, title: string,
  presenceTotal: number, photoCount: number,
  engravedAt: string, dominantColor, thumbUrl
}   // NB: no mediumUrl, no album media list, no stones/words counts

Place = { id, name, slug, parentPlaceId: string | null }
```

## 5. Client-side assumptions the legacy frontend baked in (keep or consciously drop)

1. **Token storage**: localStorage `place-app.session-token`; cleared on
   REST 401 or WS close `1008 "invalid session"`.
2. **Boot order**: `GET /api/health` → (token? `GET /api/session`) →
   onboarding or straight to socket. `forcePlaceId` from health gates the
   whole geolocation UX.
3. **Nickname regex mirrored client-side**: `/^[A-Za-z0-9_]{3,20}$/`.
4. **Nav-dot mapping** (`event.type → tab`): `knock_new → knock`,
   `moment_new → explore`, `memory_engraved → explore`; dot only when the
   event's tab ≠ active tab.
5. **24 h client-side re-filtering**: knocks are filtered by
   `now - createdAt < 24h` on render (server only filters at snapshot time),
   and `createdAt` drives fade opacity and the "fades in Xh" label.
6. **Deterministic pebble geometry** (must match on every device):
   FNV-1a 32-bit hash of the knock `id`;
   `tilt = (hash % 17) − 8` degrees; `aspect = 1.15 + ((hash >>> 8) % 31)/100`;
   consecutive photo tilts with the same sign get the later one flipped;
   horizontal offset alternates left/right by photo index in the feed.
7. **Optimistic photo flow**: render local `URL.createObjectURL` ellipse
   immediately → compress to WebP (max dim 1600, q 0.8; iOS Safari fallback
   from `OffscreenCanvas` to `<canvas>.toBlob`) → `POST /api/media` →
   `knock_send {type:"image", mediaId}` → the pending item is replaced when
   a `knock_new` with the **same `mediaId`** arrives. Retry re-uses the
   `mediaId` (server idempotency makes this safe).
8. **No send acks** (§4): text composer clears optimistically; delivery is
   confirmed only by the echo `knock_new`.
9. **Visibility**: `visibilitychange` → `away`/`back` frame; also sent right
   after auth on every (re)connect so a hidden reconnect doesn't inflate the
   counter.
10. **Timestamps**: `Date.parse()` on the ISO strings; all server times UTC.
11. **Dev topology**: Vite on `0.0.0.0:3443` (HTTPS, mkcert), proxying
    `/api`, `/ws`, `/media` to `http://127.0.0.1:3000`; env vars
    `DEV_TLS_CERT_PATH`, `DEV_TLS_KEY_PATH`, `DEV_API_TARGET`. Phones open
    `https://<LAN-IP>:3443/`. (STAGE1–4.md hold the full phone-trust runbook.)
12. `viewport-fit=cover` + `theme-color #FAFAF7` in index.html; safe-area
    insets used by the ink bottom nav.

## 6. Mismatches found (legacy code / server vs SPEC.md)

1. **SPEC §13 does not exist.** `spec.md` ends at §12 + the codename note.
   Final terminology (Capture / Moments / Memories — never "dig") was given
   in the rebuild brief instead. Note the tension: SPEC §10's *payload field
   names* still use dig-era names (`moment_new {dig}`, `moment_presence
   {digId}`, `memory_engraved.removedDigIds`, `moment_presence_confirm
   {digId}`). Since the server emits none of these yet, the wire names are
   unconfirmable — treat SPEC §10 as authoritative for the wire, and keep
   "dig" out of all user-visible copy.
2. **`place_state` is richer than SPEC §10**: adds `nextMemoriesCursor`
   (always null) and `reason` on the null-place variant. SPEC's "first
   Explore page" is implemented as a fixed latest-10 with no cursor.
3. **`relocated {place}`** can carry `place: null` (Force OFF + unresolvable
   user). SPEC §10 doesn't mention the null case; the server does it.
4. **Registration**: SPEC §7b implies plain success; the real 201 body also
   carries `conflict: false`, and collision handling is a 409 + `suggestion`.
5. **Section-2 notification logic is client-only**: events carry no `tab`
   field on the wire; the mapping in §5.4 is derived client-side. Matches
   SPEC's intent, but don't expect `event.tab`.
6. **Rate limits (SPEC §8) are absent**, as are the admin Content/Users/
   Data/Engrave tabs (SPEC §4) — Wizard-of-Oz engraving cannot run yet.
7. **Presence-gating for reactions (SPEC §4)** is moot: `reaction` is a
   no-op server-side.
8. Header behavior: SPEC §1 says the header shrinks on scroll, while the
   rebuild brief says the header **never changes after the entry morph** —
   the brief wins for the new frontend.

## 7. Stage 5 — the surface added for the rebuilt frontend (all new code)

New files: `server/src/services/moments.js`, `memories.js`,
`seed-content.js`, `server/src/routes/stage5.js`. Additive wiring only in
`app.js` (service construction, route registration, media-ready handler now
also broadcasts moments) and `websocket.js` (`moment_presence_confirm`
implemented, `broadcastToAll`/`refreshAll` added). No stage-1–4 logic changed.

### 7.1 REST (session-authed unless noted)

- `POST /api/moments` body `{mediaId, caption?≤100}` →
  `201 {moment}` | `200 {moment}` (idempotent replay per place+user+media)
  | `400 {error: media_required|invalid_media|invalid_caption}`
  | `409 {error: "not_in_place"}` | `429 {error: "capture_rate_limited"}`
  (1 capture / 5 s / user; replays exempt). Place = the user's current place
  server-side; the client never sends it. `moment_new` broadcasts immediately
  if media variants are ready, else when processing finishes (same deferred
  rule as image knocks).
- `GET /api/moments/confirmed` → `{momentIds: [...]}` — the user's own
  "I was here" set (place_state carries no per-user state).
- `GET /api/memories?placeId=&beforeEngravedAt=&beforeId=&limit=10` →
  `{memories: [MemoryCard...], nextCursor: {beforeEngravedAt, beforeId} | null}`.
  MemoryCard = §4.4 Memory **plus `coverMediumUrl`** (the socket snapshot's
  10 memories still carry only `thumbUrl`; the client refreshes page 1 over
  REST for crisp covers + the real cursor).
- `GET /api/memories/:id` → `{memory: MemoryCard, items: [{orderIndex,
  mediaId, dominantColor, thumbUrl, mediumUrl, originalUrl}]}` (album).
- `GET /api/profile` → `{user: {nickname}, places: [{id, name, rank,
  visitCount}], memories: [MemoryCard + {placeName, role:
  "contributor"|"witness"}]}`.

### 7.2 Admin (header `x-admin-password`)

- `GET /api/admin/places` → `{places: [{id, name, parentPlaceId, presenceCount}]}`
- `GET /api/admin/moments?placeId=&status=live|engraved` → rows with
  `caption, nickname, createdAt, presenceCount, thumbUrl, isSeed`
- `POST /api/admin/engrave` body `{momentIds: [...], title?, targetPlaceId?}`
  → `201 {memory, removedDigIds, participants: [{nickname, role}]}`. Runs the
  full SPEC §4 pipeline (title fallback chain server-side too, cover =
  highest-presence moment, PRESENCE_TOTAL = union of confirmers,
  MEMORY_PARTICIPANTS with contributor-wins) and broadcasts `memory_engraved`.
- `GET /api/admin/content?placeId=` → `{knocks, moments, memories}`;
  `DELETE /api/admin/content/:kind/:id` (kind ∈ knock|moment|memory) →
  broadcasts `content_removed {kind, id}` to every client.
- `GET /api/admin/users`; `DELETE /api/admin/users/:phoneNumber` (cascades).
- `POST /api/admin/seed` (load SPEC §9 world; replaces prior seed; generates
  its images with sharp), `DELETE /api/admin/seed` (IS_SEED=1 only),
  `POST /api/admin/wipe-everything` body `{confirm: "ERASE"}`.
  All three refresh every connected client with a fresh `place_state`.

### 7.3 WS events now live (SPEC §10 payloads, dig-era field names kept)

- `moment_presence_confirm {digId}` — implemented; presence-gated (the
  socket's subscription set must contain the moment's place), one per
  user/moment, silently idempotent.
- `moment_new {dig}` — dig = §4.4 Moment **plus `mediaId`** (for optimistic
  reconciliation). Broadcast to the moment's place subscribers; the client
  filters by `dig.placeId === place.id`.
- `moment_presence {digId, presenceCount}` — batched ≤1/s like presence.
- `memory_engraved {moment: MemoryCard, removedDigIds, participants:
  [{nickname, role}]}` — clients match `participants[].nickname` against
  their own nickname for the profile-trail live update.
- `content_removed {kind, id}` — sent to all connected clients.
- `reaction` / `reaction_new` — still no-ops (Stones & Words are CUT, SPEC §12).

### 7.4 Frontend overlay rule (hard-won)

Fullscreen overlays (ink viewer, capture sheet) are rendered through a React
portal on `document.body`. They must never mount inside the tab pager: the
pager track carries a `transform`, which hijacks `position: fixed` and lands
the overlay on the wrong panel.
