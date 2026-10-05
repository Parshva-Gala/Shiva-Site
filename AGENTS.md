# Homarr Agent Rules

## SHIVA project constraints

- Base is Homarr v2.1.2, commit 473b6cb7c46a147886c41a9b1fabe36d10b6b854. Keep Apache-2.0 license and upstream notices.
- SHIVA is a single-user personal product. Preserve host authentication, Mantine, tRPC and Drizzle migrations; no parallel account system or database.
- Keep SHIVA UI in `apps/nextjs/src/shiva`, validation in `packages/validation/src/shiva.ts`, API in its isolated router, and native records in host migration-managed tables.
- Use Asia/Kolkata, INR and Indian number formatting. ClickUp owns tasks, Obsidian notes, Excel financial calculations, and calendar providers appointments. No account writes or live integrations in milestone one.
- Theme exports contain appearance only; validate strictly. Never execute theme JavaScript or mix credentials/personal records into themes. Theme/layout changes never mutate Shopping.
- Explicitly label samples. Empty and planned modules must be honest. Connected requires successful verification. Keep secrets server-side and out of tracked files, logs and exports.
- Bind app, Redis and any development services to localhost. No public hosting, tunnels, paid services or remote publication without explicit user authorization.
- The user authorized source maintenance in `Parshva-Gala/Shiva-Site`. Publish reviewed source branches and pull requests there; preserve upstream ancestry and keep every inherited automation job restricted to `homarr-labs/homarr`. This authorization does not include app deployment, real account writes, secrets, personal databases, uploaded images or private verification artifacts.
- Confirm Shopping deletion. Validate client and server inputs; scope all records to authenticated owner. Do not import real professional records as samples.
- Run focused schema/security/persistence tests, type checks, lint and production build for the foundation. Inspect desktop/mobile in an actual browser. Record unexecuted or failed checks honestly.
- Windows setup, backup/restore and upstream update instructions belong in README and `docs/shiva`. Do not overwrite existing `.env` or personal data.
- Treat `docs/shiva/PERFORMANCE.md` as a release requirement: production responsiveness, realistic data, memory/soak checks and desktop/mobile evidence. Keep ordinary settings <=50 KiB, image bytes out of routine settings mutations, lists bounded and provider refresh independent of native page loading. Never report unmeasured targets or lab proxies as actual production/field results.

## Repository Structure

```
homarr/
├── apps/
│   ├── nextjs/          # Main Next.js application (port 3000)
│   ├── docs/            # Next.js + Fumadocs documentation site (@homarr/docs)
│   ├── tasks/           # Cron-job initialization and scheduling runtime
│   ├── websocket/       # Standalone tRPC WebSocket server (port 3001)
│   └── workshop/        # Go/PocketBase Workshop service
├── packages/
│   ├── api/             # tRPC appRouter, procedures, OpenAPI
│   ├── auth/            # NextAuth config, providers, session, API keys
│   ├── db/              # SQLite and PostgreSQL schemas, migrations, queries
│   ├── core/            # Env validation, DB/Redis driver factories, logging
│   ├── definitions/     # Domain enums: WidgetKind, IntegrationKind, permissions
│   ├── widgets/         # Dashboard widget definitions and components
│   ├── integrations/    # Integration classes (HTTP clients to external apps)
│   ├── redis/           # Redis pub/sub channels, caching abstractions
│   ├── translation/     # next-intl setup, locale configs, lang JSON files
│   ├── ui/              # Shared Mantine components, theme, hooks
│   ├── validation/      # Shared zod schemas for API/forms
│   ├── common/          # Shared utilities, IDs, errors
│   ├── cron-jobs/       # Cron job implementations
│   ├── cron-jobs-core/  # Cron scheduling primitives
│   ├── cron-job-status/ # Cron status via Redis
│   ├── boards/          # Board context, edit mode, cache updater
│   ├── modals/          # Modal primitives on Mantine
│   ├── modals-collection/ # Feature modals (apps, boards, docker, etc.)
│   ├── form/            # useZodForm (Mantine + zod resolver)
│   ├── forms-collection/# Reusable form UIs (new app, icon picker, upload)
│   ├── spotlight/       # Command palette / search with multiple modes
│   ├── request-handler/ # Server request handlers (feeds, integrations)
│   ├── notifications/   # Mantine notifications wrapper
│   ├── docker/          # Dockerode-based Docker access
│   ├── icons/           # Icon DB/repo integration
│   ├── image-proxy/     # Image proxy + caching
│   ├── ping/            # Reachability / ping utilities
│   ├── analytics/       # Server-side analytics (Umami)
│   ├── server-settings/ # Server setting keys/types
│   ├── settings/        # User-facing settings UI context
│   ├── custom-widgets/  # Custom JSX v2 schema, validation, and runtime
│   ├── onboarding/      # Onboarding studio and setup flow
│   ├── workshop/        # Homarr-side Workshop client and contracts
│   └── cli/             # Node CLI for ops (brocli)
├── tooling/
│   ├── typescript/      # Base tsconfig
│   └── github/          # CI setup action
├── tools/
│   └── homarr-dev/      # Go CLI for local and PR Docker images
├── development/         # Dev docker-compose (Redis, MySQL, PostgreSQL)
├── e2e/                 # E2E test specs
└── Dockerfile           # Multi-stage production build
```

