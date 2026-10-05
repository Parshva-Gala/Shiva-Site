# Foundation verification

Recorded **5 October 2026**, using Homarr v2.1.2 at `473b6cb7c46a147886c41a9b1fabe36d10b6b854` with the SHIVA foundation changes. Production probes use a separate synthetic account/database and private wallpaper directory under ignored `artifacts/`. The normal personal database and real provider accounts are not used. Raw reports and screenshots stay private.

## Environment and method

- Linux x64, Node 24.19.0, pnpm 11.19.0, Chromium 151.0.7922.173 and Docker 28.4.
- AMD EPYC 9V74 host; container allocation is four CPU cores and **16 GiB** memory. This is not the user's Windows laptop.
- Production `next start` through `node scripts/shiva.mjs start`, explicitly bound to `127.0.0.1:3000`; Redis 8.2.2-alpine from the documented compose file, also loopback only.
- Authenticated host account, synthetic SQLite database and separate asset directory. No live provider credentials.
- API latencies include authentication, database work and response decoding over localhost, excluding internet/provider latency. Browser automation overhead is identified where measured. Field INP is not inferred from automation.

## Executed correctness checks

Relevant validation, database, core, API, UI and Next.js typechecks passed. Scoped SHIVA lint and formatting passed; touched upstream files retain pre-existing import and ARIA-role warnings. A frozen-lockfile dependency installation was checked. **93 focused tests across 18 files passed** on the final source (two workers). They cover owner isolation, strict inputs/imports, settings conflicts/corruption, SQLite migration/reopen, independent journals, image authorization/quotas, URL handling, arbitrary-color/wallpaper readability, Mantine's actual contrast selection, source-mode onboarding privacy/branding, session changes, native/host provider boundaries and authenticated server initial-data reads. Final Next/API/UI typechecks were repeated after these patches.

The final production webpack build passed at **13:09:20 IST**, in **117.991 seconds**. Peak sampled descendant RSS was **9.55 GiB**; shared pages may be counted more than once, and this is a build resource proxy. Earlier attempts exposed three issues, now addressed: default Turbopack exceeded the 16 GiB lab limit; webpack caught an inherited unscoped CSS-module selector; a 4 GiB webpack heap was insufficient. The source wrapper uses supported webpack memory optimization and a build-only 6 GiB heap. The inherited optional `ssh2` native-accelerator warning remains, with a JavaScript fallback. The lab's pnpm 11.19 hoisted installation also emits a non-blocking global-virtual-store setting warning under build CI mode; frozen dependencies resolve and the pinned Windows instructions use pnpm 11.15.1. Build and daily runtime resources are measured separately.

Final-build browser verification passed **18 workflow checks** at desktop 1440×1000 and narrow 390×844 sizes. It exercised real host sign-in, all navigation destinations, labelled Home samples, three presets, preview/cancel/save/reload, validated import/export/reset, Shopping validation/create/edit/confirm-delete, saved layouts/privacy, narrow drawer focus/Escape and modal scrolling. It uploaded an actual bitmap, verified persistence, portable bitmap export/import, protected in-use deletion and confirmed unused-asset removal. There were **zero browser exceptions, console errors or external-origin requests**, including sign-in. Screenshots were captured and inspected.

The preceding privacy-complete build separately passed **five fresh-install checks**, starting with an empty-user SQLite copy: claim, actual administrator creation through the host UI, all setup-wizard sections, Home/empty Shopping, and sign-out/sign-in. Analytics was initially off; the actual capability RPC returned Workshop and Kubernetes disabled. This complete fresh flow recorded **zero external browser requests, console errors or runtime exceptions**. Origin-only server global-fetch instrumentation recorded zero fetch calls during the exercised first-run path; this is not a claim of a full packet capture. The original verification database hash stayed unchanged. First-run testing found and fixed inherited automatic Workshop probing, welcome/catalog artwork requests and the analytics-on default in local source mode; normal upstream mode and intentional links remain available.

Final-build **four read-only server-rendering checks** confirmed useful Home content, the authenticated owner’s actual Shopping summary, the Kolkata date, saved appearance/layout and privacy masking in rendered HTML before browser hydration. System light/dark and narrow/reduced media previews were canceled without persistent changes. Together with the host, full smoke and restart phases, the final build passed **32 checks** with zero browser exceptions, console errors or external requests. The on-demand layout editor was exercised with keyboard reorder, full-width resizing, preview/cancel without a settings write, save and reload.

