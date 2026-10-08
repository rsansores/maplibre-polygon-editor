# Releasing

One artifact ships from this repo: the npm package **`maplibre-polygon-editor`** (the Vue
component, the framework-agnostic core and the stylesheet).

Publishing is automated by [`.github/workflows/release.yml`](.github/workflows/release.yml), which
uses **npm Trusted Publishing (OIDC)** with **staged publishing** — no npm token is stored in this
repo. The job runs in a protected environment and **waits for your approval**, then _stages_ the
version on npm; nobody can install it until you approve it there with 2FA. Third-party actions are pinned to
commit SHAs; Dependabot proposes updates.

---

## One-time setup

Do this once, before the first automated release.

### 1. Secure the account

Enable **2FA** on [npmjs.com](https://www.npmjs.com/settings/~/profile).

### 2. First publish — by hand (claims the name)

Trusted Publishing can only be attached to a package that already exists, so the very first
version is published manually from a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm test && pnpm build
npm login                    # your npm account (2FA)
npm version 0.1.0 --no-git-tag-version
npm publish --access public  # no --provenance here: it only works from CI (OIDC)
git checkout package.json    # the automated release bumps the version from now on
```

> `pnpm pack` shows exactly what would ship before you publish.

### 3. Register the Trusted Publisher

npm → the package → **Settings → Publishing access → Trusted Publisher → GitHub Actions**:

- Organization/user: `rsansores`
- Repository: `maplibre-polygon-editor`
- Workflow filename: `release.yml`
- Environment: `release`
- Permission: **staged publish only** (npm's recommendation). Plain `npm publish` from CI is refused
  with `403 OIDC permission denied for this action`.

Or from the CLI (npm ≥ 11.15, 2FA):

```bash
npm trust github maplibre-polygon-editor --file release.yml \
  --repository rsansores/maplibre-polygon-editor --environment release --allow-stage-publish
```

### 4. The protected `release` environment (the approval gate)

GitHub repo → **Settings → Environments → `release`** → **Required reviewers**: yourself. Every
release then pauses until you click **Approve**. (The environment is created with the repository;
check that the reviewer is set.)

---

## Cutting a release

1. Make sure `main` is green and holds everything you want to ship. Move the `Unreleased` notes in
   `CHANGELOG.md` under the new version.
2. GitHub → **Actions → Release → Run workflow** → enter the version (e.g. `0.2.0`) → **Run**.
   Tick **dry run** first if you want to see the tarball without publishing.
3. The `verify` job re-runs the full CI (format, lint, types, knip, unit and browser tests).
4. The `release` job asks for approval. **Approve** it.
5. CI sets the version, builds, stages it on npm with provenance, then commits `release: vX.Y.Z`,
   tags it and pushes both.
6. Publish the staged version, with 2FA:

   ```bash
   npm stage list maplibre-polygon-editor    # the staged version and its id
   npm stage approve <stage-id>              # now it is public
   ```

   `npm stage download <stage-id>` fetches the tarball first if you want to look inside. A version
   you reject (`npm stage reject <stage-id>`) is already tagged in git; release the fix as the next
   version.

## Notes

- **Versions are immutable.** npm un-publish is restricted after 72 h. Pick the version
  deliberately; while the API settles, stay on `0.x`.
- **git is updated last.** The version bump is committed only after npm staged the package, so a
  failed run leaves the repo clean and can simply be retried.
- **The bump commit is pushed to `main`.** If you protect `main` with required pull requests, allow
  GitHub Actions to bypass, or the push fails.
