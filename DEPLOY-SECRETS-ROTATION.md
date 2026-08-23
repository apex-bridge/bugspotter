# Rotating the API deploy secrets

**Status: done, 2026-08-11.** Path A, executed live and verified - see
"Verifying" below for what was actually tested rather than only planned.
Kept as the reference for the next time this key needs rotating.

**Correction, 2026-08-12:** a later hardening pass (merged in PR #323) added
`chown root:root` on `.ssh`/`authorized_keys`, citing general OpenSSH
guidance. Applying it to the live host broke authentication outright -
caught immediately by re-running the same benign-command check this doc
already prescribes, exactly why that check exists. Reverted on the host and
in this doc; see the notes under steps 2 and 5 below.

**Correction, 2026-08-22:** step 7's commands below were run with the
`--env production` flag exactly as written, but the actual 2026-08-11
execution set all four secrets at the **repository** level instead - not a
doc error, an execution one. Because `deploy-production` declares
`environment: production`, GitHub's own secret-precedence rules should have
made an environment-scoped secret win over a same-named repository one, but
no environment-scoped `DEPLOY_HOST`/`DEPLOY_USER`/`SSH_DEPLOY_KEY`/
`SSH_KNOWN_HOSTS` existed yet at that point (they were still the original
2026-04-09 Yandex-era values this doc's intro already flags as due for
rotation) - so the job kept reading those stale values instead. Every
`deploy-production` run from 2026-08-11 through 2026-08-22 timed out
connecting to that old, by-then-reassigned IP, misread as a netcup
network-edge flake and chased through several rounds of retry-logic
hardening (PRs #384, #385) before the actual cause surfaced. Fixed by
re-running step 7 at the correct scope with the same 2026-08-11 keypair
(still present locally) and deleting the stale repository-level secrets
entirely, so there is nothing left for a job to read by the wrong scope.
Verified end-to-end through Actions itself the same day - see the
"Verifying" section below, which previously only had a direct-SSH test to
point to.

`DEPLOY_HOST`, `DEPLOY_USER`, `SSH_DEPLOY_KEY`, `SSH_KNOWN_HOSTS` in
`apex-bridge/bugspotter` were set 2026-04-09, four months before the
2026-08-04 netcup migration. They hold Yandex-era values and will fail
cleanly (SSH auth/host-key failure) against the current host. Until
rotated, PR #323's `deploy-production` job cannot succeed - which is safe
to leave as-is, since that job only runs on `workflow_dispatch` with
`environment: production`, never on push.

Two ways to rotate. They produce a materially different security posture,
not just different secret values - read both before picking.

|                                  | Path A: dedicated deploy user (recommended)                                                                                                             | Path B: reuse the admin key                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup                            | New user, new keypair, a forced SSH command                                                                                                             | None - use what already exists                                                                                                              |
| A leaked `SSH_DEPLOY_KEY` grants | Exactly one operation: pull + redeploy `api`/`worker` from a validated GHCR image ref. Nothing else - not a shell, not other commands, not other hosts. | Full root on the production host                                                                                                            |
| Workflow change needed           | No - `deploy-api.yml` as committed in this PR already sends only the image ref (step 6 documents the shape it's already in)                             | Yes - revert the SSH step to run the full login/pull/tag/compose sequence inline; a bare image ref sent to an unrestricted shell just fails |
| Time                             | ~20 minutes                                                                                                                                             | ~2 minutes                                                                                                                                  |

**Why "add the deploy user to the `docker` group" alone is not real scoping**,
if you've seen this pattern before and are tempted to stop there: Docker group
membership lets you bind-mount the host root filesystem into a container and
`chroot` into it - it is root-equivalent by design, not a Docker bug. The
actual scoping in Path A comes from the SSH **forced command**, which makes
the key unable to run anything except one fixed, validated script -
regardless of what command the connecting client asks for. Docker-group
membership is still required (the script needs to run `docker`), but the key
itself can never be used to reach a shell.

---

## Path A: dedicated deploy user + forced command

### 1. Generate a new keypair (do not reuse `bugspotter-netcup`)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/bugspotter-ci-deploy -N "" -C "ci-deploy@bugspotter"
```

No passphrase - this key runs unattended in GitHub Actions.

### 2. Create the user on the host

```bash
ssh -i ~/.ssh/bugspotter-netcup root@159.195.212.239

useradd -m -s /bin/bash deploy
# NOT /usr/sbin/nologin: sshd invokes a forced command through the user's
# login shell (`<shell> -c "<command>"`). nologin just prints a message and
# exits, silently breaking every deploy - the forced-command restriction
# below is what actually limits this account, not the shell.
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
chown deploy:deploy /home/deploy/.ssh
```

**Do not `chown root:root` this directory**, despite it being a documented
hardening pattern in general OpenSSH guidance (StrictModes is supposed to
reject only group/world-writable auth files, not root ownership). Tried it
here on 2026-08-12 and it broke authentication outright - `ssh -vvv` showed
the client correctly offering the key, but sshd rejected it at the
`publickey` stage every time (`Authentications that can continue: publickey`
looping, never accepted), on this host's OpenSSH_10.0p2 (Debian 13). Reverting
to `deploy:deploy` fixed it immediately, reproduced twice. Whatever the exact
mechanism, treat the general guidance as wrong for this specific host until
proven otherwise - verify empirically, don't cite documentation for a claim
this easy to test. `ci-deploy.sh` itself staying `root:root` (below) is a
separate, unaffected mechanism - that regression was isolated specifically
to `.ssh`/`authorized_keys` ownership, not the script.

### 3. Write the forced-command script

`$SSH_ORIGINAL_COMMAND` is the only untrusted input that reaches this
script - the workflow will send an image ref as the "command"; validate it
strictly before it touches anything.

```bash
cat > /opt/bugspotter/scripts/ci-deploy.sh <<'SCRIPT'
#!/bin/sh
set -eu

IMAGE_REF="${SSH_ORIGINAL_COMMAND:-}"
case "$IMAGE_REF" in
  ghcr.io/apex-bridge/bugspotter/api:sha-*) ;;
  *) echo "rejected: not a recognized image ref" >&2; exit 1 ;;
esac
sha="${IMAGE_REF#ghcr.io/apex-bridge/bugspotter/api:sha-}"
case "$sha" in
  *[!0-9a-f]*|"") echo "rejected: malformed sha" >&2; exit 1 ;;