The final optimized build separately passed **five host/native transition checks**: native Home to retained administration, an unsaved host settings draft, host Boards navigation with the real Homarr discard dialog, cancel, discard without saving, and return to native Shopping with working focus/cancel. These checks produced zero host writes, external requests or runtime/console errors.

Production-server restarts passed **five persistence checks**, preserving Shopping edits, appearance, presets, privacy and layouts. Multiple actual process-restart cycles were exercised, including the final frozen build. Reordered cards and their saved full-width geometry also survived restart and appeared in authenticated server-rendered HTML. Synthetic Shopping fixtures were then deleted. A controlled SQLite online-backup/restore-copy check passed: integrity, one settings row, one Shopping record, one owned/referenced image, both migration journals and file hashes survived two restored database opens. This proves the exercised copy/asset path; it does not claim a personal Windows restore or restored-application sign-in.

Computed checks confirmed readable default surface/control text in Graphite, Ivory and Midnight Glass; the lowest sampled default text/background contrast was **5.81:1**. Production contrast audits, before the unchanged theme code was included in the final loading optimization, also used an actual white uploaded bitmap in dark, light and system-light modes, sampling a rendered background pixel: captions remained at least **5.406:1**, headings at least **9.982:1**. Requested 20% dimming was increased by the readability guard to 82.5% dark/90% light. Two intentionally difficult gray/black/white palettes had protected surfaces at least **4.542:1**, input outlines at least **4.623:1**, and filled-button labels at rest/hover of **5.317/5.768** and **4.623/5.102**. Both contrast audits passed, preserved saved settings, removed only their unused test asset and recorded no external requests or runtime errors. These samples validate the exercised cases, not every possible future combination.

## Realistic-data performance

`scripts/shiva/verify-performance.mjs --isolated-verification` completed against production with 200 and then **2,000 synthetic Shopping records**. Read flows used five warm-ups and 50 measured requests each. Updates used **1,000 sequential acknowledged operations**, with zero failures. These API measurements precede the final appearance-only safeguards; measured backend code is unchanged.

| Flow at 2,000 records                 | Measured result                                               |
| ------------------------------------- | ------------------------------------------------------------- |
| Paginated list, 30 items              | p95 8.022 ms; decoded response 11,669 bytes                   |
| Filtered list                         | p95 6.421 ms                                                  |
| Summary                               | p95 6.482 ms; decoded response 161 bytes                      |
| Single-record detail                  | p95 4.416 ms                                                  |
| 1,000 durable updates                 | p95 7.334 ms; p99 10.583 ms; maximum 19.817 ms; zero failures |
| 66 uncached Shopping page activations | p50 121.054 ms; p95 175.831 ms; maximum 183.848 ms            |

The browser probe rendered 30 rows on page one and 20 on page 67; desktop and narrow layouts had no horizontal overflow. Its single first-useful-content measurement was 1,429 ms, **not** an LCP distribution. Pagination includes automation actionability/render waits and is not field INP. There were no external-origin requests, browser exceptions or console errors. Cleanup removed only the probe's records, left zero of them behind and preserved the settings document byte-for-byte (1,656 bytes). Ordinary settings remain below the 50 KiB budget, and image bytes stay out of routine mutations.

Final-build production HTTP readiness was sampled at **2,727 ms** after Redis was ready (one run).

## Cold loading and interaction performance

The final frozen production build completed ten independent authenticated cold desktop loads and ten constrained mobile loads. Each used a new browser context with Chromium's HTTP cache disabled. The mobile approximation used a 390×844 viewport, 4× CPU slowdown, 4 Mbps download, 1 Mbps upload, 150 ms latency and reduced effects. It is a defined Chromium simulation, not an Android device result.

| Measurement                                     | Before loading optimization | Final build                                 |
| ----------------------------------------------- | --------------------------- | ------------------------------------------- |
| Desktop LCP, p50 / p75 / p95                    | 860 / 916 / 1,080 ms        | **280 / 304 / 328 ms**                      |
| Constrained mobile LCP, p50 / p75 / p95         | 4,192 / 4,248 / 4,392 ms    | **1,060 / 1,076 / 1,084 ms**                |
| Whole Home JavaScript encoded transfer          | 1,042,584 bytes             | **499,780 bytes**, below the 500 KiB budget |
| Cached navigation feedback, p95                 | 152.6 ms                    | **142.3 ms**                                |
| Shopping dialog opening / closing feedback, p95 | 369.7 / 338.2 ms            | **87.4 / 76.7 ms**                          |
| Theme preview feedback, p95                     | 66.4 ms                     | **67.0 ms**                                 |

