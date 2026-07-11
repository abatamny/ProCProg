# DESIGN & ENGINEERING SPEC (for Claude Code)

All decisions below were finalized in a brainstorm session. This spec is written in English and is detailed enough to build the demo from. It extends (does not replace) everything written above.

## 1. Visual language — "Paper & Ink"

**Core principle:** The app is a sheet of paper the place writes on. The place is the hero of every screen; people are secondary. Color appears only when it carries meaning, never as decoration.

**Palette (exactly 4 colors):**

- **Paper** `#FAFAF7` — app background
- **Ink** `#141414` — primary text, bottom nav bar, dark surfaces
- **Clay** `#D85A30` — means "engraving / permanence": the Capture camera button, Explore accents, engraved-content markers, time-strata dividers (muted `#993C1D`), "fades in Xh" labels
- **Live green** `#1D9E75` — means "happening right now" and NOTHING else: the presence counter dot, live nav badges, the "I was here" button, real-time pulses
- Supporting grays: `#8A8A82` (secondary text/meta), `#B4B2A9` (muted), `#E5E3DB` (hairline borders)

**Rule:** when a user sees green they know it is live; when they see clay they know it is engraved/permanent. Never mix these roles.

**Typography:**

- Display font: **Space Grotesk** (Google Fonts) — place names, headers, buttons, counters. Place name is the hero: 28–32px bold on the thick header, 20–22px when collapsed.
- Body font: **Inter** — knock text 14–15px, captions, UI copy.
- Nicknames and timestamps are ALWAYS 11–12px gray (`#8A8A82`). People never get large type. No avatars anywhere in the app — only small nicknames. The place is the profile.

**Header behavior:** thick on page entry (big place name + live counter), shrinks on scroll to a compact bar (small place name + green dot + count). For nested places show the parent as a small line under the name, e.g. "Ullmann Building / inside Technion" — tapping the parent line navigates up one place layer.

**Bottom nav:** full-ink black bar, 3 icon buttons: Knock, Explore, Profile. Active tab gets its meaning color (Explore active = clay). Content area swaps; nav and header persist.

**Microcopy voice:** every string continues the engraving/archaeology metaphor. "older memories" instead of "load more". "Be here when something happens" for empty states. "fades in 23h" for expiring content. App language: English.

## 2. Notification system

**Cross-page (nav badges):**

- A small dot on a nav icon when new content arrived on a page the user is not currently viewing.
- Dot color = content meaning: green dot on Knock (live message), clay dot on Explore (new memory / new live moment).
- Dot only, NEVER a number/counter on the nav — no inbox pressure.
- Dot clears when the user enters that page (no per-message read state needed — one boolean per tab).

**In-page (floating pill):**

- If the user is scrolled away from where new content lands (scrolled up in Knock when a new message arrives at the bottom, or deep in Explore when something new lands at top), show a floating pill: ink-black rounded pill with a small green dot + label, e.g. "3 new knocks ↓". Tapping smooth-scrolls to the content. Pill auto-dismisses if the user scrolls there themselves.
- If the user IS at the landing edge, new content just slides in with a small ripple animation — no pill.

**Logic (client):** every WebSocket event is tagged with its target tab. `if (event.tab !== activeTab) → light nav dot. else if (scroll position far from landing edge) → show/increment pill. else → animate content in.`

## 3. Knock — design decisions

- Knock is NOT a chat-bubble UI. A text knock renders as a "margin note": a thin 2px ink-black left border, the text, and a small gray meta line (nickname · relative time). Older knocks gradually fade via opacity as they approach the 24h limit.
- **Photo/video messages render as tilted ellipses ("river pebbles"):**
    - Each ellipse gets its own rotation between −8° and +8°, derived deterministically from a hash of the message ID (`tilt = (hash(msgId) % 17) − 8`), so the same message looks identical for everyone, always.
    - Aspect ratio also varies per message between 1.15 and 1.45 (also hash-derived).
    - Consecutive photo messages must tilt in OPPOSITE directions — if the previous one tilted left, flip the next one right.
    - Ellipses are also offset horizontally (alternating left/right) so the feed meanders like a river instead of a straight column.
    - CSS: `border-radius: 50%; aspect-ratio: var(--ar); transform: rotate(var(--tilt)); object-fit: cover;`
    - Optional caption up to ~80 chars renders below the ellipse in the standard knock meta style.
