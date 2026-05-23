# Releasing GitBar

Maintainer-only checklist for cutting a versioned release. The
`release.yml` GitHub Actions workflow handles the build; this doc
covers the human steps around it.

## Prerequisites (one-time)

1. **Add the updater signing secret to GitHub.** The minisign keypair
   lives locally at `.secrets/tauri-updater.key` (gitignored, mode
   `0600`). The matching public half is committed in
   `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
   - Settings → Secrets and variables → Actions → New repository secret.
   - Name: `TAURI_SIGNING_PRIVATE_KEY`.
   - Value: paste the entire contents of `.secrets/tauri-updater.key`.
   - Optionally: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the local key has
     no password, so leave empty or skip).
2. **Confirm the local key permissions** are `600`:
   ```sh
   stat -f '%Lp' .secrets/tauri-updater.key
   ```
   The `install-local.sh` script refuses to use a key with looser perms.

## Cutting a release

1. **Bump the version in three places** to the same `X.Y.Z`:
   - `package.json`: `"version": "X.Y.Z"`
   - `src-tauri/Cargo.toml`: `version = "X.Y.Z"`
   - `src-tauri/tauri.conf.json`: `"version": "X.Y.Z"`

2. **Verify locally** that everything builds and tests pass on a clean
   checkout:
   ```sh
   npm ci
   npm run build
   npm test -- --run
   npm run test:rust
   ```

3. **Smoke-test the bundle** with `npm run install:local`, confirm the
   app launches and behaves sanely against your real GitHub PRs.

4. **Tag and push**. The workflow fires on `v*` tag push.
   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

5. **Wait for the workflow** (~10 minutes for a universal-darwin build).
   Watch it from the Actions tab. On success it creates a **draft**
   GitHub release with the DMG, the signed `.app.tar.gz`, and
   `latest.json` attached.

6. **Publish the draft.** This step is load-bearing for auto-update.
   The updater endpoint resolves through
   `https://github.com/pravton/gitbar/releases/latest/download/latest.json`,
   which redirects to the most recent **non-draft, non-prerelease**
   release. If you forget to publish, every existing install on the
   previous version will get 404s on its updater check.
   - Releases page → click the draft → Edit → Publish release.

7. **Verify the updater endpoint resolves.**
   ```sh
   curl -sI https://github.com/pravton/gitbar/releases/latest/download/latest.json | head -1
   ```
   Should respond with `HTTP/2 302` (then 200 after the redirect). If
   you see 404, the draft is still unpublished.

8. **Smoke-test the auto-update path** from an installed older version,
   if you have one available. The in-app banner should surface within
   minutes; clicking "Restart to install" should download, verify the
   signature, and relaunch into the new version.

## Rolling back

If a release is broken, **delete or unpublish the GitHub release**
immediately. The updater endpoint will then resolve to the previous
published release, and clients still on the older version won't be
prompted to upgrade. Already-upgraded clients will need a manual
reinstall of the prior version.

## Rotating the signing key

Only do this if the private key is compromised. Rotation forces every
existing install to reinstall manually (a key change means new
releases won't verify against the old embedded pubkey).

```sh
npx tauri signer generate -p "" -w .secrets/tauri-updater.key --ci -f
chmod 600 .secrets/tauri-updater.key
```

Then:
1. Copy the new `.secrets/tauri-updater.key.pub` contents into
   `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
2. Update the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret with the new
   private key.
3. Ship a release that contains the new pubkey **and** tell users to
   reinstall manually (the auto-updater path is broken until they do).

## Known limitations

- **No Apple Developer ID code-signing / notarization.** macOS Gatekeeper
  warns on first launch. The workaround (right-click → Open → Open
  again) is documented in the README. Adding a Developer cert is a
  separate workstream and not gating v0.1.0.
- **Universal-darwin only.** The workflow builds for both Apple Silicon
  and Intel into one DMG. Linux and Windows are out of scope.
