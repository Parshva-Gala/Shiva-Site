.github maintenance for SHIVA
================================

These workflow files originate from Homarr v2.1.2, commit
473b6cb7c46a147886c41a9b1fabe36d10b6b854, under the repository's Apache-2.0 license.
The existing LICENSE and upstream notices remain in place.

Every upstream job requires github.repository == 'homarr-labs/homarr', combined
with its original condition. In Parshva-Gala/Shiva-Site these jobs cannot run,
including push, pull_request_target, schedule and manual-dispatch jobs. This
repository does not enable upstream image publishing, deployments, automatic
releases, bots, third-party translation updates or paid services.

Keep these guards when merging upstream updates, including any newly added jobs.
Use the documented local validation commands. A future scoped SHIVA CI workflow
requires its own reviewed permissions and resource scope; none is added here.
