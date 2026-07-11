# Bootstrap checklist (about thirty minutes, one time)

1. Claim the GitHub handle: create the `argelander` organization (verified free as of 2026-07-10), then `gh repo create argelander/argelander --public --source . --push` from this directory after `git init` and first commit.
2. Claim the npm names (npm reserves nothing without a publish). After `npm login`:
   `pnpm -r --filter argelander-core --filter argelander-leaflet --filter argelander-three --filter argelander publish --access public --no-git-checks`
   Each package is at 0.0.1 with a reserved-name README line; that is the placeholder.
3. Enable GitHub Pages: repository Settings, Pages, Source: GitHub Actions. The CI workflow deploys `apps/atlas` on every push to main.
4. Enforce DCO: install the DCO GitHub App on the repo (or a branch protection rule requiring the sign-off check). All commits use `git commit -s`.
5. Toolchain: Node 22 LTS (`.nvmrc` provided), `corepack enable` (pnpm version pinned in `package.json` packageManager field), Claude Code current. Project permissions for Claude Code are seeded in `.claude/settings.json`; tune to taste.
6. Pull the current Bessel StateProvider draft into `specs/SPEC-PROVIDER.md` section 3 (read-only reference). If the merge has not stabilized it, leave the stub and the pin to Bessel ADR; do not block Phase 0 on it.
7. First Claude Code session prompt: `Execute goals/PHASE-0.md`.
