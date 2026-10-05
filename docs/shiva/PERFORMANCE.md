# SHIVA performance requirements and release gates

**Status:** required engineering targets. Foundation implementation has resumed; executed lab measurements and remaining qualification gates are recorded in [VERIFICATION.md](VERIFICATION.md). Windows, actual Android and eight-hour stability evidence must be reported separately.

SHIVA should respond like a polished daily-use application on the actual Windows laptop and, when enabled, a representative Android phone. Attractive appearance must fit inside a responsiveness and resource budget. A working feature is not complete if its normal use is slow, blocks input, or steadily consumes memory.

## 1. Measurement conditions

- Measure a production build with the locked toolchain. Development-mode compilation is recorded separately and does not establish runtime performance.
- Record CPU, RAM, Windows version, browser version, runtime/tool versions, build commit, test data size, theme and network conditions. The laptop's hardware has not yet been inspected.
- Desktop reference: the user's approximately 16 GB Windows laptop, current Edge or Chrome, with ordinary background applications running. Measure app, browser and Docker/WSL overhead separately.
- Mobile reference: an actual representative Android device, with navigation, scrolling and input checked through the approved access setup. Browser CPU/network throttling is useful during development but cannot certify phone performance.
- Include a reproducible constrained-network approximation, such as 4 Mbps download, 1 Mbps upload, 150 ms RTT and 4x browser CPU throttling. Record the simulator and settings; localhost without these conditions cannot qualify remote mobile use.
- Distinguish cold browser load, warm reload, first module visit, cached navigation, server startup and provider refresh. Do not mix their measurements.
- Reuse deterministic, clearly synthetic datasets. Never benchmark using confidential professional records or unapproved accounts.

## 2. Responsiveness budgets

These are the initial acceptance targets. Measure them before release; do not silently relax them to match a slow host. If the inherited application cannot meet them, optimize the demonstrated bottleneck or reassess the base before expanding scope.

| Metric                           | Desktop target                                                                                                    | Mobile target / interpretation                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Largest Contentful Paint         | <=2.5 seconds on a cold production browser load; aim <=2 seconds with a warm cache                                | <=2.5 seconds under the defined representative access profile; show real useful content |
| Cumulative Layout Shift          | <=0.1                                                                                                             | <=0.1; images/cards reserve space and skeletons match the final layout                  |
| Interaction to Next Paint        | <=200 ms                                                                                                          | <=200 ms across actual interactions                                                     |
| Cached in-app navigation         | p95 <=500 ms from activation to useful destination content                                                        | p95 <=800 ms on the representative device/network                                       |
| Button, modal and menu feedback  | Visible response within 100 ms                                                                                    | Same; loading feedback appears promptly for deferred work                               |
| Theme slider/preview interaction | Visible feedback within 100 ms; no blocking network save per slider tick                                          | Same in reduced-effects mode; large image processing does not block typing              |
| Native list/filter request       | p95 <=300 ms server time with the supported dataset                                                               | Network transit recorded separately; input feedback stays immediate                     |
| Native durable save              | p95 <=500 ms target and p99 <=1 second ceiling for ordinary record/settings changes on a healthy local server     | Show pending immediately; only report saved after durable server acknowledgement        |
| Scroll/rendering                 | Aim for 60 fps on a 60 Hz device; sustained jank or recurring >50 ms main-thread tasks in core flows fails review | Same in reduced-effects mode; measure real phone traces                                 |

LCP, CLS and INP use their standard definitions. Their conventional “good” thresholds concern the 75th percentile of real visits/interactions. Controlled lab sessions are qualification evidence, not a claim of field results. Use Lighthouse as diagnostic support and browser interaction traces for responsiveness; a high Lighthouse score alone cannot satisfy these gates.