The before/after runs use the same collector. The earlier column is SHIVA before these optimizations, not unmodified Homarr. Home transferred approximately **52% less JavaScript** after optional host providers, the layout editor and unrelated fallback dependencies were removed from its initial request graph. Protected server reads provide useful Home content before hydration; native dialogs no longer stack a blur transition. CLS was **0** in all twenty final cold loads. Encoded transfer is Chromium CDP's `Network.loadingFinished.encodedDataLength`, including transfer overhead; it is not a claim that every script's decoded size is below 500 KiB.

Interaction sampling included 50 Home→Shopping→Appearance→Home cycles (150 link activations), 50 dialog opens/closes and 50 theme previews. Feedback is measured from the browser's capture-phase click to the visible destination/dialog/theme change, followed by two animation frames. It is a lab responsiveness proxy, not field INP. All samples and outliers were retained: one of fifty theme previews took **166.7 ms**, exceeding the 100 ms feedback target despite the passing p95. Dialog opening/closing maxima were 94.9/97.2 ms. There were zero failed samples, exceptions, console errors, external requests or blocked write attempts. No records or saved settings changed.

Some cold-load traces contain main-thread tasks longer than 50 ms, especially under 4× CPU slowdown; this loading benchmark does not certify sustained smoothness or physical-device interaction performance. Actual Android traces and field INP remain release qualification work.

## Short resource and stability observations

The final production application completed a **five-minute idle diagnostic**: 20 resource samples, 20 successful readiness checks and 44 successful protected API reads. Application plus Redis peak summed RSS was **335.31 MiB**. Mean application-services CPU was **0.1301%**, with a maximum 15-second sample of **0.3321%**, normalized to the four-core allocation. There were zero browser/console errors, attempted mutations, external browser attempts or observed application external TCP connections. Saved settings and Shopping counters stayed unchanged.

RSS comes from Linux `/proc` process attribution, with shared-page double counting possible. Redis runs as a different UID: its descriptor/executable links were unavailable, so the verifier instead checked the exact documented Docker container, image, compose identity, process/namespace PID and sole loopback port binding, plus read-only Redis server metadata. Readable process statistics supplied its RSS/CPU. Ten negative metadata cases were rejected before monitoring. Node/browser identity guards remain unchanged. Application socket snapshots remain active; Redis-owned sockets could not be inspected, and snapshots are not a packet capture.

The separate **one-minute interaction diagnostic** completed one Shopping dialog/edit/cancel → Appearance preview/cancel → Home cycle, four resource samples, four readiness checks and twelve protected API reads. Application plus Redis peak summed RSS was **353.47 MiB**; normalized mean/max sampled CPU was **0.1271% / 0.1493%**. Settings and Shopping digests remained unchanged, with zero attempted mutations, external browser attempts, observed application external TCP connections or browser/console errors. No Shopping fixtures remained.

Chromium's **whole-process-tree summed RSS peaked at 713.66 MiB idle and 830.60 MiB during the interaction diagnostic**. This includes browser processes and can double-count shared pages; it does not establish tab memory. The 350/500 MB tab-memory targets remain unqualified. Docker daemon/VM and Windows/WSL overhead are also outside these application-service figures.

Three incomplete interaction reports were retained and diagnosed as stability-script selector errors: a required-field marker changed exact label text, Appearance is a semantic H2 under Settings, and the brand/Home links share an href. The script now uses the verified accessible textbox name, route-specific heading levels and the intended navigation link. Targeted read-only checks confirmed each cause before the successful repeat; application source and the frozen production build were unchanged. These short diagnostics pass their exercised checks, but neither establishes the required eight-hour session or long-term memory stability.

## Remaining qualification

- Actual Windows installation/build/runtime, including Docker Desktop/WSL overhead and native dependency availability.
- Actual Android browser and approved access path. Narrow viewports and emulated network/CPU do not establish device performance.
- Eight-hour production soak, field INP and representative personal-use data. Short probes do not establish these gates.
- PostgreSQL execution: both dialects have migrations, but only SQLite was runtime-tested.
- Comparable unmodified upstream baseline and actual future upstream-release upgrade. The synthetic migration collision check does not certify every future release.

No failed or unexecuted gate is represented as passed. The foundation can be assessed locally; Windows/Android daily-use performance sign-off remains conditional on these checks.
