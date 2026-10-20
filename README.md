# prime-bot

P.R.I.M.E copy-trading Telegram bot — pnpm monorepo:

- `apps/server` — Express backend (Telegram bot, Helius/Telegram webhooks, trading loops). Deploys to Render.
- `apps/web` — Next.js UI (landing + Telegram Mini App + admin dashboard). Deploys to Vercel.
- `packages/core` — shared trading, ledger, wallet and DB logic.

See `.env.example` (root, local dev) and the per-app `.env.example` files for configuration.
# betaOne