esac

# Same lock poll-deploy.sh uses - both paths retag the same
# bugspotter-api:latest and recreate the same containers, so they must not
# run concurrently. See RUNBOOK.md's "Interaction with path (2)".
exec 9>/opt/bugspotter/scripts/.poll-deploy.lock
flock -n 9 || { echo "rejected: poll-deploy.sh is mid-run, retry" >&2; exit 1; }

docker pull "$IMAGE_REF"
new_id=$(docker image inspect --format '{{.Id}}' "$IMAGE_REF")
old_id=$(docker image inspect --format '{{.Id}}' bugspotter-api:latest 2>/dev/null || true)
# Only back up an existing :latest, and only when it isn't already this same
# content - a retried run would otherwise clobber the real pre-<sha> rollback
# target with itself. No `|| true` on the tag itself: a genuine failure here
# should abort the deploy, not be silently swallowed.
if [ -n "$old_id" ] && [ "$new_id" != "$old_id" ]; then
  docker tag bugspotter-api:latest "bugspotter-api:pre-$sha"
fi
docker tag "$IMAGE_REF" bugspotter-api:latest
cd /opt/bugspotter
docker compose up -d --no-build api worker
SCRIPT

chmod 755 /opt/bugspotter/scripts/ci-deploy.sh
chown root:root /opt/bugspotter/scripts/ci-deploy.sh
# /opt/bugspotter/scripts/ is itself deploy-owned (poll-deploy.sh's cron job
# needs to create its own state/lock/log files there) - without the sticky
# bit, that directory-write access would let `deploy` delete and replace
# this root-owned script outright, regardless of the file's own permissions.
chmod +t /opt/bugspotter/scripts
```

### 4. Registry auth - not needed

Checked before assuming: `docker manifest inspect
ghcr.io/apex-bridge/bugspotter/api:sha-cb02c35` succeeded with zero
credentials. These packages are public, so `docker pull` in the script needs
no login and no PAT. If that ever changes (package made private), the
script needs a `docker login` added back, and something has to supply the
credential - a PAT cached via `docker login` as the `deploy` user is the
simplest option then.

### 5. Install the public key with the forced command

```bash
echo 'command="/opt/bugspotter/scripts/ci-deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA...<paste public key>... ci-deploy@bugspotter' \
  >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

`deploy:deploy`, not `root:root` - see the note under step 2. The forced
command is what actually restricts this key to one script; ownership here
only needs to satisfy StrictModes (not group/world-writable), which
`deploy:deploy` at these permissions already does.

### 6. Workflow step (already matches Path A, shown for reference)

`deploy-api.yml`'s SSH step, as committed in this PR, already sends only the
image ref - a forced command ignores whatever it's sent and always runs the
script above instead, so there's nothing left to simplify:

```yaml
- name: Deploy to production host
  env:
    IMAGE_REF: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:sha-${{ github.sha }}
    DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
    DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
  run: |
    install -m 600 /dev/null "$RUNNER_TEMP/deploy_key"
    printf '%s\n' "${{ secrets.SSH_DEPLOY_KEY }}" > "$RUNNER_TEMP/deploy_key"
    install -m 600 /dev/null "$RUNNER_TEMP/known_hosts"
    printf '%s\n' "${{ secrets.SSH_KNOWN_HOSTS }}" > "$RUNNER_TEMP/known_hosts"

    ssh -i "$RUNNER_TEMP/deploy_key" -o UserKnownHostsFile="$RUNNER_TEMP/known_hosts" \
      "$DEPLOY_USER@$DEPLOY_HOST" "$IMAGE_REF"
```

### 7. Set the secrets