For local action/navigation p95, use at least 50 repetitions per relevant flow after warm-up, report p50/p95 and failures, and separate cold measurements. Assess the p99 save ceiling with at least 1,000 durable operations against a separate synthetic fixture, retaining failure and outlier counts; never infer it from a short demo. For cold load, collect at least 10 independent runs with defined cache state and report the distribution. Small samples remain limited evidence, especially for percentile claims; retain outliers and explain them rather than averaging them away.

## 3. Resource and startup budgets

| Area                 | Initial target / release requirement                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Application services | Combined Node application, embedded services and Redis: aim <=1.5 GB steady idle, <=2 GB during the supported interactive workload                                                         |
| Browser              | Aim <=350 MB steady tab memory and <=500 MB under the larger test workload; browser measurement method and process attribution must be stated                                              |
| Docker/WSL           | Report its memory and CPU separately; choose a configuration that leaves the 16 GB laptop comfortable for normal work. Application-only figures must not conceal VM overhead               |
| Idle CPU             | No sustained polling/animation load; investigate sustained application CPU above roughly 2% of total machine capacity in an idle five-minute window                                        |
| Startup              | Target healthy application readiness within 15 seconds after its dependencies are ready; measure cold Docker startup separately and show an actionable failure if readiness is not reached |
| Soak stability       | No crashes, refresh storms or unbounded cache growth during an eight-hour representative session; memory should settle after repeated navigation, dialog use and theme previews            |
| Build/install        | Record elapsed time, peak memory and actual native dependency failures. Verify the workflow on 16 GB without requiring an unapproved hardware or service purchase                          |

Memory figures are initial budgets, not existing results or promises about uninspected hardware. Measure attribution consistently. An unexplained rising memory baseline after repeating the same workload is a defect even when it remains below the absolute cap.

## 4. Data volumes and payload discipline

Empty screens and tiny examples are insufficient performance evidence. Each implemented module is tested at a representative volume and a qualification volume. Future modules have no performance claim until implemented and measured.

| Data                           | Representative test                                                  | Larger qualification test                                                                 |
| ------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Shopping                       | 200 items, varied categories/stages, long notes and safe links       | 2,000 items; bounded list responses and detail loading                                    |
| Selected task cache, later     | 500 tasks across personal/professional contexts                      | 10,000 cached summaries with pagination and filtering                                     |
| Calendar, later                | Selected calendars and a 30-day agenda with recurring/all-day events | Dense 90-day bounded occurrence window; recurrence expansion stays bounded                |
| Routine/workout history, later | Several routines plus one year of genuine-shaped synthetic logs      | Multiple years, up to 10,000 occurrences/log rows; summaries avoid full-history rendering |
| Appearance                     | Three built-in themes, several custom presets and a chosen image     | Maximum allowed presets and wallpaper size; test repeated preview/save/cancel             |

Requirements:

- Lists query/filter/sort efficiently and load bounded pages; a detail form retrieves long notes or large fields only as needed. Use indexed queries and virtualization when profiling justifies it.
- No full-table download for every Home card. Summaries query the relevant period/counts rather than returning every record.
- Ordinary settings metadata must stay below 50 KiB. Wallpaper bytes must not accompany every privacy or layout mutation; separate validated asset storage and lightweight preset metadata are a foundation performance gate. The draft can otherwise carry roughly 36 MB of encoded images across an active theme and twelve maximum-size presets, before other settings. Do not serialize that image document on every editor render or slider change.
- Theme export has an explicit validated image/size policy. A portable file can be larger than a settings response, but cannot become an unlimited payload.
- Track compressed JavaScript/CSS per route. Use a provisional cold Home JavaScript budget of 500 KiB compressed, excluding separately accounted images/fonts. Measure the inherited baseline and incremental SHIVA cost; costly optional editor/chart/provider code loads only when needed.
- Size wallpaper images for display, bound decode dimensions as well as file bytes, and avoid rendering several full-resolution copies in preset previews.
- Keep provider reads, recurrence expansion and imports bounded. Use batch summaries instead of one server request per visible row.

