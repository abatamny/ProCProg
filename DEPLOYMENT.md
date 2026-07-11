# Deploy place-app to a VPS

This setup builds one custom `place-app` image and runs it behind Caddy. Caddy is the only public service; it obtains and renews HTTPS certificates and forwards normal HTTP and WebSocket traffic to the app.

## Before you begin

You need:

- A 64-bit Linux VPS (Ubuntu 22.04, 24.04, or 26.04 are suitable).
- A stable, dedicated public IPv4 address. A domain is optional.
- If you use a domain, an `A` DNS record pointing it to the VPS IPv4 address.
- Inbound TCP ports 80 and 443 open. UDP 443 is optional but enables HTTP/3. Keep port 3000 closed to the internet.

For an IP-only deployment, the address must be publicly reachable and under your control; a private, shared, or carrier-grade-NAT address will not pass certificate validation. [Let's Encrypt public-IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability.html) last about six days, and Caddy renews them automatically using its persistent certificate volume.

Install Docker Engine and the Docker Compose plugin using Docker's official instructions:

- https://docs.docker.com/engine/install/ubuntu/
- https://docs.docker.com/compose/install/linux/
- https://docs.docker.com/engine/install/linux-postinstall/

Start Docker and add your account to the `docker` group:

```sh
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Close the SSH session and reconnect so the new group membership takes effect. Then verify the installation:

```sh
docker version
docker compose version
```

Membership in the `docker` group is effectively root-level access. If you do not want that, skip the group step and prefix every `docker` command in this guide with `sudo`.

## 1. Put the project on the VPS

Clone the repository or upload the project into `/opt/place-app`, then enter it:

```sh
sudo mkdir -p /opt/place-app
sudo chown "$USER":"$USER" /opt/place-app
cd /opt/place-app
```

Do not upload local `node_modules`, `.env`, or development certificates. The image installs its own Linux dependencies.

The `data/` and `media/` directories are intentionally outside the image. To start empty, create them. To migrate the current local content, stop the local app first and copy both complete directories instead.

```sh
sudo install -d -o 1000 -g 1000 -m 0700 data media
install -d -m 0700 backups
```

The ownership matters because the image runs as the non-root `node` user (UID 1000). If you copied existing data, also run `sudo chown -R 1000:1000 data media` and `sudo chmod -R u=rwX,go= data media`.

## 2. Configure production

Create the private environment file and generate a safe admin password:

```sh
umask 077
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
nano .env
```

For your IP-only VPS, change these values in `.env` and replace the example IP:

```dotenv
SITE_ADDRESS=203.0.113.10
TLS_MODE=ip_tls
ADMIN_PASSWORD=paste-the-generated-value-here
FORCE_PLACE_ID=faculty-data-decision-sciences
```

- `SITE_ADDRESS` is the bare public IP only; do not include `https://`, a port, or a path.
- `TLS_MODE=ip_tls` selects Let's Encrypt's required `shortlived` certificate profile. Keep Caddy's `caddy_data` volume because renewal is frequent.
- If you add a domain later, set `SITE_ADDRESS=app.example.com` and `TLS_MODE=domain_tls`.
- Keep the default `FORCE_PLACE_ID` for the pinned demo location. Set `FORCE_PLACE_ID=` to use real GPS/polygon location instead.
- Do not set the TLS certificate paths. Caddy terminates TLS.
- Never commit or send the `.env` file.

An admin-console force-location change is overwritten at the next restart by `FORCE_PLACE_ID`, so keep the environment value in sync with the behavior you want.

## 3. Build and start

```sh
docker compose config --quiet
docker compose pull caddy
docker compose build --pull app
docker compose up -d
docker compose ps
docker compose logs --tail=100 app caddy
```

The build creates the local image `place-app:latest`. Caddy may need a minute on first start to obtain the certificate. Verify the public health endpoint and open the app in a browser:

```sh
curl -fsS https://YOUR_VPS_IP/api/health
```

The response should contain `"status":"ok"`. The user app is at `/`; the operator console is at `/admin`.

If startup fails, inspect the logs:

```sh
docker compose logs --tail=200 app caddy
```

Common causes are an unchanged `ADMIN_PASSWORD`, the wrong `TLS_MODE`, an IP that is not publicly reachable, blocked ports 80/443, or `data/` and `media/` not being writable by UID 1000.

## Update the deployment

After uploading or pulling the new source:

```sh
cd /opt/place-app
docker compose config --quiet
docker compose exec -w /etc/caddy caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose exec -w /etc/caddy caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose pull caddy
docker compose build --pull app
docker compose up -d
docker compose ps
curl -fsS https://YOUR_VPS_IP/api/health
```

Compose replaces the app container but preserves `data/`, `media/`, and Caddy's certificate volumes.

## Back up user data

SQLite uses WAL files beside the main database. For a simple consistent backup, briefly stop the app and archive both persistent directories together:

```sh
cd /opt/place-app
install -d -m 0700 backups
backup="backups/place-app-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose stop app
sudo tar -czf "$backup" data media
docker compose start app
sudo chown "$USER":"$USER" "$backup"
chmod 600 "$backup"
```

Copy backups off the VPS. Do not back up only `data/place-app.sqlite` while the app is running.

## Production constraints

- Run exactly one app replica. SQLite and live WebSocket presence are local to this process.
- Registration is open, sessions do not expire, and admin access is a shared password. Use a strong password and consider restricting `/admin` and `/api/admin` by VPN or source IP.
- Uploaded media is not automatically removed when database records are deleted. Monitor disk usage.
- Never run `docker compose down -v` or delete `caddy_data`; frequent IP-certificate renewal depends on that persistent state.
- Never publish container port 3000; direct access would bypass the trusted HTTPS proxy.
