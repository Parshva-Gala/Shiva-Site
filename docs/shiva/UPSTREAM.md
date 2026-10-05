# Applying upstream updates

SHIVA uses an independent append-only Drizzle migration journal in the same database. Its SQL and snapshots live under `packages/db/migrations/shiva`; Homarr retains its original migration history. A populated SQLite upgrade, repeat application and later synthetic upstream migration have been tested without changing SHIVA records. See [MIGRATIONS.md](MIGRATIONS.md) for the integration and dialect verification limits.

The starting point is Homarr `v2.1.2` / `473b6cb7c46a147886c41a9b1fabe36d10b6b854`. Keep SHIVA work in separate commits from upstream imports. Retain `LICENSE` and any upstream notices. The user authorized source maintenance in [Parshva-Gala/Shiva-Site](https://github.com/Parshva-Gala/Shiva-Site): push reviewed branches and open pull requests there. Repository publication does not deploy the application or authorize image publishing, public access or real provider writes.

Every inherited GitHub Actions job is guarded to `github.repository == 'homarr-labs/homarr'`, combined with its original condition. Keep these guards when merging upstream, including newly introduced jobs. Upstream release, Docker publishing, scheduled bots and deployment jobs stay inactive in the SHIVA repository. No SHIVA hosted CI or deployment workflow is enabled; the local checks in the verification guide remain the evidence. See [.github/SHIVA_AUTOMATION.md](../../.github/SHIVA_AUTOMATION.md).

The managed session's Git HTTPS upload was rejected even though connector API writes were authorized. Initial GitHub publication therefore uses a verified source-tree snapshot, retaining the exact base, license and notices rather than claiming the upstream commit ancestry was uploaded. The full upstream history is retained in the development workspace. After adding the `upstream` remote as described in step 3 below, and before the first future upstream merge in a fresh GitHub clone, establish ancestry to the **already incorporated** pinned base on a clean, backed-up update branch:

```powershell
git fetch upstream tag v2.1.2
git merge-base --is-ancestor 473b6cb7c46a147886c41a9b1fabe36d10b6b854 HEAD
# Only if the ancestor check returned a nonzero exit code:
git merge --strategy=ours --allow-unrelated-histories --no-edit 473b6cb7c46a147886c41a9b1fabe36d10b6b854
git diff 'HEAD^' HEAD --stat
```

That one-time merge acknowledges the existing base and must leave the source tree unchanged. Use it only for the exact pinned base; merge subsequent stable releases normally so their changes are incorporated. A normal authenticated Git push from your laptop can publish this ancestry later; this cloud session's transport was not certified. Keep update work on a review branch.

1. Back up the stopped application using [BACKUP.md](BACKUP.md), including `.env`. Commit only intended source changes; never credentials, records or uploaded wallpapers.
2. Review the next stable release's changelog, Node/pnpm requirements and migrations. Avoid switching to a development branch by default.
3. In a clean checkout, inspect `git remote -v`. Add `upstream` pointing to `https://github.com/homarr-labs/homarr.git` only if absent, then fetch its tags.
4. Create a local update branch and merge the chosen stable tag. Resolve small registration/provider/schema seams while keeping SHIVA files isolated. Do not replace upstream files wholesale.
5. Preserve both migration journals and the SHIVA custom-migration hook. Update `packages/db/schema/upstream` exports when upstream adds tables. Keep host generation separate from SHIVA generation as documented in [MIGRATIONS.md](MIGRATIONS.md). Never regenerate, renumber or edit applied migrations or use schema push as an upgrade shortcut.
6. Install from the reviewed lockfile and apply migrations to a **copy** of the database first. Re-run focused typechecks/lint, relevant tests and a production build. Check authentication, shopping CRUD/restart persistence, appearance/import/recovery, desktop and phone-width layouts.
7. Only after validation, migrate the real backed-up local database and start SHIVA. If rollback is necessary, restore both the old source version and the pre-upgrade database; downgrading source alone may be incompatible with the new schema.

The main recurring review points are Next.js route/provider integration, Mantine APIs, tRPC router registration, both database dialect schemas/migrations, and production service binding. Native `/shiva` routes share identity/query/theme providers but load Homarr's board-modals, Spotlight and assistant only when entering host routes. Preserve the host provider order and recheck real host discard dialogs after changing this boundary. Keep the `@homarr/ui/theme` subpath so theme imports do not eagerly load the component catalog. Preserve protected server initial-data reads and lightweight global loading/404 fallbacks; recheck actual pre-hydration Home HTML and cold request graphs, not only emitted chunk totals. The SHIVA wrapper deliberately avoids upstream POSIX shell syntax for Windows startup. New upstream bootstrap commands need review before replacing it.
