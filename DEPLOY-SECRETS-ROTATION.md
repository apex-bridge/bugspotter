# Rotating the API deploy secrets

**Status: done, 2026-08-11.** Path A, executed live and verified - see
"Verifying" below for what was actually tested rather than only planned.
Kept as the reference for the next time this key needs rotating.

`DEPLOY_HOST`, `DEPLOY_USER`, `SSH_DEPLOY_KEY`, `SSH_KNOWN_HOSTS` in
`apex-bridge/bugspotter` were set 2026-04-09, four months before the
2026-08-04 netcup migration. They hold Yandex-era values and will fail
cleanly (SSH auth/host-key failure) against the current host. Until
rotated, PR #323's `deploy-production` job cannot succeed - which is safe
to leave as-is, since that job only runs on `workflow_dispatch` with
`environment: production`, never on push.

Two ways to rotate. They produce a materially different security posture,
not just different secret values - read both before picking.

|                                  | Path A: dedicated deploy user (recommended)                                                                                                             | Path B: reuse the admin key                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Setup                            | New user, new keypair, a forced SSH command                                                                                                             | None - use what already exists                         |
| A leaked `SSH_DEPLOY_KEY` grants | Exactly one operation: pull + redeploy `api`/`worker` from a validated GHCR image ref. Nothing else - not a shell, not other commands, not other hosts. | Full root on the production host                       |
| Workflow change needed           | Yes - simplify `deploy-api.yml`'s SSH step (shown below)                                                                                                | No - the step already committed in PR #323 works as-is |
| Time                             | ~20 minutes                                                                                                                                             | ~2 minutes                                             |

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

docker pull "$IMAGE_REF"
docker tag bugspotter-api:latest "bugspotter-api:pre-$sha" 2>/dev/null || true
docker tag "$IMAGE_REF" bugspotter-api:latest
cd /opt/bugspotter
docker compose up -d --no-build api worker
SCRIPT

chmod +x /opt/bugspotter/scripts/ci-deploy.sh
chown deploy:deploy /opt/bugspotter/scripts/ci-deploy.sh
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
```

### 6. Simplify the workflow step (Path A only)

`deploy-api.yml`'s SSH step currently sends the whole deploy sequence as the
command - a forced command ignores that and always runs the script above
instead, so the step only needs to send the image ref:

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
gh secret set DEPLOY_HOST --repo apex-bridge/bugspotter --body "159.195.212.239"
gh secret set DEPLOY_USER --repo apex-bridge/bugspotter --body "deploy"
gh secret set SSH_DEPLOY_KEY --repo apex-bridge/bugspotter --body "$(cat ~/.ssh/bugspotter-ci-deploy)"
gh secret set SSH_KNOWN_HOSTS --repo apex-bridge/bugspotter --body "$(ssh-keyscan -t ed25519 159.195.212.239 2>/dev/null)"
```

(Windows git-bash: always `--body "$VAR"`, never pipe to stdin - a pipe
silently corrupts multi-line values.)

---

## Path B: reuse the existing admin key

No new user, no script, no workflow change - the SSH step already
committed in PR #323 runs `docker login`/`pull`/`tag`/`compose up` directly
as whatever user these secrets name.

```bash
gh secret set DEPLOY_HOST --repo apex-bridge/bugspotter --body "159.195.212.239"
gh secret set DEPLOY_USER --repo apex-bridge/bugspotter --body "root"
gh secret set SSH_DEPLOY_KEY --repo apex-bridge/bugspotter --body "$(cat ~/.ssh/bugspotter-netcup)"
gh secret set SSH_KNOWN_HOSTS --repo apex-bridge/bugspotter --body "$(ssh-keyscan -t ed25519 159.195.212.239 2>/dev/null)"
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

```bash
gh workflow run deploy-api.yml --repo apex-bridge/bugspotter -f environment=production
gh run watch --repo apex-bridge/bugspotter
curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://app.kz.bugspotter.io/ready
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
externally. Only after that did the four GitHub secrets get set. The
`gh workflow run` trigger above was not yet exercised as of this writing -
that's the one remaining step to close the loop end-to-end through Actions
itself rather than a direct SSH test.

Rollback is the same either way - re-tag and recreate, per `RUNBOOK.md`:

```bash
ssh -i <key> <user>@159.195.212.239 "
  docker tag bugspotter-api:pre-<sha> bugspotter-api:latest
  cd /opt/bugspotter && docker compose up -d --no-build api worker
"
```
