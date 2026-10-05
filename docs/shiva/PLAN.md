# SHIVA implementation plan

The [product and engineering plan](PRODUCT_PLAN.md) is the planning baseline. Implementation resumed after the user's **Start** instruction. The first foundation is implemented on pinned Homarr v2.1.2. Functional checks, loading/interaction measurements and short resource diagnostics passed their exercised lab checks. Source maintenance targets `Parshva-Gala/Shiva-Site`; the `shiva-foundation` review branch carries this milestone. See [VERIFICATION.md](VERIFICATION.md) for results and qualification limits.

## Foundation milestone

| Deliverable                                                                           | Status                                                                                                                 |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Inspect stable Homarr, license, extension boundaries, alternatives and Gloation       | Complete                                                                                                               |
| Architecture decision and professional product/performance plans                      | Complete                                                                                                               |
| SHIVA branding, ten destinations and retained host authentication                     | Complete                                                                                                               |
| Labelled sample Home and honest planned/not-configured modules                        | Complete                                                                                                               |
| Midnight Glass, Graphite and Ivory; shared tokens, preview/cancel/reset/safe recovery | Complete                                                                                                               |
| Wallpaper library, appearance-only import/export and saved presets                    | Complete                                                                                                               |
| Durable appearance, privacy and keyboard-editable basic saved layouts                 | Complete                                                                                                               |
| Shopping CRUD, confirmation, validation, filters, pagination and exact prices         | Complete                                                                                                               |
| Windows setup wrapper, placeholder configuration and localhost Redis                  | Implemented; Linux production setup executed, Windows qualification pending                                            |
| Backup/restore and upstream update guidance                                           | Complete; isolated SQLite/image restore check passed                                                                   |
| Typechecks, focused tests, scoped lint and production build                           | Passed: final production build and 93 focused tests                                                                    |
| Desktop/narrow workflows and restart persistence                                      | Passed: final 32 checks, screenshots and actual restart persistence                                                    |
| Realistic-data API and Shopping performance                                           | Passed: 2,000 records and 1,000 acknowledged saves                                                                     |
| Cold-load and interaction measurements                                                | Passed lab p95 budgets; one retained theme-feedback outlier documented                                                 |
| Short resource/stability measurements                                                 | Passed: five-minute idle and one-minute interaction diagnostics; tab memory and long-term stability remain unqualified |
| Source maintenance in `Parshva-Gala/Shiva-Site`                                       | Reviewed `shiva-foundation` source branch; guarded Homarr baseline on `main`                                           |
| Actual Windows, Android, field INP and eight-hour stability                           | Pending; separate release qualification                                                                                |

No real provider integration, account write, public deployment, or personal data import is part of this milestone. Sample Home data must remain clearly identified. Appearance changes must not modify shopping records.

[Performance requirements](PERFORMANCE.md) remain mandatory release gates. Ordinary settings are bounded, wallpaper bytes live in separate owned files and lists are paginated. Linux lab evidence does not establish Windows/Android or long-session performance. Basic layout editing concerns SHIVA Home cards; the upstream Homarr board grid remains separate.

## Later milestones

1. Read-only selected ClickUp tasks and calendar agenda with separate deadlines/appointments, verification and refresh/error state.
2. Native goals, daily planning, routines and workout logs; outcomes/projects/tasks/routines/appointments stay distinct.
3. Explicit saved-result JSON/CSV finance import and Obsidian links/approved index.
4. Selected actionable email capture and separately approved writes; evaluate official WhatsApp constraints.
5. Advanced layouts, search and justified extensions.

## Validation record

The [verification report](VERIFICATION.md) records checks, measured distributions, resolved build issues and remaining gates. Before adding connections, qualify the production build on the intended Windows laptop. The physical Windows/Android and eight-hour checks remain outstanding; no provider accounts have been modified.
