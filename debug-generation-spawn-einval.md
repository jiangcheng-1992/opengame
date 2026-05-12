# Debug Session: generation-spawn-einval

Status: [OPEN]

## Symptom
- Generation job fails in the UI.
- Latest run status shows `spawn EINVAL`.
- Visible log: `Queued locally. A local GitHub-compatible worker is starting automatically and will claim this job.`

## Initial Hypotheses
1. Local GitHub-compatible worker starts a child process with an invalid command/path/argument on Windows, causing Node `spawn EINVAL`.
2. The worker invokes a Unix-only command or shell pattern that is invalid in PowerShell/Windows.
3. Required environment variables for OpenGame or worker runtime are missing/malformed, producing an invalid spawn configuration.
4. The generated job has a malformed workspace/path/source URL that becomes an invalid spawn cwd or file path.
5. A previous local worker/dev-server process is stale and is claiming jobs with outdated code or environment.

## Evidence Plan
- Inspect server logs around the failed job.
- Query the online database for the latest failed job metadata and logs without exposing secrets.
- Locate worker spawn sites and add instrumentation only if existing logs are insufficient.

## Evidence Collected
- Latest failed job `cmp1dflts000tpvbkxvudu0fv` has `status=FAILED`, `startedAt=null`, `errorMsg=spawn EINVAL`.
- The job log never moved past `Queued locally...`, so OpenGame was not started and the failure happened before worker claim.
- Minimal local reproduction: spawning `node_modules/.bin/tsx.cmd` directly on Windows throws `Error: spawn EINVAL`.
- Running `node node_modules/tsx/dist/cli.mjs --version` succeeds on the same machine.

## Confirmed Cause
- The local GitHub-compatible worker used the Windows `.cmd` shim as the direct `spawn` target. On this environment that throws `spawn EINVAL` synchronously.

## Fix Applied
- Use `process.execPath` plus `node_modules/tsx/dist/cli.mjs` on Windows to start the local worker without the `.cmd` shim.
- Add worker-level reliability retries so a failed OpenGame/playability attempt regenerates with a simpler playable-first prompt before marking the job failed.
- Use Git Bash on Windows when available because the default `bash` command resolves to the WSL stub, which fails when no Linux distribution is installed.

## Notes
- No business logic changes before evidence collection.