The byte and volume budgets are reviewable qualification targets. Any unavoidable host-related exception must record the measured cost, alternatives considered and effect on the user-facing latency/resource gates. A host dependency is not an automatic exception to responsiveness.

## 5. Architecture needed to meet the targets

1. **Serve local information first.** Provider latency never blocks opening Home, Shopping, Settings or cached tasks. Source refresh runs separately, with last-good data, freshness and errors visible.
2. **Keep database work bounded.** Reuse host SQLite; use narrow projections, indexed filters, pagination and aggregate queries. Avoid repeated full-document writes and N+1 queries.
3. **Keep the browser's main thread free.** Isolate expensive editor/chart modules, avoid unnecessary whole-shell rerenders, debounce appropriate search requests, and schedule heavy image/import processing away from input-critical work where profiling requires it.
4. **Make effects affordable.** Limit blur regions; avoid stacked full-screen backdrop filters and continuous animation. Graphite and reduced-effects mode are performance fallbacks as well as readable themes.
5. **Make requests economical.** Deduplicate refreshes, cache selected source summaries, bound concurrency, use backoff and cancel obsolete requests. Avoid aggressive polling and fetch-on-every-render patterns.
6. **Keep state correct while fast.** Preview is local draft state; persistence is deliberate. Only acknowledge saved records after success, preserve failed inputs, and prevent stale multi-tab writes. Perceived speed cannot substitute for durable correctness.
7. **Use the existing infrastructure.** No new queue, database, worker service or paid monitoring platform for speculative optimization. Add infrastructure only after a measured requirement and a simpler alternative review.

## 6. Qualification and regression checks

| Gate                  | Required evidence                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Upstream baseline     | Measure the pinned unmodified base where comparable, then SHIVA on the same machine/profile; identify inherited versus added costs  |
| Core user flows       | Cold Home load, navigation, list/filter/search, create/edit/delete, save failure, layout editor and all theme modes                 |
| Visual effects        | Compare Midnight Glass, Graphite, Ivory and reduced effects with the same data; test wallpaper maximums and repeated preview/cancel |
| Slow/offline provider | Slow, failed and rate-limited source simulations do not slow native modules or destroy the last good cache; no live account writes  |
| Scale                 | Representative and larger datasets above; no uncontrolled all-record rendering or large ordinary settings payloads                  |
| Soak                  | Eight-hour representative browser/server session, plus repeated navigation/theme/dialog cycles with settled memory observations     |
| Windows/mobile        | Actual laptop production measurements; actual Android verification when that access milestone is enabled                            |
| Updates               | Repeat comparable smoke measurements after dependency/host changes and substantial UI/data work                                     |

For comparable runs, an unexplained >10% regression in important latency, bundle size or steady memory triggers investigation. A >20% repeatable regression or any breach of a user-facing acceptance target blocks release until resolved or a documented, evidence-based budget decision is made. Re-run enough to distinguish variance from regression; do not enforce single noisy timings as deterministic tests.

Save a concise, privacy-safe performance report with environment, build, data profile, measurement method, p50/p95 where supported, cold-load results, resource observations, failures and remediation. Keep traces and screenshots private; exclude credentials and personal record content. Local tooling and reports are sufficient; no external analytics collection is required.

## 7. Current status and next performance action

The production source build has been executed within this Linux environment's 16 GiB memory limit using supported webpack memory optimizations and a build-only 6 GiB heap budget. Backend correctness checks and a successful build do not establish runtime speed. Consult the verification report for actual browser/API distributions and resource observations; unexecuted gates remain pending.

Measure and qualify the core workflows before adding integrations. If Homarr's measured footprint or responsiveness conflicts with the 16 GB laptop goal, resolve the demonstrated bottleneck before expanding the feature set. No Linux browser simulation certifies the actual Windows laptop or Android phone.

This specification is part of the [product plan](PRODUCT_PLAN.md) and [milestone status](PLAN.md). Functional, accessibility, persistence and performance acceptance must all pass for the relevant release.
