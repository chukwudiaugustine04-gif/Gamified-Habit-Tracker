---
name: Vercel static build defaults
description: The Vite workspace must build statically without Replit-specific environment variables.
---

For Vercel static builds, no environment variables should be required. Use port `5000` and base path `/` when `PORT` or `BASE_PATH` are missing, while honoring explicit values for mounted deployments.

**Why:** The user repeatedly specified that the root build must pass on Vercel without configuring environment variables.

**How to apply:** When changing Vite configs included by the root workspace build, preserve these fallbacks and verify with both variables unset.
