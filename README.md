# opabrow

opabrow is a compact, transparent floating browser for macOS. It keeps a web page in a lightweight frameless window, with a title bar that appears only when you need it.

## Highlights

- Transparent, frameless macOS window with a hover-revealed title bar
- Address bar with local history suggestions
- Navigation shortcuts: address bar, back, forward, reload, home and always-on-top
- Adjustable window opacity and mobile user-agent mode
- Local browsing history; no account or cloud sync is required

## Requirements

- macOS
- Node.js 22 or later
- pnpm 9 or later

## Development

```bash
pnpm install
pnpm dev
```

## Checks

```bash
pnpm typecheck
pnpm build
```

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+L` | Focus the address bar |
| `Cmd+[` / `Cmd+]` | Back / forward |
| `Cmd+R` | Reload |
| `Cmd+Shift+H` | Open the home page |
| `Cmd+T` | Toggle always-on-top |
| `Cmd+=` / `Cmd+-` | Adjust window opacity |
| `Cmd+K` | Open the command panel |

## Roadmap

The free core focuses on a polished floating browsing experience. Future Pro experiments may add workspaces, profiles, optional sync and automation without removing the local-first core.

## Contributing

Bug reports, design feedback and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the Mozilla Public License 2.0. See [LICENSE](LICENSE).
