<p align="center">
  <img src="./opabrow-icon.png" width="96" alt="opabrow アイコン" />
</p>

<h1 align="center">opabrow</h1>

<p align="center">macOS 向けの透明フローティングブラウザ。</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <strong>日本語</strong>
</p>

<p align="center">
  <a href="https://github.com/ClaytonPetrosian/opabrow/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-3B82F6?style=flat-square" alt="MPL-2.0 ライセンス" /></a>
  <img src="https://img.shields.io/badge/platform-macOS-111827?style=flat-square&logo=apple" alt="macOS" />
  <img src="https://img.shields.io/badge/runtime-Electron-47848F?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/status-early%20preview-2EA44F?style=flat-square" alt="初期プレビュー" />
</p>

<p align="center">デスクトップを占有せず、必要なウェブページをそばに置く。</p>

<p align="center">
  <img src="./docs/opabrow-preview.svg" width="100%" alt="opabrow フローティングブラウザのプレビュー" />
</p>

## opabrow とは

多くのブラウザウィンドウは作業空間全体を必要とします。opabrow は、参照資料、ライブダッシュボード、プレイリストなど、ほかの作業の横でいつでも見られるようにしておきたいページのためのブラウザです。

タイトルバーは通常は透明で、ポインタを上端に移動したときだけ表示されます。独立した 32px の領域を持つため、コントロールが表示されてもウェブページを覆ったり、レイアウトをずらしたりしません。

| 邪魔をしない | すばやく移動 |
| --- | --- |
| フレームレスで透明なウィンドウ、ホバーで表示されるタイトルバー | アドレスバー、ローカル履歴の候補、戻る、進む、再読み込み、ホーム |
| 透明度の調整と任意の常に手前表示 | レスポンシブサイトを確認するためのモバイル User-Agent モード |
| アカウントやクラウド同期を必要としないローカル優先の履歴 | macOS ネイティブメニューと一般的なキーボードショートカット |

## ダウンロード

[最新リリース](https://github.com/ClaytonPetrosian/opabrow/releases/latest) から macOS、Windows、Linux 向けのインストーラーをダウンロードできます。各リリースには以下を含みます。

- macOS Apple Silicon (`arm64`) および Intel (`x64`)
- Windows x64（`.exe` インストーラー）
- Linux x64（`.AppImage`）

## はじめに

### 必要環境

- macOS
- Node.js 22 以降
- pnpm 9 以降

### ローカルで実行する

```bash
git clone https://github.com/ClaytonPetrosian/opabrow.git
cd opabrow
pnpm install
pnpm dev
```

### ビルド

```bash
pnpm build
pnpm build:mac
```

## 小さくても便利なブラウザ

### アドレスバーと履歴

ポインタをウィンドウ上端へ移動するか、`Cmd+L` を押します。通常時は URL の文字列幅だけがクリックできるコンパクトな表示となり、タイトルバーの残りはウィンドウのドラッグに使えます。フォーカスすると入力欄が広がり、通常のコピー、カット、ペーストのショートカットを利用できます。

入力中はローカルのナビゲーション履歴から最大 5 件の候補が表示されます。候補はページタイトルを先に、URL を後に表示します。矢印キーで選択し、`Enter` で開きます。

### Bilibili の動画ページ

Bilibili の動画または Bangumi の再生ページを開くと、プレイヤーは自動的にウェブ全画面モードへ切り替わります。動画は利用可能なページ領域を埋めますが、opabrow のウィンドウ内にとどまります。

### ウェブページの場所を奪わないウィンドウ操作

閉じるボタンと最小化ボタンはホバー時に滑らかに表示されます。webview は常にタイトルバーの下から始まるため、コントロールを表示してもページ内容と重なったりレイアウトが変わったりしません。

### デスクトップとモバイルモード

macOS メニューからモバイル User-Agent に切り替えると、サイトのレスポンシブ表示を確認できます。デスクトップモードへ戻しても、現在のページは失われません。

## キーボードショートカット

| ショートカット | 操作 |
| --- | --- |
| `Cmd+L` | アドレスバーにフォーカス |
| `Cmd+[` / `Cmd+]` | 戻る / 進む |
| `Cmd+R` | 再読み込み |
| `Cmd+Shift+H` | ホームを開く |
| `Cmd+T` | 常に手前表示を切り替え |
| `Cmd+=` / `Cmd+-` | ウィンドウ透明度を調整 |
| `Cmd+K` | コマンドパネルを開く |

## 開発

```bash
pnpm typecheck
pnpm build
```

このプロジェクトは Electron と React で構築されています。Electron のメインプロセスはネイティブウィンドウと macOS メニューを管理し、レンダラープロセスはタイトルバー、アドレスバー、ローカル履歴、webview の操作を担当します。

## ロードマップ

無料コアでは、洗練されたフローティング閲覧体験に注力します。将来の Pro 向け実験ではワークスペース、プロファイル、任意の同期、自動化を追加する可能性がありますが、ローカル優先のコアは維持します。

## コントリビュート

バグ報告、デザインに関するフィードバック、焦点を絞った Pull Request を歓迎します。Pull Request を作成する前に [CONTRIBUTING.md](CONTRIBUTING.md) をお読みください。

## ライセンス

opabrow は [Mozilla Public License 2.0](LICENSE) のもとで公開されています。