- **Fullscreen viewer ("paper-to-ink inversion"):** tapping an ellipse opens the media fullscreen. ~350ms choreography: rotation animates to 0°, border-radius animates from 50% to 24px (ellipse "melts" into a rounded rectangle), background fades to full ink black, caption slides up from the bottom. Viewer shows: place name + green dot top-left (place context persists everywhere), close X top-right, media, caption below the media (never overlaid on it), meta line with nickname · time on the left and "fades in Xh" in clay on the right, and a drag handle at the bottom. Swipe-down closes by reversing the animation (follow the finger, threshold to release). Swipe left/right navigates between live media in the place. Prefetch the next image while viewing the current one.

**Knock backend (demo):**

- **Layer routing (no AI in demo):** the composer has a layer-picker chip above the input. Default target = the innermost layer the user is currently in. Tapping the chip expands the place stack, each layer shown with its LIVE presence count ("Ullmann · 47" / "Technion · 312") — the user picks an audience, not an abstraction. Inner layers render slightly indented to visualize nesting. The knock is stored with `TARGET_PLACE_ID` and broadcast to every socket subscribed to that place OR any place contained within it (one query on the place-hierarchy table). The AI context-based routing described earlier in this page is a production feature, deferred.
- Table: `KNOCKS (ID, PLACE_ID, PHONE_NUMBER, TYPE{text,image,video}, CONTENT, CREATED_AT)` with a composite index on `(PLACE_ID, CREATED_AT)`.
- Messages live exactly 24 hours in the place they were sent in. On joining a place, the server sends full 24h history: `SELECT * FROM knocks WHERE place_id = ? AND created_at > NOW() - INTERVAL 24 HOUR ORDER BY created_at`, then live messages stream over the same WebSocket.
- No cron needed for the demo — the query filter hides expired rows; a once-daily cleanup job physically deletes them. (If using Redis instead: `EXPIRE` 24h.)
- `created_at` also drives the client-side fade opacity and the "fades in Xh" label.

## 4. Explore — design decisions

Explore has two vertical zones telling one story: **present at the top, past below**. Scrolling down = digging into the place's memory.

**Zone A — Live now (top):**

- All live moment content (24h lifetime) renders as floating bubbles (circles) in a cluster area under a "LIVE NOW · fades in 24h" label (green dot + green label).
- Each bubble drifts gently with its own CSS keyframe animation (5–7s cycles, 4–6px movement, transform-only — cheap). It should feel like the place breathing.
- **Bubble size encodes social weight, opacity encodes remaining time:** `size = MIN_SIZE + K * sqrt(presenceCount)`, capped at MAX_SIZE. As the 24h window runs out, the bubble fades in opacity. A huge translucent bubble reads as "something big happened here and it is about to vanish" — deliberate drama.
- Video bubbles get a clay ring + small play icon.
- Density cap: show the 12 most relevant bubbles + one ink-black overflow bubble labeled "+N".
- Empty state: the bubble zone collapses to one thin line — "Nothing live right now. Be the first to capture this place." with a small arrow toward the camera FAB.
- Tapping a bubble opens the same fullscreen ink viewer as Knock.

**"I was here" (presence confirmation):**

- Inside the viewer, a pill button outlined in live green with a map-pin-check icon: "I was here". On tap it fills green and becomes "You were here". One-way action, no un-toggling.
- Only users physically in the place now, or who have a `USER_VISITS` row overlapping the moment's timestamp, may confirm — this keeps the signal honest.
- Confirmation emits a WebSocket event; everyone viewing the place sees the bubble pulse and grow in real time.
- Table: `MOMENT_PRESENCE (MOMENT_ID, PHONE_NUMBER, CONFIRMED_AT)` with PK on `(MOMENT_ID, PHONE_NUMBER)` to prevent duplicates. Keep a denormalized `presence_count` on the MOMENT row for cheap reads.
- **This count is the primary signal for the engraving worker**: if `presence_count` of a moment (or a cluster of moments from the same time window) crosses a threshold relative to the place's typical population, the worker engraves the moment into Explore. The "N were here" number on engraved cards is this sum. Consider also counting a presence confirmation as a `USER_VISITS` entry toward belong rank.
- **Moment titles (no AI in demo)** — deterministic fallback chain: (1) if any moment in the cluster has a caption, use the caption of the moment with the highest `presence_count`, truncated to 40 chars — a human-written title by someone who was there; (2) otherwise use a time template: `"{Weekday} {daypart}"` → "Tuesday evening", "Friday morning" (dayparts: morning 5–12, afternoon 12–17, evening 17–22, night 22–5). Never include the place name in the title — the place is already the page header. Side benefit: rule 1 gives users a real incentive to write captions, since their words can become the permanent name of the place's memory.

**Engraving in the demo — admin "Worker console" (Wizard of Oz):**

