# Boo Studio

A Halloween app builder. Describe an app in the chat, answer the agent's questions, watch it in the live preview, ask for changes, and publish it. Builds run on a Base44 white label integration through a small Node server, so credentials never reach the browser.

## Setup

1. Copy `.env.example` to `.env.local` (Git-ignored) and fill in:
   - `BASE44_ACCESS_TOKEN`: a personal access token created in the Boo Studio workspace under **Settings → Secrets → Personal access tokens**, with **All apps and Superagents** access and **Full access** permission.
   - `BASE44_WORKSPACE_ID`: the Boo Studio workspace ID (not your personal workspace).
2. Run `npm run check`. It should print `List apps: 200`.
3. Run `npm run dev` and open http://127.0.0.1:5173.

Node 20 or later. No dependencies.

## How it works

- `server/base44.mjs` calls the Apps API with `Authorization: Bearer` and `X-Active-Workspace-Id`, with 120-second timeouts for builds. Chat and answer calls send a stable `X-Request-ID` and are retried safely on 503.
- `server/app.mjs` gives each browser an anonymous visitor cookie and records which visitor created each app (`data/apps.json`). Every app-specific call checks ownership first, since Base44 sees one integration account behind every build.
- `server/queue.mjs` keeps app creation under 5 per minute. Retried create submits reuse the same request ID and return the existing app.
- `server/instructions.mjs` sends the Boo Studio brand and Halloween style as custom instructions on every app.
- Conversations are read back from Base44, not copied locally.

## Workspace settings (Base44 dashboard)

- **White label → System Prompt**: turn on **Custom system prompt** and set **Brand name** to `Boo Studio`. Leave **Agent prompt** empty to keep Base44's built-in data, sign-in and backend features.
- **Design system** (optional): create one from Boo Studio's colors and fonts and set it as the workspace default.

## Not included yet

- Sign-in: visitors are identified by a browser cookie. Put the builder behind your platform's sign-in before sharing it.
- Signed-in embedding and live updates: need a workspace API key (Enterprise). The preview works with the access token alone.
- Hosting: runs locally. To host, set the same variables in the host's private environment settings.
- Per-person usage limits.
