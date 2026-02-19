This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Stable Single-Instance Dev (Recommended)

This project uses a single-instance startup by default to avoid stale ports and mixed old/new frontends.

```bash
npm run dev
```

Useful commands:

```bash
npm run stop         # stop workspace Next.js dev processes
npm run dev:raw      # start plain next dev (no process guard)
npm run build        # safe build (stops dev + clean cache + build)
npm run build:raw    # plain next build
npm run smoke:routes # smoke-test main routes (all should return 200)
npm run smoke:css    # stress-check CSS asset responses
```

### Yoyoo Backend Connection (Real CEO/CTO Chain)

`/api/chat/stream` now forwards to Yoyoo backend team APIs:
- `POST /api/v1/team/tasks`
- `GET /api/v1/team/tasks/{task_id}`

Optional env vars (server-side, Next.js):

```bash
YOYOO_BACKEND_BASE_URL=http://127.0.0.1:8000
YOYOO_BACKEND_TIMEOUT_MS=600000
YOYOO_TASK_POLL_INTERVAL_MS=2000
YOYOO_TASK_TIMEOUT_MS=90000
YOYOO_TASK_DISPATCH_MODE=confirm
YOYOO_CTO_MAX_RUNNING_PER_USER=2
YOYOO_CTO_MAX_RUNNING_GLOBAL=4
YOYOO_CTO_MAX_QUEUE_PER_USER=8
YOYOO_CTO_RUNNING_TTL_MS=1200000
```

`YOYOO_TASK_DISPATCH_MODE`:
- `confirm` (default): task-like request requires explicit user confirmation (`确认执行`) before CTO starts.
- `auto`: old behavior, auto-dispatch when CEO reply allows.
- `manual`: never auto-dispatch from chat stream.

Notes:
- If backend is unreachable, UI gets a clear error message instead of fake success.
- Conversation clicking does not reorder; only real message send updates recency.
- CEO-first conversation flow:
  - Normal chat stays in CEO dialogue (no auto task dispatch).
  - Task-like requests enter "confirmation required" first.
  - Only after user confirms ("确认执行") does CTO execution start.
  - Current v1.0 supports CTO as executor. Non-CTO assignment is acknowledged but not executed.
- Capacity baseline (recommended):
  - 2C2G server: CTO concurrent tasks 2, child-agents per task 2, global child-agents 4.
  - 4C8G server: CTO concurrent tasks 4, global child-agents up to 10.
- Hard throttling valve:
  - If execution is saturated, confirmed tasks are queued automatically.
  - Queue can be checked by sending: `查看队列`
  - Queue can be canceled by sending: `取消排队`
  - When slot is free, queued task auto-promotes and starts execution.

## Yoyoo Docs

- Module Library (what exists / what is missing / design rules): `docs/MODULE_LIBRARY.md`
- Conversation Linkage Spec (left-chat -> workspace sync standard): `docs/CONVERSATION_LINKAGE_SPEC.md`

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
