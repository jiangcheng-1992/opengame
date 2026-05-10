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
- Optional: `GITHUB_DISPATCH_TOKEN`
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
