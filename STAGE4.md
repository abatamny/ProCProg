# Stage 4: Media pipeline mobile HTTPS test

Stage 4 adds client-side WebP compression, optimistic photo knocks, an
authenticated `202 Accepted` upload, content-hash filenames, a CPU-bounded
Sharp queue, 128px and 800px generated sizes, dominant-color placeholders,
immutable media responses, lazy loading, and upload retry. Video remains cut.

## 1. Install and verify

From the repository root:

```powershell
npm ci
npm test
npm run build:client
npm audit
```

The media integration test creates a 1600×1000 WebP and verifies:

- unauthenticated uploads are rejected;
- the upload returns HTTP 202;
- duplicate bytes reuse one SHA-256 media record;
- generated dimensions are exactly 128×80 and 800×500;
- dominant color and immutable URLs are stored;
- `knock_new` arrives only when the generated files are ready;
- the development media response has a one-year immutable cache header.

## 2. Reuse the trusted HTTPS certificate

Use the mkcert certificate prepared in `STAGE2.md`. Regenerate it if the
computer's LAN IP changed. Both phones must show a trusted connection with no
certificate warning.

## 3. Start Fastify and the media worker

Open terminal 1 in the repository root:

```powershell
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:ENABLE_STAGE1_HARNESS = '0'
$env:FORCE_PLACE_ID = 'faculty-data-decision-sciences'
$env:MEDIA_PATH = '.\media'

$bytes = New-Object byte[] 24
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$env:ADMIN_PASSWORD = [Convert]::ToBase64String($bytes)
$env:ADMIN_PASSWORD

npm run dev:server
```

## 4. Start the client over LAN HTTPS

Open terminal 2:

```powershell
$env:DEV_TLS_CERT_PATH = (Resolve-Path '.\.certs\place-app.pem').Path
$env:DEV_TLS_KEY_PATH = (Resolve-Path '.\.certs\place-app-key.pem').Path
$env:DEV_API_TARGET = 'http://127.0.0.1:3000'
npm run dev:client
```

Open on iOS Safari and Android Chrome:

```text
https://YOUR_WINDOWS_LAN_IP:3443/
```

Use different nicknames on the two phones.

## 5. Stage 4 phone acceptance

### Immediate local rendering

- [ ] Open Knock and tap the photo icon beside the text field.
- [ ] Choose a large camera photo. Its tilted ellipse appears immediately;
      there is no network spinner blocking the screen.
- [ ] A thin ring and `developing…` meta remain while compression, upload, and
      resizing run.
- [ ] The composer and navigation remain responsive during processing.
- [ ] When the server copy arrives, the local object URL is replaced without a
      duplicate ellipse or visible jump.

### Cross-device delivery

- [ ] Keep the second phone on Knock. It receives the photo only after the
      thumbnail and medium size are ready.
- [ ] The second phone first paints the stored dominant color, then fades in
      the lazily loaded thumbnail.
- [ ] Both phones show the same deterministic tilt and aspect ratio.
- [ ] Tap the ellipse. The viewer uses the 800px medium image and the place
      remains identified at the top.
- [ ] Reload both phones. The photo returns once from the 24-hour snapshot.

### iOS and Android compression

- [ ] Repeat with a fresh photo from iOS Safari.
- [ ] Repeat with a fresh photo from Android Chrome.
- [ ] Portrait and landscape photos keep their orientation.
- [ ] A source larger than 1600px on its longest side uploads successfully.
- [ ] Take several photos quickly. Presence, text knocks, and navigation remain
      responsive while generated files develop one by one.

### Failure and retry

- [ ] Begin a photo knock and interrupt the network during upload.
- [ ] The local ellipse stays visible with a retry button and a short error;
      it does not silently disappear.
- [ ] Restore the network and tap retry. The same local ellipse resolves into
      one server knock.
- [ ] If the socket reconnects after the upload succeeded, retrying the send is
      idempotent for that user/place/media combination.

## 6. Inspect generated files and immutable delivery

After sending at least one photo:

```powershell
Get-ChildItem '.\media' -Filter '*-original.webp'
Get-ChildItem '.\media' -Filter '*-thumb.webp'
Get-ChildItem '.\media' -Filter '*-medium.webp'
```

There should be one original, thumb, and medium file per unique image hash.
To verify the development cache header, copy a printed thumb filename:

```powershell
$lanIp = '192.168.1.23'
$thumb = 'PASTE_HASH-thumb.webp'
curl.exe --head "https://${lanIp}:3443/media/$thumb"
```

Expected:

```text
Content-Type: image/webp
Cache-Control: public, max-age=31536000, immutable
```

The Fastify `/media` route exists only in development for phone testing. The
production deployment keeps `/media` on nginx so Node never serves image
traffic.

## 7. Force-location regression

Force location remains ON throughout this test. No photo operation should ask
for geolocation, and every photo knock should target Faculty by default while
the Faculty → Technion audience picker remains available.