The admin area at `/admin` is a full responsive panel (works from phone and desktop, same route, same env-var password) with four tabs: **Engrave**, **Content**, **Users**, **Data**. It gives the demo operator complete control over content and the database.

**Seed strategy:** every table gets an `IS_SEED BOOLEAN DEFAULT 0` column. The seed script marks everything it inserts. Real user-generated rows are never marked. This makes "delete the fake stuff" a single safe action that cannot touch real content — the operator can even wipe seed live mid-demo, starting with a full world and clearing it on stage before uploading real content.

**Tab: Content** — all knocks, digs, and moments across all places, filterable by place and type. Each row shows thumb/preview, caption, nickname, place, presence count, and a `SEED` tag when applicable, plus a delete button. **Every delete broadcasts a removal event over WebSocket so the item vanishes from all open clients instantly** (also useful live: inappropriate upload → gone in a second).

**Tab: Users** — list users, manually set rank (visitor/belong — this is how a belong-rank user is produced for the demo), delete user (cascades their content).

**Tab: Data** — `Load seed data` (runs the seed script), `Wipe seed only` (deletes all rows where `IS_SEED = 1`, the safe button), and a danger zone `Wipe EVERYTHING` that requires typing a confirmation word. 

**Tab: Engrave** — the engraving console described below, plus the Force-location toggle.

The automatic engraving worker is NOT implemented in the demo. Instead, a hidden admin dashboard lets the demo operator manually turn live moments into memorys — the audience sees an "intelligent" system; the operator is the intelligence. This resolves all open algorithm questions (clustering, threshold, timing, layer attribution) by human judgment, with zero algorithmic risk during a live demo.

