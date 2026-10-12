# Boo Studio

Halloween app builder interface with a Base44 White Label Apps API adapter.

Frontend: https://talevy25.github.io/boo-studio-halloween/
Static website repository: https://github.com/Talevy25/boo-studio-halloween

## Current status

Frontend: https://talevy25.github.io/boo-studio-halloween/
Backend: https://boo-studio-backend.onrender.com (Render Free).

The backend is deployed and authenticated app listing is verified. App records and request history are persisted in an admin-only Base44 StudioState entity, so Render restarts do not erase them. Free instances sleep when idle and can take about a minute to wake. Base44 generation uses workspace credits.

Open Connect builder and choose the separately provided private studio access JSON file. Keep that file private; it grants access to create and publish apps using your workspace. The Base44 token stays in Render secrets. No credentials are committed or included in the source archive.

Eleven automated tests pass. This is a single-owner, single-instance prototype.

## Run the frontend

Node.js 20.19+; no package installation required.

```sh
npm run dev
npm run build
npm run preview
```

## Start the backend

Use your existing backend to host/adapt `server/`, or run this standalone Node server. Copy `.env.example` to a local `.env` and configure it privately. Never commit `.env` or add it to the static website.

Required environment variables:

- `BASE44_PAT`: your workspace personal access token with the Apps API permissions described in Base44's onboarding guide.
- `BASE44_WORKSPACE_ID`: the workspace ID, used in both the header and create request.
- `BOO_ADMIN_KEY`: a separate random studio access key, at least 24 characters. This is NOT the Base44 token.
- `BOO_ALLOWED_ORIGINS`: exact comma-separated browser origins, including `https://talevy25.github.io` and the server's HTTPS origin if it also serves the frontend.
- `BOO_DATA_FILE`: path on a persistent disk for the app mapping and request ledger.

```sh
npm run build
node --env-file=.env server/start.mjs
```

Default address: http://localhost:8787. For a hosted service set `HOST=0.0.0.0`, use the host's assigned `PORT`, and terminate HTTPS at the host/reverse proxy. Permit at least 150 seconds for requests. Run ONE server instance with a persistent disk. The data store is not designed for ephemeral/serverless filesystems or multiple replicas.

Open “Connect builder” in Boo Studio. Enter the backend origin and the separate studio key. Never enter the Base44 PAT into that form. The form expects this adapter's `/api` contract, not the Base44 API URL.

## Scope and behavior

- Create an app with the workspace's design system and Halloween instructions.
- Poll status, read paged conversation messages, send follow-up prompts.
- Display the exact waiting action and allow approval, decline, or a text answer. Choice lists render as a selector when the payload supplies string options; otherwise the exact request is shown with an answer field. Unknown question formats stay blocked for review in Base44.
- Load a fresh authenticated preview URL into an isolated iframe. Preview tokens are not persisted.
- Explicit publish confirmation deploys the current app version; the published URL can then be opened.
- New generated apps inherit the workspace access default. Set `BASE44_APP_VISIBILITY` only to deliberately override it. The live test inherited `public_without_login`; no publish was requested. This implementation does not add end-user SSO.

This is a **single-owner builder**: the studio key grants access to this studio's creations. It is not a multi-user SaaS tenancy system. Before offering separate accounts, replace the studio-key gate with your platform's verified sessions and store an owner ID on every app/request. Keep authorization checks on all app operations. The server currently rejects IDs outside its own persistent creation mapping and never lists every app in your Base44 workspace.

## Request safety

Creation and turn mutations keep an on-disk request ledger. A repeated request ID cannot issue the same successful mutation twice. A transport failure or server restart marks uncertain work for manual investigation rather than silently repeating it. Inspect Base44 before starting another request after an uncertain result. Answer submissions also send a stable upstream request ID derived from the app and tool-call IDs. Upstream error bodies, full completed tool payloads, and credentials are not logged or returned.

## Verification

```sh
npm test
```

Tests cover workspace targeting, secret separation, unknown-app rejection, CORS, request replay, uncertain creation, paged transcripts, waiting actions, answer inputs, preview-token handling, publication confirmation, and private-file serving restrictions. Live contract validation remains required because the Apps API is in beta.

## Documentation

- https://docs.base44.com/developers/white-label/overview
- https://docs.base44.com/developers/white-label/tenancy-and-credentials
- https://docs.base44.com/developers/white-label/the-build-turn
- https://docs.base44.com/api-reference/create-app
- https://docs.base44.com/api-reference/read-conversation-messages
- https://docs.base44.com/api-reference/get-preview-url

`base44/config.jsonc` is retained from the earlier hosting setup; this studio has not been provisioned as a Base44 app. GitHub Pages hosts only static files. Deploy `server/` to your backend separately.

## Backend hosting attempt — October 12, 2026

Created Base44 backend app `6accc4c65c9f6cbdf26e5e9f` in the Boo workspace. Configured server secrets and deny-all StudioApp/StudioRequest entity schemas. Base44 rejected function deployment with HTTP 403: "Backend functions require a Builder plan or higher." The cloud gateway in `cloud/gateway.js` is an unvalidated deployment draft; it has not been published. GitHub Pages remains unchanged and is not connected to the backend. The cloud ledger prevents ordinary sequential retries, but has no cross-instance atomic uniqueness guarantee.

## Starter alignment

Reference: https://github.com/base44/base44-platform-starter/tree/main/examples/white-label-minimal (reviewed October 12, 2026). Structured choices support single and multiple selections; secret requests use password fields; approvals support allow/decline. Answers include the originating message ID and validated structured payload. Polling preserves unfinished inputs. Live socket streaming and viewer SSO are not enabled: the starter requires a separate workspace service key for these capabilities. Existing polling and signed sandbox preview remain active.

## Chat-first interface

The default view is now a chat beside the live preview. The first message creates an app; subsequent messages update the selected app. Studio access is remembered in sessionStorage for the current tab and removed by Lock studio. A new tab may still require the private access file. The Base44 PAT never enters the frontend.


## Automatic visitor access

Visitors now receive a signed, scoped session automatically and can send their first prompt without a key, access file, or private link. Their session is remembered in localStorage. Each visitor can access only apps created by their own session. The server-side admin key retains access to all apps. Public creation uses the configured workspace credits, with a shared limit of five app starts per minute. Clearing browser storage loses visitor access to those apps; the administrator retains access. The earlier manual access-file instructions no longer apply.