## Documentation

Add documentation only when users need the information to set up, use, or troubleshoot Homarr and cannot reasonably discover it from the UI or generated API schema. If a user does not need to know it, do not document it. A code, UI, or API change alone is never a reason to add docs.

Keep warranted documentation concise. Omit UI walkthroughs, visible control descriptions, internal implementation details, and anything already clear from the interface or schema.

Only after this user-need test passes, use these locations:

- New integration → `apps/docs/docs/integrations/<slug>/index.mdx` + `index.ts`
- New widget → `apps/docs/docs/widgets/<slug>/index.mdx` + `index.ts`
- Changed API → `apps/docs/docs/management/api/index.mdx`
- New/changed env vars → `apps/docs/docs/advanced/`
- New CLI commands → `apps/docs/docs/advanced/command-line/`
- Auth changes → `apps/docs/docs/advanced/` SSO pages
- New cron job → `apps/docs/docs/management/tasks.mdx`

## Monorepo Commands

- `pnpm dev` — Next.js app only
- `pnpm dev:cli -- dev` — run the developer CLI without installing a global binary
- `pnpm db:seed` — seed default database data explicitly
- `pnpm docker:dev:up` — start the Redis development service in the background
- `pnpm dev:docs` — Fumadocs site only
- `pnpm turbo build` — build all packages
- `pnpm turbo build --filter=@homarr/docs` — build docs only
- `pnpm turbo typecheck` — typecheck all packages
- `pnpm lint` / `pnpm format` — oxlint / oxfmt

## Code Style

- Lint: oxlint (not ESLint)
- Format: oxfmt (not Prettier)
- UI: Mantine (not Tailwind) — Tailwind is only used in docs app
- Mantine: use the `mantine` MCP server in `.mcp.json` for current v9 APIs before writing component code. Prefer built-in primitives (`Combobox`/`useCombobox`, the polymorphic `component` prop, `@mantine/hooks`) and check `packages/ui/` for existing conventions first.
- Icons: @tabler/icons-react
- Docs app can import from `@homarr/definitions` for shared types
- Run `pnpm dev:cli -- dev` to browse local `homarr:*` images and remote PR images.
- Run `pnpm dev:cli -- build <name>` from a Homarr checkout to build `homarr:<name>` with rebuild provenance.
- Run `pnpm dev:cli -- build --pr <number>` to build a PR locally from a temporary checkout.

## Testing

Add tests only when requested, and only when the test is extremely relevant and will plausibly prevent a future regression in user-visible behavior or a security boundary. Do not add tests that restate implementation details or duplicate stronger coverage. For focused changes, run only the relevant existing or newly requested checks when validation is needed. Do not run broad test, Docker, or E2E suites by default.

## MCP servers

`.mcp.json` declares project-scoped MCP servers. Keep only keyless definitions there; credentials belong in local dotfiles. See [Mantine LLM tooling](https://mantine.dev/guides/llms/) for client-specific setup.

## Agent Skills

Portable skills live in `.agents/skills/`. Read the relevant `SKILL.md` before working in that domain; detailed references are loaded only when needed. Claude-compatible discovery is provided through `.claude/skills`.

- `codebase-context` — architecture, package boundaries, and shared utilities
- `documentation-sync` — user-critical documentation only
- `mcp-integration` — safe tRPC-to-MCP exposure
- `homarr-custom-widget` — safe Custom JSX v2 authoring