```bash
gh secret set DEPLOY_HOST --repo apex-bridge/bugspotter --env production --body "159.195.212.239"
gh secret set DEPLOY_USER --repo apex-bridge/bugspotter --env production --body "deploy"
gh secret set SSH_DEPLOY_KEY --repo apex-bridge/bugspotter --env production --body "$(cat ~/.ssh/bugspotter-ci-deploy)"
# ssh-keyscan collects whatever key the host presents - it does not verify
# it. Before trusting the output, compare its fingerprint
# (ssh-keygen -lf <(ssh-keyscan -t ed25519 159.195.212.239)) against netcup's
# console or another trusted channel, not just what came back over this
# connection.
gh secret set SSH_KNOWN_HOSTS --repo apex-bridge/bugspotter --env production --body "$(ssh-keyscan -t ed25519 159.195.212.239 2>/dev/null)"
```

(Windows git-bash: always `--body "$VAR"`, never pipe to stdin - a pipe
silently corrupts multi-line values.)

`--env production` scopes these to the `production` environment `deploy-api.yml`
declares on the `deploy-production` job - without it, `gh secret set` creates
repository-level secrets that any workflow in the repo can read via
`secrets.<NAME>`, regardless of environment gating.

---

## Path B: reuse the existing admin key

No new user, no script - but not a drop-in with the workflow as currently
committed either. `deploy-api.yml`'s SSH step now sends only the bare image
ref (Path A's forced-command contract, see step 6 above); a plain,
unrestricted SSH session doesn't interpret that specially and just fails
trying to execute it as a command. Using Path B requires reverting that step
to run the full `docker login`/`pull`/`tag`/`compose up` sequence inline -
the shape it had before Path A's scoping replaced it - not "works as-is."

```bash
gh secret set DEPLOY_HOST --repo apex-bridge/bugspotter --env production --body "159.195.212.239"
gh secret set DEPLOY_USER --repo apex-bridge/bugspotter --env production --body "root"
gh secret set SSH_DEPLOY_KEY --repo apex-bridge/bugspotter --env production --body "$(cat ~/.ssh/bugspotter-netcup)"
# ssh-keyscan collects whatever key the host presents - it does not verify
# it. Compare the fingerprint against netcup's console or another trusted
# channel before trusting this.
gh secret set SSH_KNOWN_HOSTS --repo apex-bridge/bugspotter --env production --body "$(ssh-keyscan -t ed25519 159.195.212.239 2>/dev/null)"
```

Accept this only with the tradeoff in the table above in mind: any workflow
run with access to these secrets - and any compromise of the secret itself -
now has unrestricted root on the box serving production traffic.

---

## Verifying, either path

There is no staging environment to rehearse against (see PR #323's
"no staging" note) - the first real trigger of this step **is** a
production deploy. Reduce first-run risk by dispatching against a commit
that's already running, so a failure means "the step doesn't work," not
"bad code just shipped":

Without `--ref`, `gh workflow run` uses the default branch (`main`), which
can be ahead of what's actually live - pin it to the commit currently
serving production so a "just verify the step works" run can't
accidentally deploy newer, unreviewed code:

```bash
gh workflow run deploy-api.yml --repo apex-bridge/bugspotter \
  --ref <commit-or-tag-currently-serving-production> \
  -f environment=production
gh run watch --repo apex-bridge/bugspotter
curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' https://app.kz.bugspotter.io/ready
```

**What was actually verified for Path A (2026-08-11):** before wiring the
workflow secrets at all, the forced command was tested directly over SSH
with the new key - first a benign arbitrary command
(`ssh -i ~/.ssh/bugspotter-ci-deploy deploy@159.195.212.239 "echo test"`),
which correctly printed `rejected: not a recognized image ref` instead of
running it, proving the key cannot escape the script. Then a real deploy
against `ghcr.io/apex-bridge/bugspotter/api:sha-cb02c35` - the commit
already running - which pulled, tagged, recreated `api` + `worker`, and
returned exit 0 with both containers healthy. `curl /ready` confirmed 200
externally. Only after that did the four GitHub secrets get set.

**Closed the loop, 2026-08-22:** the `gh workflow run` trigger above was
finally exercised for real once the secrets were fixed at the correct scope
(see the correction above) - `deploy-production` ran end-to-end through
Actions, and both `app.kz.bugspotter.io/ready` and
`api.kz.bugspotter.io/ready` returned 200 externally afterward.

Rollback needs the **admin key** (`~/.ssh/bugspotter-netcup`, `root@...`),
not the Path A deploy key - `ci-deploy.sh`'s forced command only accepts a
validated `sha-<hex>` image ref as `$SSH_ORIGINAL_COMMAND`, so this
multi-line command would be rejected outright over the restricted key.
Otherwise the same re-tag-and-recreate as `RUNBOOK.md`, with `set -e` added
so a failed `docker tag` (no such rollback tag, typo'd sha, etc.) stops the
command instead of silently falling through to a `compose up` that
"succeeds" without having restored anything:

```bash
ssh -i ~/.ssh/bugspotter-netcup root@159.195.212.239 "
  set -e
  docker tag bugspotter-api:pre-<sha> bugspotter-api:latest
  cd /opt/bugspotter && docker compose up -d --no-build api worker
"
```