- **Route:** hidden `/admin`, protected by a hardcoded password from an env var. Not linked anywhere in the app UI.
- **Force location override (GPS insurance):** a toggle at the top of the admin console — "Force all users into: Faculty of Data and Decision Sciences (Technion)". When ON, the server SKIPS point-in-polygon entirely and resolves every location request (any coordinates, or even denied location permission) to the Faculty place. Implemented as one nullable settings row (`FORCE_PLACE_ID`); flipping the toggle broadcasts a relocation event so ALL connected clients move to the place immediately — it can be switched on mid-demo if indoor GPS misbehaves. The place layer stack (Faculty → Technion) remains intact, so the Knock layer picker still demonstrates the nesting feature while forced.
- **UI:** pick a place → list of its live moments, each row showing thumb, caption (or "no caption"), nickname, time, and presence count. Checkboxes per row + a Select all control. Below: a title field **pre-filled by the fallback chain** (highest-presence caption, else "{Weekday} {daypart}") and editable; a target-layer dropdown (default: the moments' own place; option to engrave one level up); a clay "Engrave N digs as moment" button.
- **On engrave:** server creates a `MEMORIES` row + `MEMORY_MEDIA` rows (order by created_at), sets the selected digs' status to `engraved`, computes `PRESENCE_TOTAL` as the union of confirming users across the selected digs, and broadcasts a `memory_engraved` WebSocket event. Clients animate: the selected bubbles converge/disappear from LIVE NOW and the new card slides into the top of ENGRAVED — time this for the demo's peak moment. Unselected digs keep living out their 24h normally.
- The console IS the future worker with a human brain: when the real algorithm is built later, it only replaces "who ticks the checkboxes" — the entire engraving pipeline (moment creation, broadcast, animation) is already built and tested.

**Zone B — Engraved memory (below):**

- Section divider "ENGRAVED" in muted clay, then moments grouped by time strata with clay divider lines: "THIS WEEK", "MAY 2026", "WINTER 2025" — like depth markers in a geological cross-section.
- Each memory is one full-width monumental card: cover image, worker-generated title in Space Grotesk, meta line "date · N were here · M photos", small quiet like/comment counts at the card bottom. One card per row — engraving is rare and precious, never a dense grid.
- Older strata get slightly reduced opacity (depth = fading, subtle).
- **Album indicator:** if a moment contains more than 1 photo, render 2 stacked "sheets" peeking behind the card, tilted −3° and +2° (implemented as `::before`/`::after` pseudo-elements in neutral stone grays `#E5E3DB` / `#D3D1C7` — never real images, saves loading), plus an ink-black count badge (stack icon + number) on the top-right of the cover. Single-photo moments: flat card, no layers, no badge. On tap the layers "fan out" for 200ms, then the album opens in the ink viewer with swipe navigation between its photos.
- Pagination: cursor-based, `WHERE engraved_at < :cursor LIMIT 10`; the load trigger is labeled "older memories". Album photos load only when the album is opened.

**Moment interactions — "Stones & words" (deliberately NOT likes & comments):**

An memory is a small monument, not content — so interactions follow the ancient cairn ritual (travelers adding a stone to a pile) instead of social-network patterns.

- **Leave a stone (replaces like):** one tap adds a small tilted stone-ellipse to a visible pile at the bottom of the moment (each stone slightly different gray/clay tint and rotation — same pebble language as Knock). One-way, one per user, no un-liking. The user's stone drops into the pile with a small animation — physical feedback, not a jumping number. The pile renders up to ~8 stones then a "N stones" text label. There is NO "who liked" list — only the pile. Psychology: you are not rating content, you are adding yourself to the pile.
- **Words left here (replaces comments):** a flat guestbook, not a chat. Short notes up to 100 chars in the Knock margin-note style (thin left border + text + nickname · relative time). Completely flat: NO replies, NO threads, NO @mentions. One word-note per user per moment. Like carvings on a bench.
- **Presence-gated:** only users currently present in the place can leave a stone or a word — you cannot touch a place's memory remotely; you have to come. (Automatically satisfied in the demo via Force-location.)
- **Card exterior (Explore list):** replace heart/comment icons with a quiet meta line "18 stones · 4 words".
- **Data:** reuse `MEMORY_REACTIONS` with `TYPE{stone, word}` (stone rows have NULL text; word rows carry COMMENT_TEXT ≤100 chars). Uniqueness: one row per (MOMENT_ID, PHONE_NUMBER, TYPE). Broadcast stone/word events over WebSocket so piles and guestbooks grow live on all open screens.
- Optional polish: as the user scrolls deeper, shift the paper background a few percent toward a stone-cream tone (scrollY-driven) — a subconscious "going underground" effect.

**Camera FAB + capture flow:**

- A clay circular floating action button (camera icon) bottom-right above the nav — the only colored button on the screen.
- Flow: tap FAB → camera (for demo use `<input type="file" accept="image/*,video/*" capture="environment">`; upgrade to `getUserMedia` later for an in-app camera) → caption screen: ink-black background, the captured media previewed as a tilted ellipse, one optional text field "Say something about this moment…" (~100 chars), clay button "Dig it" → appears as a new bubble with a small pop animation. **DEMO NOTE: AI content moderation is SKIPPED in the demo** — content publishes directly. Moderation (for digs and for visitor-rank knocks, as described earlier in this page) is a production feature, deferred.
- Video limit for demo: ~15 seconds, no client-side video compression.

**Video bubbles — living preview animation (attention magnet):**

- **Server side (background queue, ffmpeg):** every uploaded video produces (1) a poster frame grabbed at 0.5s (skips black first frames), (2) a 3-second muted teaser clip downscaled to 240px (~150KB), (3) the original. Same bounded p-queue as image resizing.
- **Two bubble states:** *Sleeping* — shows the poster, with a clay arc (partial ring) slowly ORBITING the bubble circumference (6s rotation, transform-only) and a softly breathing play icon. *Awake* — the muted teaser loops inside the circle, full clay ring, small mute badge.
- **Performance rule that doubles as the effect:** at most 2 video bubbles are awake at once. If more exist, wakefulness rotates every ~5 seconds — one bubble wakes, plays a loop, falls back asleep, the next wakes — with a soft crossfade. The bubble zone flickers with life in shifting spots, pulling the eye exactly where there is motion.
- **Markup:** `<video muted loop playsinline preload="none">` — `playsinline` is mandatory for iOS (otherwise fullscreen hijack), `muted` is what makes autoplay legal.
- **In the viewer:** full video autoplays MUTED with a speaker icon; tap toggles sound; loops until closed.

## 10. WebSocket protocol (single source of truth)

All realtime traffic on one socket per client, JSON messages `{type, payload}`. Client authenticates on connect with the session token; server subscribes the socket to the user's current place + all ancestor places.

**Server → client events:**

- `place_state` — on join: full snapshot (place info, layer stack, presence count, 24h knocks, live moments, first Explore page)
- `presence_update` — `{placeId, count}` (batched, max 1/sec/place)
- `knock_new` — `{knock}` (delivered to target place + contained places)
- `moment_new` — `{dig}` (thumb ready; bubble appears)
- `moment_presence` — `{digId, presenceCount}` (batched 1/sec; bubble grows)
- `memory_engraved` — `{moment, removedDigIds, participants}` (bubbles converge/vanish, card enters ENGRAVED, participants' profiles update live)
- `reaction_new` — `{momentId, type: stone|word, word?}` (piles/guestbooks grow live)
- `content_removed` — `{kind, id}` (admin deletion; item vanishes everywhere)
- `relocated` — `{place}` (Force-location toggled; client re-renders as the new place)

**Client → server events:**

- `auth {token}`, `location {lat, lng}` (ignored while Force is ON), `away` / `back` (visibility), `knock_send {targetPlaceId, type, content|mediaId}`, `moment_presence_confirm {digId}`, `reaction {momentId, type, word?}`
- Heartbeat: server pings every 30s; 2 missed pongs → close socket (feeds the 60s presence grace).
- Client reconnects with exponential backoff (1s, 2s, 4s… max 15s) and re-sends `auth` + last known location; server replies with a fresh `place_state` so the UI self-heals after any drop.

## 11. Edge & failure states (demo)

- **Outside every polygon (Force OFF):** full-screen quiet state — "You are not in a mapped place yet." with a small map-pin illustration. No app chrome. (With Force ON this never appears.)
- **Location permission denied:** same screen with "Enable location to enter places" + a retry button. With Force ON, the user enters the forced place regardless — permission is not needed.
- **Connection lost:** thin ink-black banner at the top — "Reconnecting…" with the green dot grayed out. Content stays visible (read-only feel); banner disappears on the automatic reconnect.
- **Empty Knock:** "No one has knocked here in the last 24 hours. Be the first." in the margin-note style.
- **Empty Explore:** live zone — "Nothing live right now. Be the first to capture this place."; engraved zone — "This place has no memory yet. Be here when something happens."
- **Upload failed (network):** the optimistic bubble/knock gets a small retry icon instead of silently disappearing; tap retries the upload.

## 4b. Presence & the live counter (demo-minimal)

**The green counter is the app's trust anchor — it must look stable and honest in front of an audience.** Demo rule set (≈20 lines of code total):

- **Present = an open WebSocket + a visible tab.** Client listens to `visibilitychange` and sends `away` / `back` events over the socket.
- **60-second server-side grace:** when a socket drops or an `away` arrives, do NOT decrement immediately — start a 60s timer for that user. If they reconnect / send `back` within the window, cancel the timer; the counter never moved. If not, decrement cleanly by 1 and close the `USER_VISITS` row. One timer per user, that's the whole algorithm. This absorbs WiFi→cellular switches, brief app switches, and screen locks without counter flicker (46→47→46 is what "broken" looks like).
- **Everything else is deferred to production** (not implemented in demo): continuous `watchPosition` re-checks, exit-by-geolocation, boundary flapping hysteresis, visit merging rules (gaps < X min = one visit), minimum-dwell thresholds for `USER_VISITS`, and belong-rank accrual. The Force-location override (section on the admin console) removes physical-exit and GPS-flapping concerns for the demo entirely. If a belong-rank user is needed for the demo, set the rank manually in seed data or set the visit threshold to 1.

## 5. Media pipeline — speed, concurrency, compression

**Guiding principle: the user never waits on the network.** Heavy work happens either before (client) or after (background), never while the user watches a spinner.

**a) Client-side compression before upload** (biggest win):

```jsx
async function compress(file, maxDim = 1600, quality = 0.8) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = new OffscreenCanvas(img.width * scale, img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/webp', quality });
}
```

Turns 3–8MB camera photos into 150–300KB WebP. Upload becomes ~20x faster and the server does zero resize work on the hot path.

**b) Optimistic UI:** the moment media is captured, render the bubble immediately from the local blob (`URL.createObjectURL`) with a thin progress ring. Upload runs in background (no moderation step in the demo). The user perceives everything as instant.

