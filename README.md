# 剪影生成器 · Silhouette Generator

免费的摄影剪影拼贴工具。作者：**安鱼（Anyu）** · [ANYUSJ.COM](https://www.anyusj.com/) · [小红书](https://xhslink.cn/m/5g1EQhRumkz)。程序 AGPL-3.0-only；照片在浏览器本地处理，不上传服务器。

## 最简单的本地安装

在 [Releases](https://github.com/www886321-commits/silhouette-generator/releases) 下载 **silhouette-generator-v1.2.0-desktop.zip**，完整解压，把整个工具包或下面一句话交给你的 AI Agent：

> 请完整安装这个剪影生成器工具包，按照 AGENT-INSTALL.md 检查环境、启动本地网页并验证上传照片和 PNG 导出，不要部署公网，不要上传我的照片；完成后告诉我启动和停止方法。

Windows 双击 START-WINDOWS.cmd；Mac/Linux 使用对应 START 文件。成功后启动窗口自动退出，停止用 STOP-*。需要已安装的 Node.js 或 Python，缺少时由 Agent 按它自己的授权流程安装。**不要双击 HTML 文件。** 模型和九张背景已携带，首次识别也可以离线；成品无需 npm install。

在线版：[GitHub Pages](https://www886321-commits.github.io/silhouette-generator/)。中国大陆访问 GitHub 的速度可能波动，本地包运行不依赖它在线。

## 功能

- 人物/主体自动抠图，实体主体与纯色剪影均为实心轮廓；GPU / CPU-WASM 兼容降级，状态与错误反馈。
- 新照片默认原图挖空；背景可选内置九张、上传本地图片、颜色匹配、纯色或原图挖空。
- 上下、左右、剪影覆盖、残影布局，整组分区一键对调；四层拖拽排序、跨区叠加、画布自由变换。
- 多种画布比例、自定义大小、宽高比锁定、预览等比适应；推荐五色、自定义颜色、连续内外阴影调整。
- 彩色半调：圆点/方块/菱形/椭圆/线条，大小、角度、混合和锐度可调。
- 像素轮廓和可选散落文字，内容、密度、字号、颜色自定；纸纹/颗粒默认关闭。
- 画笔/橡皮默认 6、最小 1，可在实体主体和纯色剪影上修正；最多 15 步撤销/重做。
- PNG/JPG/WebP 1×/2×/4×、透明剪影 PNG、桌面 PSD 分层导出，作品不含 UI。高清按原图和对象重绘，不放大低清预览。

## 文档和源码

- [AI Agent 安装任务书](AGENT-INSTALL.md)
- [使用说明](docs/USER-GUIDE.md)
- [源码构建、安装器和 Pages 部署](docs/BUILDING.md)
- [开源许可证说明（非认证证书）](docs/OPEN-SOURCE-LICENSE.md)
- [完整 AGPL 许可证](LICENSE) · [第三方、模型和图片许可](THIRD-PARTY-NOTICES.md)

从仓库源码安装：使用 Node.js 22.12+ 或支持的新版本，运行 npm ci、npm run build，然后使用根目录 START-*。模型在 public/models 中；不要缺失此目录。src 是应用源码，scripts 是构建与安装器，public 是本地素材，vendor 提供未修改 AGPL 抠图依赖 1.7.0 的精确源码文本，licenses 提供许可原文及版本清单。

## 兼容和限制

当前以桌面为主，手机专门体验暂缓。Windows Chrome 实测自动抠图、离线模型、笔刷、图层、效果、整组对调及高清/PSD；Mac/Linux 启动脚本已提供，但不代表真机或所有浏览器均已测试。建议新版 Chrome/Edge，Safari/Firefox 兼容路径需按设备验证。

手指、发丝、遮挡仍可能需修正；多人为组合蒙版；PSD 为独立栅格层，散落文字并非 Photoshop 文字层。导出有像素/内存预算，PSD 限 1200 万像素。软件按现状提供，不附担保。

## 许可

Copyright © 2026 安鱼。程序为 **AGPL-3.0-only**，第三方库保留各自许可证；图片不自动变为 AGPL 授权，详见第三方声明。此前仓库只有 GPL-3.0 占位许可，本发行版为匹配现有 AGPL 依赖改用 AGPL-3.0。再分发请保留对应源码、许可证及来源，不将本程序宣传为闭源商用授权或官方认证产品。
