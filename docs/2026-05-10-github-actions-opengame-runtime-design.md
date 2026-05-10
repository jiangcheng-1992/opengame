# GitHub Actions OpenGame Runtime Migration

## Problem

Vercel Sandbox returns HTTP 402 in production and E2B API key creation is blocked by payment verification. The MVP still needs a real OpenGame runtime, browser validation, Blob upload, and database status updates without adding a paid sandbox dependency.

## Decision

Use GitHub Actions as the default low-frequency generation worker.

- Vercel keeps serving the Next.js app, gallery, create flow, and polling APIs.
- `SANDBOX_PROVIDER=github` makes the app queue a GitHub-backed job. If `GITHUB_DISPATCH_TOKEN` is configured, Vercel triggers `.github/workflows/opengame-generate.yml` immediately; otherwise the scheduled workflow polls queued jobs every five minutes.
- The workflow runs `scripts/run-github-opengame-job.ts`, installs OpenGame in the runner, generates the HTML5 game, and runs the same headless Chromium playability validator. The runner does not store production secrets; it calls Vercel `/api/github-worker/*` endpoints so MiniMax, Blob upload, and Prisma writes stay on Vercel.
- Existing Vercel Sandbox and E2B code remains as compatibility paths for future paid/provisioned runtimes.

## Data Flow

1. User confirms a game brief.
2. Vercel creates a `Job` with `QUEUED` status and stores prompt metadata.
3. Vercel dispatches the GitHub Actions workflow with `job_id`, or the scheduled workflow picks up the oldest queued GitHub job.
4. GitHub runner claims the job through Vercel, updates `Job.log` and `Job.status` through Vercel, and runs OpenGame.
5. The runner validates playability, posts generated files back to Vercel, and Vercel uploads to Blob, updates the `Game` to `READY`, and marks the job `DONE`.
6. The frontend keeps polling `/api/jobs/:id/progress`; it now reads database-backed progress for GitHub jobs.

## User Impact

- Generation becomes slower than an always-on sandbox because each job waits for a GitHub runner and cold-installs OpenGame.
- The UX remains the same: create, watch progress, then play from the detail page.
- For a 10-20 person internal MVP, GitHub Actions free minutes are a better fit than forcing a paid sandbox provider.

## Required Configuration

Vercel environment variables:

- `SANDBOX_PROVIDER=github`
- `GITHUB_DISPATCH_TOKEN` for immediate `workflow_dispatch`; without it the app can only wait for the scheduled poller. Use a fine-grained GitHub token when possible, limited to `zhang1590424-rgb/opengame-astrocade-mvp` with `Actions: Read and write`.
- `GITHUB_DISPATCH_REPO=zhang1590424-rgb/opengame-astrocade-mvp`
- `GITHUB_DISPATCH_WORKFLOW=opengame-generate.yml`
- `GITHUB_DISPATCH_REF=main`

GitHub repository variables:

- Optional: `APP_BASE_URL`
- Optional: `MINIMAX_TEXT_MODEL`
- Optional: `OPENGAME_GIT_URL`

## Validation

Local validation remains:

- `npx prisma generate`
- `npm run lint`
- `npm run build`

True smoke validation requires the workflow file to be pushed and the Vercel/GitHub secrets above to be configured, then creating one minimal game from the production UI.

## Production Status on 2026-05-10

Production alias:

- `https://opengame.zz-fancy.cloud`

Deployment and configuration:

- Vercel Production has `GITHUB_DISPATCH_TOKEN` configured as an encrypted environment variable.
- A production redeploy was completed after adding the variable, so Serverless Functions read the new value.
- New generation jobs now log `Queued GitHub Actions workflow opengame-generate.yml on zhang1590424-rgb/opengame-astrocade-mvp@main.` instead of the scheduled-worker fallback.

Real user flow smoke cases:

| Case | Game ID | GitHub run | Result |
| --- | --- | --- | --- |
| Stealth heist with rooms, patrol vision, keys, vault, timer | `cmozk14z00001l404p2rao5ac` | `25624918394` | `workflow_dispatch` succeeded; detail page READY; iframe canvas accepted click and keyboard input with 0 fatal browser errors |
| Alchemy chain reaction with 7x7 grid, element spread rules, recipe goals | `cmozk2e4c0007jo04b18m9brs` | `25624949459` | `workflow_dispatch` succeeded; automatic playable validation passed after longer OpenGame self-test; detail page READY; iframe canvas accepted clicks with 0 fatal browser errors |
| Boss bullet-hell with 3 phases, slow movement, shooting, boss HP | `cmozk4hbm000fjo04xlr72h8y` | `25624980275` | `workflow_dispatch` succeeded; detail page READY; iframe canvas accepted click and keyboard input with 0 fatal browser errors |

All three public works appeared in Gallery after publishing.