**c) Three server-side sizes, generated in background** with `sharp` (Node): thumb 128px (bubbles, cards), medium 800px (viewer), original kept. Filenames are content hashes → serve with `Cache-Control: public, max-age=31536000, immutable` so browsers never re-request.

**d) Dominant-color placeholders + lazy loading:** on upload, extract the image's dominant color with sharp and store it on the media row. Clients render an instantly-painted colored circle/card, then fade the thumb in when loaded (`loading="lazy"` + IntersectionObserver). No white boxes popping in, feed feels fast on slow networks.

**e) Server concurrency:** Node is non-blocking for I/O; NEVER do image processing inside a request handler. The upload endpoint only persists the raw file and returns `202 Accepted` immediately. Resizing and the Explore engraving worker run through an in-memory job queue (`p-queue` is enough for the demo — no Redis/RabbitMQ). Completion events are pushed to clients over the existing WebSocket.

**f) Read path:**

- On entering a place: ONE HTTP request returns everything — 24h knocks + live moments list + first Explore page. Small JSON (meta + thumb URLs only); images lazy-load afterward.
- Explore pagination is cursor-based, never offset, never "fetch all".
- Album photos are fetched on album open; inside the viewer, prefetch the next image while the current one is on screen so swiping always feels instant.
- Critical DB indexes: `(place_id, created_at)` on both KNOCKS and MOMENTS tables.

