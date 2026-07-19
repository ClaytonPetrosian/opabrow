# 发布指南

推送形如 `v1.2.3` 的 Git tag 后，GitHub Actions 会创建或更新对应的 GitHub Release，并上传以下可下载文件：

- `opabrow-<version>-arm64.dmg`：macOS Apple Silicon
- `opabrow-<version>-x64.dmg`：macOS Intel
- `opabrow-Setup-<version>-x64.exe`：Windows x64
- `opabrow-<version>-x64.AppImage`：Linux x64

## 创建发布

1. 更新 `package.json` 中的版本号。
2. 提交并推送版本变更。
3. 创建并推送同名版本 tag：

```bash
git tag v1.2.3
git push origin v1.2.3
```

工作流完成后，所有平台的安装包会出现在 GitHub Releases 页面。
每个 Release 还会附带 `SHA256SUMS.txt`，用于验证下载文件的完整性。

## 可选的代码签名

不配置证书时，工作流仍会生成可下载的安装包。为了让 macOS 和 Windows 用户获得更顺畅的首次运行体验，请在仓库的 `Settings > Secrets and variables > Actions` 配置以下 Secrets。工作流只会在这些 Secret 实际存在时把它们传给打包工具：

| 平台 | Secret | 用途 |
| --- | --- | --- |
| macOS | `MAC_CSC_LINK` | Base64 编码的 Developer ID Application `.p12` 证书 |
| macOS | `MAC_CSC_KEY_PASSWORD` | `.p12` 证书密码 |
| macOS | `APPLE_ID` | 用于公证的 Apple ID |
| macOS | `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID 的 app-specific password |
| macOS | `APPLE_TEAM_ID` | Apple Developer Team ID |
| Windows | `WIN_CSC_LINK` | Base64 编码的代码签名 `.pfx` 证书 |
| Windows | `WIN_CSC_KEY_PASSWORD` | `.pfx` 证书密码 |

证书和密码只应存在于 GitHub Secrets 中，绝不能提交到仓库。
