# Contributing

## Before opening a pull request

1. Keep changes focused on one user-visible improvement or bug fix.
2. Run `pnpm typecheck` and `pnpm build`.
3. Do not commit generated directories such as `node_modules/`, `out/` or `dist/`.

## Issues

For a bug report, include the macOS version, the app version, expected behavior and a short reproduction path. Please remove private URLs, browsing history and account information from screenshots and logs.

## Design principles

- Keep the floating window calm and unobtrusive.
- Preserve keyboard-first navigation.
- Prefer local storage over accounts or background services unless a feature clearly needs them.