**Build order for the demo (impact/effort):** 1. client compression + optimistic UI (≈80% of perceived speed), 2. multi-size + color placeholders, 3. background queue. All of it without Redis, CDN, or extra infrastructure — just correct architecture.

## 6. Additional tables introduced by this spec

```jsx
KNOCKS        (ID PK, PLACE_ID, PHONE_NUMBER, TYPE{text,image,video}, CONTENT, MEDIA_ID NULL, CREATED_AT)
MOMENTS          (ID PK, PLACE_ID, PHONE_NUMBER, MEDIA_ID, CAPTION NULL, PRESENCE_COUNT INT DEFAULT 0,
               STATUS{live,engraved}, CREATED_AT)
               -- demo: no moderation, so no pending/rejected states; add them back in production
MOMENT_PRESENCE  (MOMENT_ID, PHONE_NUMBER, CONFIRMED_AT, PK(MOMENT_ID, PHONE_NUMBER))
MEDIA         (ID PK, HASH, TYPE{image,video}, DOMINANT_COLOR, THUMB_URL, MEDIUM_URL, ORIGINAL_URL, CREATED_AT)
MEMORIES       (ID PK, PLACE_ID, TITLE, COVER_MEDIA_ID, PRESENCE_TOTAL, PHOTO_COUNT, ENGRAVED_AT)
MEMORY_MEDIA  (MOMENT_ID, MEDIA_ID, ORDER_INDEX)
MEMORY_REACTIONS (MOMENT_ID, PHONE_NUMBER, TYPE{stone,word}, COMMENT_TEXT NULL, CREATED_AT)
                 -- PK (MOMENT_ID, PHONE_NUMBER, TYPE); stone rows: NULL text; word rows: ≤100 chars
```

Indexes: `KNOCKS(place_id, created_at)`, `MOMENTS(place_id, created_at)`, `MEMORIES(place_id, engraved_at DESC)`.

## 7. Screen-by-screen summary for implementation

1. **Onboarding:** welcome message → request location + camera permissions → nickname input (demo note: real product uses phone/SMS registration; enforce nickname rules: 3–20 chars, alphanumeric + underscore, unique) → loading screen with a signature animation (suggested: a radius circle converging onto the place polygon, then the polygon outline "engraved" in a clay stroke — visualizing the actual point-in-polygon algorithm).
2. **Explore (default landing page):** thick header (place name, parent-place line, live counter with pulsing green dot) → LIVE NOW bubble zone → ENGRAVED strata feed → clay camera FAB → ink bottom nav.
3. **Knock:** same header/nav, margin-note messages + tilted ellipse media, composer at bottom, floating "N new knocks ↓" pill logic.
4. **Fullscreen viewer:** shared by Knock media, live bubbles, and engraved albums. Ink-black, place context top-left, caption below media, "I was here" green pill (live moments only), swipe-down close, swipe left/right navigate, next-image prefetch.
5. **Profile — "Your memories" (fully designed, live-tested with students — prepare well):**
    - **Radical product decision: there are NO public profiles.** No user can view another user's profile — person↔person does not exist in this app. This page is completely private: a personal travel journal, not a stage. Subtitle under the header says "only you see this page".
    - **What is deliberately absent:** no follower counts, no avatar, no bio, no "my posts" grid. Header is small: "Your memories" + one meta line "nickname · N places · M moments".
    - **Section PLACES:** each place the user has visited, with their relationship to it. `belong` rank renders as a clay stamp seal (circle with stamp icon, clay border) + "You belong here · N visits". `visitor` rank renders as a dashed gray ring with progress ("3/5") + "Visitor · 2 more visits to belong" — quiet progress, no loud gamification.
    - **Section MEMORIES YOU ARE PART OF:** every memory the user participated in, small cards (thumb + title + place · date · N were here), each with a role tag: clay "You captured this" (camera icon) for contributors, green "You were here" (map-pin-check icon) for witnesses. Tapping opens the moment in the standard ink viewer. This is the inversion of a personal feed: not "my posts" but shared memories the user appears in.
    - Quiet ghost logout button at the bottom (clears token, returns to onboarding).
    - **`MEMORY_PARTICIPANTS` table, written at engrave time (critical for the live student test):** when the operator clicks Engrave, the server computes the participant set and stores `(MOMENT_ID, PHONE_NUMBER, ROLE{contributor, witness})` — contributor = authored a moment in the cluster, witness = confirmed "I was here"; contributor wins if both. Profile query becomes a trivial indexed SELECT instead of a live join over historical digs — essential when 100 students open their profiles simultaneously.
    - **Live update:** the `memory_engraved` broadcast includes the participant list; participants currently on their profile see the new moment slide into their trail in real time, others get a dot on the Profile nav tab. (Demo peak moment: operator engraves, 30 students watch "You were here" appear in their personal trail at once.)

