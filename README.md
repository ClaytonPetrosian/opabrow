<p align="center">
  <img src="./opabrow-icon.png" width="96" alt="opabrow icon" />
</p>

<h1 align="center">opabrow</h1>

<p align="center">A transparent floating browser for macOS.</p>

<p align="center">
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/ClaytonPetrosian/opabrow/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-3B82F6?style=flat-square" alt="MPL-2.0 license" /></a>
  <img src="https://img.shields.io/badge/platform-macOS-111827?style=flat-square&logo=apple" alt="macOS" />
  <img src="https://img.shields.io/badge/runtime-Electron-47848F?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/status-early%20preview-2EA44F?style=flat-square" alt="Early preview" />
</p>

<p align="center">
  Keep the web close, without letting it take over your desktop.
</p>

<p align="center">
  <img src="./docs/opabrow-preview.svg" width="100%" alt="opabrow floating browser preview" />
</p>

## Why opabrow

Most browser windows ask for a whole workspace. opabrow is for the page you want nearby: a reference, a live dashboard, a playlist, or a small task that should remain accessible while you work elsewhere.

The title bar stays transparent until the pointer reaches the top edge. It has its own 32px strip, so revealing the controls never covers or shifts the webpage below.

| Stay out of the way | Get there quickly |
| --- | --- |
| Frameless, transparent window with hover-revealed controls | Address bar, local history suggestions, back, forward, reload and home |
| Adjustable opacity and optional always-on-top behavior | Mobile user-agent mode for checking responsive sites |
| Local-first browsing history with no account or cloud sync | Native macOS menu commands and familiar keyboard shortcuts |

## Download

[Download the latest release](https://github.com/ClaytonPetrosian/opabrow/releases/latest) for macOS, Windows or Linux. Each release includes installers for:

- macOS Apple Silicon (`arm64`) and Intel (`x64`)
- Windows x64 (`.exe` installer)
- Linux x64 (`.AppImage`)

## Get started

### Requirements

- macOS
- Node.js 22 or later
- pnpm 9 or later

### Run locally

```bash
git clone https://github.com/ClaytonPetrosian/opabrow.git
cd opabrow
pnpm install
pnpm dev
```

### Build

```bash
pnpm build
pnpm build:mac
```

## A small browser, with the useful parts

### Address bar and history

Move the pointer to the top edge or press `Cmd+L`. When idle, the address is a compact, text-sized target, leaving the rest of the title bar free for dragging. Once focused, it expands for editing and accepts standard copy, cut and paste shortcuts.

As you type, opabrow suggests up to five matching pages from the local navigation history. Suggestions place the page title first and the URL second; use the arrow keys to choose a result, then press `Enter`.

### Bilibili video pages

Opening a Bilibili video or Bangumi playback page automatically switches the player to its web fullscreen mode. The video fills the available page area while staying inside the opabrow window.

### Window controls that do not steal space

The close and minimize controls appear smoothly on hover. The webview always starts below the title bar, so showing the controls does not overlap the page or change its layout.

### Desktop and mobile mode

Switch to a mobile user agent from the macOS menu to inspect a site's responsive experience, then switch back without losing the current page.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+L` | Focus the address bar |
| `Cmd+[` / `Cmd+]` | Back / forward |
| `Cmd+R` | Reload |
| `Cmd+Shift+H` | Open the home page |
| `Cmd+T` | Toggle always-on-top |
| `Cmd+=` / `Cmd+-` | Adjust window opacity |
| `Cmd+K` | Open the command panel |

## Development

```bash
pnpm typecheck
pnpm build
```

The project is an Electron + React application. The Electron main process manages the native window and macOS menu; the renderer owns the title bar, address bar, local history and webview interaction.

## Roadmap

The free core focuses on a polished floating browsing experience. Future Pro experiments may add workspaces, profiles, optional sync and automation without removing the local-first core.

## Contributing

Bug reports, design feedback and focused pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

opabrow is released under the [Mozilla Public License 2.0](LICENSE).
