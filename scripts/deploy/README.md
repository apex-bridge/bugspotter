# Production deploy scripts

Runs on the netcup production host only, not in CI. Checked in here so
changes are reviewable; the host's copy is not automatically kept in sync -
after editing, copy the updated file to `/opt/bugspotter/scripts/` by hand
and verify it there (`sh -n poll-deploy.sh`, then a manual run) before
trusting cron with it. `git log` on this file is the source of truth for
what _should_ be running; it is not a guarantee of what _is_.

## `poll-deploy.sh`

Cron job (`deploy` user's crontab, `*/3 * * * *`) that pulls
`ghcr.io/apex-bridge/bugspotter/{api,admin}:main`, redeploys whichever image
has a new digest, and health-checks before recording success. `api` and
`admin` deploy independently - see the script's own header comment for why.

State (`/opt/bugspotter/scripts/.last-deployed-digest*`) and the log
(`.poll-deploy.log`) live on the host only, not here - they're per-host
state, not source.

## `ci-deploy.sh` (not yet checked in)

The SSH forced-command target for `deploy-api.yml`'s on-demand
`workflow_dispatch` production deploy path. Only accepts
`ghcr.io/apex-bridge/bugspotter/api:sha-*` - `admin` has no equivalent
on-demand path yet (see issue #341's "Suggested fix" for the two ways to
close that: extend this on-demand path to admin too, or lean entirely on
`poll-deploy.sh`'s ~3-minute cadence, which is what this fix does for now).
