# Local Project Changes

This file documents what was added or changed in this local project folder:

```text
C:\Users\abed\Desktop\gptapp
```

It is meant as a simple future reference for the files in this folder.

## GitHub Repository

The local project is connected to this GitHub repository:

```text
https://github.com/abatamny/ProCProg.git
```

The deployment changes were pushed to the `main` branch.

Relevant commits:

```text
9c1c746 Add Docker VPS deployment
28ac036 Set Caddy container DNS servers
```

## Files Added

### `.dockerignore`

Added to control which files are excluded when Docker builds the project image.

### `Dockerfile`

Added to build a production Docker image for the project.

### `compose.yaml`

Added to run the project with Docker Compose.

This file defines:

- The app container.
- The Caddy container.
- Docker volumes.
- Port publishing for `80` and `443`.
- Local folders mounted into the container, such as `data` and `media`.

### `Caddyfile`

Added as the Caddy configuration file.

This file is used by the Caddy container when the project is deployed.

### `DEPLOYMENT.md`

Added as the deployment guide for running the project on a VPS.

### `PROJECT_CHANGES.md`

Added as this change log file.

### `server/test/production.test.js`

Added as a production-related test file.

## Files Changed

### `.env.example`

Updated with deployment-related environment variables.

### `.gitignore`

Updated to ignore local backup files/folders.

### `API_CONTRACT.md`

Updated during the deployment work.

### `package.json`

Updated with a new package dependency.

### `package-lock.json`

Updated because package dependencies changed.

### `server/src/app.js`

Updated during the deployment work.

### `server/src/config.js`

Updated during the deployment work.

### `server/test/media.test.js`

Updated during the deployment work.

### `server/test/sessions.test.js`

Updated during the deployment work.

## Files Not Added To Git

### `.claude/`

This folder exists locally but was not added to Git.

Current untracked file:

```text
.claude/settings.local.json
```

## Docker-Related Local Project Additions

The local folder now contains the files needed to build and run the project with Docker:

```text
Dockerfile
compose.yaml
Caddyfile
.dockerignore
```

## Documentation Added

The local folder now contains deployment and change documentation:

```text
DEPLOYMENT.md
PROJECT_CHANGES.md
```

## VPS Update Flow

After future GitHub pushes, the VPS can update the project from this repository:

```bash
cd /opt/gptapp
git pull
docker compose down
docker compose up -d --build
```

## Current Note

`PROJECT_CHANGES.md` was created after the Docker deployment commits.

If this file should also exist on GitHub and on the VPS, it should be committed and pushed.
