# 源码、重建与部署

项目源代码：src（React/TypeScript）、public（模型、九张背景、品牌资源、许可页）、scripts（模型准备、许可清单、本地安装器、工具包构建）、vendor（未修改 AGPL 依赖 1.7.0 的精确原始源码文本）。

## GitHub 源码

使用支持 Vite 7 的 Node.js：22.12+ 或受支持的更高版本。在源码根目录运行 npm ci、npm run build。浏览器成品生成到 dist。public/models 的权重和 WASM 资源已携带；仅在它们缺失时运行 node scripts/prepare-models.mjs，下载锁定 IMG.LY 1.7.0 资源。

根目录 START-* / local-server.* 可从 dist 启动。开发可用 npm run dev，默认浏览器地址为 http://127.0.0.1:5173/ 。本地安装器仅使用 Node/Python 标准库，成品用户不需要安装 npm 依赖。

## Releases 本地工具包

成品 ZIP 内 app 为构建结果（含模型），source 为对应应用源码和构建说明，licenses / vendor 为依赖许可及 AGPL 精确源码。为减少重复体积，source/public 不重复装模型；离线重建从 app/models 复制到 source/public/models 后安装锁定 npm 依赖、构建。

在源码根目录使用 node scripts/package-local.mjs v1.2.0 生成一个新目录到 outputs；默认拒绝覆盖已有目录。脚本不生成 ZIP；需要发布者显式压缩整个新目录，不能只压 app。旧版本不会被脚本清理。自定义版本号遵守 vX.Y.Z。

## GitHub Pages

public 的模型和背景必须一起随 dist 发布；不能仅上传 index.html。Vite 使用相对 base，模型、背景、二维码和许可页均按站点子目录解析，兼容 /silhouette-generator/。.github/workflows/pages.yml 负责 npm ci、构建和部署，无照片上传接口。

Pages 需要仓库管理员将部署来源设为 GitHub Actions。本项目未使用 WordPress、云函数或收费服务器。中国大陆访问 GitHub 和 GitHub Pages 的速度可能波动；本地完整工具包启动/识别不依赖 GitHub 在线访问。

## 许可

Copyright © 2026 安鱼。程序 AGPL-3.0-only，修改或再分发需遵守原文要求，不能只保留压缩后的 JS 而隐藏对应源码。未修改的 AGPL 依赖源码快照见 vendor/imgly-background-removal-1.7.0。其他依赖版本和许可在 licenses/DEPENDENCY-LICENSES.json，模型及背景来源见 THIRD-PARTY-NOTICES.md。
