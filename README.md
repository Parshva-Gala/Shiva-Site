# SHIVA

A single-user personal dashboard extending **Homarr v2.1.2**, pinned to commit `473b6cb7c46a147886c41a9b1fabe36d10b6b854`. Homarr's Next.js/Mantine interface, authentication, tRPC API, Drizzle migrations, SQLite storage, and existing boards remain in place. SHIVA adds a dedicated `/shiva` application surface and native shopping records. See the [architecture decision](docs/shiva/ARCHITECTURE.md) and [milestone status](docs/shiva/PLAN.md).

Read the [professional product and engineering plan](docs/shiva/PRODUCT_PLAN.md) for workflows, feature scope, appearance, architecture, integrations, reliability and release gates. The first foundation is implemented; the [validation record](docs/shiva/PLAN.md) distinguishes executed checks from Windows, Android and long-session qualification still to be performed.

## Windows setup

This checkout was developed in Linux; these instructions target PowerShell on your Windows laptop. Your laptop's installed Node version has not been inspected.

Required: **Node.js 24.18.0 or newer**, **pnpm 11.15.1**, and **Docker Desktop using Linux containers** for Redis. Install a compatible Node release from [nodejs.org](https://nodejs.org/). This is the upstream application toolchain, not an assumption that any installed Node version works. Keep the checkout in a writable local folder, such as `C:\Projects\shiva`.

The foundation review branch is `shiva-foundation` in [your repository](https://github.com/Parshva-Gala/Shiva-Site). With Git installed, obtain it before running setup:

```powershell
git clone --branch shiva-foundation https://github.com/Parshva-Gala/Shiva-Site.git C:\Projects\shiva
Set-Location C:\Projects\shiva
```

Use this branch until its pull request is merged; the initial `main` branch preserves the guarded Homarr baseline. Source is public, but the application remains local and your data is not uploaded. Inherited upstream automation is inactive in this repository; see [maintenance](docs/shiva/UPSTREAM.md).

From PowerShell in the checkout root:

```powershell
node --version
npm install --global pnpm@11.15.1
pnpm --version
docker version
pnpm install --frozen-lockfile --child-concurrency=1
node scripts/shiva.mjs init
docker compose -f development/shiva.compose.yml up -d redis
pnpm db:migration:sqlite:run
node scripts/shiva.mjs build
node scripts/shiva.mjs start
```

Open **http://127.0.0.1:3000/shiva**. On first launch, finish Homarr's local account onboarding and sign in; use one account with a strong password. If redirected to onboarding or login, return to `/shiva` afterward. No demo login is enabled.

`init` creates `.env` once, generates two different secrets without printing them, and sets an absolute database path. It preserves an existing `.env` completely; an existing Homarr configuration needs the values shown in [shiva.config.example.env](shiva.config.example.env), especially a writable absolute `DB_URL`. Do not copy the placeholder example over a working configuration. Migration commands create/update Homarr tables and add SHIVA tables through the existing migration system.

The locked dependency installation includes upstream approved native build scripts and documentation type generation. If `better-sqlite3` or bcrypt cannot download a Windows prebuilt binary, installation may require Python and Visual Studio Build Tools; report the actual install error before changing toolchain or installing administrator-level prerequisites. Do not replace the lockfile or enable every dependency script to work around an error.

For subsequent starts:

```powershell
docker compose -f development/shiva.compose.yml up -d redis
node scripts/shiva.mjs start
```

After source changes, stop the running server with Ctrl+C, then rebuild and restart:

```powershell
node scripts/shiva.mjs build
node scripts/shiva.mjs start
```

For development with hot reload, use `node scripts/shiva.mjs dev` instead of `start`. Upstream development mode separates subscription/background services; the native foundation uses HTTP requests. When developing host subscriptions, run `pnpm --filter @homarr/websocket dev` in another terminal. Production startup embeds the existing services in the application process.

The wrapper avoids the upstream package's POSIX-only build command, supplies the upstream version, and binds Next.js to `127.0.0.1:3000`. Redis and the source-mode WebSocket server also bind to loopback. Use these commands rather than the upstream all-interface development compose file. The source production build uses Next.js's supported webpack backend and memory optimization because the default Turbopack build exceeded this Linux environment's 16 GB limit. It defaults to a build-only 6 GiB Node heap; an explicit existing heap option is preserved. Building uses substantially more memory than running, so close memory-heavy applications during a build. Build and runtime measurements are recorded separately in [VERIFICATION.md](docs/shiva/VERIFICATION.md); the Windows laptop still needs verification. No SHIVA container image has been published.

Stop SHIVA with Ctrl+C. Redis can remain running or be stopped with:

```powershell
docker compose -f development/shiva.compose.yml down
```

## Foundation scope

The milestone covers branded navigation, a clearly labelled sample Home screen, appearance presets and saved settings/layouts, and native Shopping CRUD. Home sample priorities and commitments are illustrative. ClickUp, calendar, Excel, Obsidian, email, WhatsApp, and Notion are not connected. Future modules show planned or not-configured states; they are not working integrations. No credentials are required to use the foundation, beyond local authentication secrets generated during setup.

Theme import accepts a validated `shiva-theme` version 1 appearance document. It contains no shopping records, authentication secrets, or connector credentials. Custom downloaded JavaScript and arbitrary theme CSS are unsupported. For theme recovery, open **http://127.0.0.1:3000/shiva/settings/appearance?safe=1** and reset the appearance.

Defaults disable analytics/external-connection features through Homarr's `NO_EXTERNAL_CONNECTION`, Docker/Kubernetes access, upstream demo seeding, mock integrations, and Next/Turbo telemetry. SHIVA's unconfigured modules do not fetch provider data. These settings are not a firewall; do not add real integrations without reviewing each connector's permissions and outbound behavior.

## Data and maintenance

Shopping records, appearance, saved presets/layouts, privacy preferences, and the Homarr local user live in **`data/db/db.sqlite`** by default. `.env` contains authentication/encryption secrets and the absolute database path. Redis is disposable cache/runtime infrastructure, not the authoritative store. Uploaded wallpapers are separate, owner-scoped files in `data/shiva/wallpapers` by default (or the configured `SHIVA_ASSET_DIR`); the database stores lightweight image references. Set `SHIVA_ASSET_DIR` in the local `.env` only when choosing a different persistent absolute directory, and back it up separately. Homarr's built-in ZIP backup includes the database, not these image files. See [backup and restore](docs/shiva/BACKUP.md).

The privacy control hides information in the interface. Authentication still protects access. This setup is available on the host laptop while the server and Redis are running; a sleeping laptop makes it unavailable. Android or remote access needs a separately reviewed private access/HTTPS setup. This milestone does not publish the app, open a public tunnel, or configure access from other devices.

Follow the [upstream update procedure](docs/shiva/UPSTREAM.md) before upgrading Homarr. Homarr is Apache-2.0; [LICENSE](LICENSE) and upstream notices remain intact. Gloation was inspected as a visual reference only; its code and artwork are not copied.

## Verification

Run the focused SHIVA checks and production build after changes. The milestone plan records validation status; a successful Next build does **not** substitute for typechecking because upstream config sets `ignoreBuildErrors: true`.

```powershell
pnpm --filter @homarr/validation typecheck
pnpm --filter @homarr/db typecheck
pnpm --filter @homarr/api typecheck
pnpm --filter @homarr/nextjs typecheck
node scripts/shiva.mjs build
```

Checks may also be run in Linux with the same commands. Actual executed checks and any upstream failures are recorded in [PLAN.md](docs/shiva/PLAN.md).

The Linux-only stability probe requires a running **isolated synthetic verification instance**, using `artifacts/verification.sqlite` and the private account created by `scripts/shiva/prepare-verification.ts`. It refuses the normal personal database, other origins and public listeners. Keep the private credentials/session files and reports under ignored `artifacts/`; do not publish them. After the isolated production server and local Redis are ready:

```bash
# Default: eight hours of navigation, dialogs and local preview/cancel cycles.
node scripts/shiva/verify-soak.mjs --isolated-verification
# Five-minute idle CPU/resource diagnostic, then a one-minute script smoke check.
node scripts/shiva/verify-soak.mjs --isolated-verification --minutes 5 --idle
node scripts/shiva/verify-soak.mjs --isolated-verification --minutes 1
```

`--allow-development` marks a diagnostic run when production is unavailable; it cannot qualify the production stability gate. The probe performs read-only API checks and cancels unsaved dialog/theme drafts. Its bounded private reports are in `artifacts/soak`. If Linux blocks access to Redis's process descriptors, the verifier accepts only the exact documented local Docker container after checking its image, compose identity, loopback binding, process identity and read-only Redis server metadata. The report identifies this attribution method and the unavailable Redis socket inspection; no elevation is required. Short runs do not establish eight-hour stability. Linux summed RSS and CPU measurements do not replace Windows/WSL overhead or actual Android measurements; browser process-tree RSS is reported separately from application services.
