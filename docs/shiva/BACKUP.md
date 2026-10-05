# Backup and restore

The default authoritative database is `data/db/db.sqlite`; an existing installation may instead use the absolute `DB_URL` in `.env`. SQLite holds the Homarr account and SHIVA shopping/settings/layouts/presets. Uploaded appearance wallpapers are separate files in `data/shiva/wallpapers` for the default database location, scoped to the authenticated owner. Redis is disposable and does not need backup. Theme export is a portable appearance-only preset, not a complete application backup.

`SHIVA_ASSET_DIR` can override the wallpaper directory with an absolute local path. Its default for SQLite is `<database parent>/../shiva/wallpapers`; for non-SQLite or in-memory databases it is `<server working directory>/data/shiva/wallpapers`. Set it explicitly to a persistent mounted directory in containers or PostgreSQL deployments (for example `/appdata/shiva/wallpapers`). Back up that directory separately when it is outside `data`; Homarr's database-only export does not include wallpaper files. Restore it alongside the database before starting SHIVA. Keep the owner subdirectories and filenames intact so restored database references continue to resolve. Both Drizzle migration journals are already inside the database and must remain there; see [MIGRATIONS.md](MIGRATIONS.md). Uploaded still PNG/JPEG/WebP images are decoded, stripped of metadata and optimized as WebP up to 2560 pixels per side; original files are not retained.

**Back up:** Stop SHIVA with Ctrl+C before copying. In PowerShell from the checkout root, for the default setup:

```powershell
$backup = Join-Path $env:USERPROFILE ("SHIVA-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backup
Copy-Item -Recurse .\data (Join-Path $backup "data")
Copy-Item .\.env (Join-Path $backup ".env")
git rev-parse HEAD | Set-Content (Join-Path $backup "source-commit.txt")
```

Copy the entire data directory so any SQLite sidecar files and default wallpaper assets stay together. If `DB_URL` points elsewhere, back up that stopped database, its sidecars and the corresponding wallpaper directory instead. Record any uncommitted source changes separately. Store the backup privately: it includes account information, personal data, and secrets. Losing `SECRET_ENCRYPTION_KEY` can prevent recovery of encrypted connector credentials; do not rotate it casually. Never attach `.env` to an issue or import it as a theme.

Record the committed SHIVA source version from [Parshva-Gala/Shiva-Site](https://github.com/Parshva-Gala/Shiva-Site), rather than only the upstream Homarr base. Preserve any modified and untracked source separately before recording the commit ID. A fresh checkout of the upstream commit alone does not restore SHIVA. Dependency folders (`node_modules`), build output (`.next`) and synthetic verification artifacts can be recreated and need not be included in a source backup. GitHub stores source only; your database, `.env` and wallpapers require the private backup above.

**Restore:** Stop SHIVA, preserve the current `.env` and data directory as a separate backup, and restore the matching source version and backed-up files. Keep the same `SECRET_ENCRYPTION_KEY`. If the checkout or storage moved, update `DB_URL` and any explicit `SHIVA_ASSET_DIR` to the corresponding restored absolute locations; do not let the app create a fresh database at the old path. Reinstall the committed dependencies, start Redis, and run the normal migration command only when intentionally upgrading the restored version. Start SHIVA and verify the local login, Shopping records and appearance.

Restore into a separate local checkout first when possible. Never overwrite the only good backup or run reset/delete operations as a recovery method.