## 7b. Session & returning users

- **Demo rule: ALL users are `belong` rank.** On a user's first entry to any place, the `USER_PLACE_RANK` row is created directly with `rank = belong`. No visitor state, no visit-count progression, no rank-based permission differences anywhere in the demo. The visitor design (dashed progress ring, "2 more visits to belong") stays in this spec as production-only and will simply never render in the demo.
- On registration the server issues a random UUID token; client stores it in `localStorage`. Every app open silently validates the token and enters directly — no name screen for returning users (refresh, close/reopen, next day: same trail).
- Nickname collision at registration → suggest a variant (e.g. "noamk_2"). Nickname rules as in section 7.1.
- Logout (profile page) deletes the token client-side and returns to onboarding.
- WebSocket authenticates with the token on connect.

## 7c. Demo simplification — Explore visibility rule

The original rule ("only those who took part in building a memory can see it unless physically present") is **deferred to production**. Demo rule: everyone present in a place sees its full Explore. In the demo everyone is physically in the same place anyway (and Force-location guarantees it), so the rule has no observable effect — skipping it removes implementation complexity for free.

## 8. Tech stack & deployment (demo target: 100 concurrent students, must not go down)

**Sizing reality:** 100 concurrent users is light load for a single modern server — IF the architecture is right. The real danger scenario is not steady load but the burst: ~40 students uploading photos within the same 10 seconds (this WILL happen the moment the presenter says "take a picture"). Everything below is built around surviving that burst.

**Stack:**

- **Frontend:** React + Vite. Static build served by nginx — the Node process never touches frontend traffic.
- **Server:** Node.js + Fastify (2–3x faster than Express, same simplicity) + `ws` for WebSockets. One Node process comfortably holds thousands of sockets; 100 is trivial.
- **Database:** SQLite via `better-sqlite3` with **WAL mode enabled** (`PRAGMA journal_mode=WAL` — critical line; without it writes block reads, with it concurrent reads are free and writes take microseconds). At 100 users this is nowhere near its limits, and zero external services = zero extra failure points during a live demo. Keep the indexes from section 6.
- **Geometry:** Turf.js for point-in-polygon (barely runs at all while Force-location is ON).

**Protection layer (the "must not get stuck" guarantees):**

1. **nginx in front of everything:** terminates HTTPS (Let's Encrypt via certbot — **mandatory**: browsers block camera and geolocation on non-HTTPS origins), serves `/media` image files directly from disk with `Cache-Control: immutable` (Node never sees an image request — that is ~90% of traffic), serves the static frontend, and proxies only `/api` + the WebSocket upgrade to Node.
2. **PM2 with auto-restart:** if Node crashes for any reason it is back within a second. Clients implement WebSocket auto-reconnect with exponential backoff (a few lines) — the audience sees at most a one-second hiccup.
3. **Bounded sharp queue:** image processing is the only thing that can choke the machine. Run all resize jobs through `p-queue` with `concurrency = number of CPU cores` (e.g. 4). A 40-photo burst processes sequentially while the server stays responsive; bubbles simply "develop" one after another on viewers' screens — which reads as alive, not slow.
4. **Rate limits:** max upload body 5MB (client compression from section 5 keeps real payloads at ~300KB anyway), per-user limits of 1 knock/second and 1 dig/5 seconds. Students will try to spam; give them a wall.
5. **Broadcast throttling:** live-counter changes and bubble-growth events are batched and broadcast at most once per second per place — never one event per action. Prevents a message storm when 100 people tap "I was here" together.
6. **Socket hygiene:** WebSocket ping/pong heartbeat every 30s; sockets that miss 2 pongs are closed (feeds the 60s presence grace from section 4b).
7. **Pre-demo load test:** a short k6 (or artillery) script simulating 150 users — connect, join place, send knocks, upload an image — run once the day before. Non-negotiable.

**Deployment (operator's own server):**

- nginx + certbot (HTTPS) → Fastify under PM2 → SQLite file + `/media` directory on local disk.
- Single environment file: `ADMIN_PASSWORD`, `PORT`, `FORCE_PLACE_ID` default, media path.
- Docker Compose optional; direct install is easier to hot-fix mid-demo.
- Nightly (or pre-demo) backup = copying two things: the SQLite file and the `/media` folder.

## 9. Seed data script

- Every table has `IS_SEED BOOLEAN DEFAULT 0` (see admin panel section). The seed script marks all its rows; the admin Data tab can load and wipe seed independently of real content.
- **Places (manual GeoJSON, checked into the repo):** two nested polygons — Faculty of Data and Decision Sciences inside Technion. Draw them once with [geojson.io](http://geojson.io) over the campus map; OSM coverage for individual Technion buildings is unreliable, manual polygons are 15 minutes of work and fully controlled.
- **Seed content:** ~8 fake users (nicknames only), a handful of live knocks (staggered timestamps within the last few hours), 4–6 live moments with varied `presence_count` values (so bubbles render at visibly different sizes), and 4–5 memorys spread across time strata ("THIS WEEK", a month ago, "last semester") with 1 single-photo moment and at least 1 multi-photo album (to show the stack indicator). Seed images: a folder of campus-appropriate photos checked into the repo.
- Keep seed modest — the demo should feel like a young living product, not a fully staged simulation; the operator wipes seed and switches to real content at the chosen moment via the admin Data tab.
## 12. Demo playbook (5-minute live demo, ~100 students)

**The 5-minute demo is a timed performance, not an app tour. Everything below is built around this script.**

### The script (minute by minute)

**Pre-show (audience settling in):** projector shows the app + a giant QR code. Students scan, register (nickname, ~10 seconds), Force-location places everyone in the Faculty. **The green counter climbs on the projector: 12… 34… 61…** — drama before a single word is spoken.

**Minute 1 — Opening:** one manifesto line ("social networks disconnect you from this room"), then point at the counter: "87 of you are already *here* — in an app that only sees this room."

**Minute 2 — Knock:** "Say hello to the room." The projector floods with live knocks. The audience sees their own words appear — the moment they realize it's real.

**Minute 3 — Dig:** "Capture this moment." Bubbles start popping and drifting. Then: "open a bubble you like and tap I was here" — **bubbles grow live on the projector**.

**Minute 4 — Peak: the engraving.** The co-operator (see below) selects the best moments in /admin and hits Engrave. On the projector: bubbles converge, a card "Thursday evening · 87 were here" is engraved. Then: "open your profile" — **87 students watch 'You were here' appear in their personal trail simultaneously.** This is the moment that sells everything.

**Minute 5 — Close:** "This moment is now engraved in this Faculty. Whoever stands here a year from now will find you." End.

### Scope: core vs. cut list (decided now, in a clear head — not the night before)

**CORE — must be flawless on real iPhones and Androids (this is everything the script touches):**

registration + session token, live presence counter, text Knock, photo Capture + bubbles, "I was here" + live bubble growth, admin Engrave console + Force location, profile trail with live moment arrival, seed data.

**CUT FIRST if time runs out (the script does not use them):**

1. **Video — DEFERRED from the demo entirely.** Photos only. This also resolves the 15s-video vs 5MB-upload-limit contradiction (uncompressed phone video is 20–60MB): no decision needed, videos come after the demo. The video-bubble animation spec above stays for later.
2. Stones & words on memorys.
3. Onboarding loading animation (a simple spinner is fine).
4. Polish animations (bubble convergence can be a simple fade if needed).

**Rule: a smaller demo that runs silk-smooth beats a full demo that stutters once.**

### Demo-day checklist

- [ ]  **Test the actual room's network days before.** The real bottleneck at 100 users is the venue WiFi/cellular, not the server. Plan B: ask the audience to use cellular data; Plan C: a hotspot for the presenter/projector devices.
- [ ]  **A co-operator (friend) with /admin open on their phone** — watches the Content tab, deletes anything inappropriate instantly (there is no moderation!), and executes the Engrave at minute 4. The presenter presents; the co-operator operates. One person cannot do both.
- [ ]  Run the k6 load test (150 simulated users) at least a day before.
- [ ]  Seed data loaded; rehearse the "Wipe seed" moment if using it.
- [ ]  Force-location ON before doors open.
- [ ]  Test the full script once on an iPhone (Safari) and once on Android (Chrome) — from QR scan to profile — in the actual room if possible.
- [ ]  Server: PM2 running, HTTPS valid, backup of DB + /media taken.
- [ ]  Projector device logged in as a regular user with the Explore page open (it is the audience's shared screen).
- [ ]  iOS screen-lock note: with a 5-minute engaged demo nobody locks their screen, and the 60s presence grace absorbs anyone who does. Not a concern.

**Project name: NOT YET DECIDED — placeholder codename `place-app`.** Claude Code should use the codename for the repo/package and keep the visible app title easily changeable (one constant in the frontend config).