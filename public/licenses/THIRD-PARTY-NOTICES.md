# 许可、来源与版权声明

剪影生成器 v1.2.0，Copyright © 2026 安鱼（Anyu）。项目程序采用 **AGPL-3.0-only**，完整条款见 LICENSE。修改与再分发请按许可证提供对应源码、保留版权及许可声明；软件按现状提供，不承诺准确抠图或任何特定用途，不提供担保。这里是开源许可证，不是官方认证证书，也不是专有软件使用授权。

## 软件与模型

- @imgly/background-removal 1.7.0：AGPL-3.0；未修改。精确版本的原始源码文本、完整源映射、包元信息和许可在 vendor/imgly-background-removal-1.7.0；官方项目 https://github.com/imgly/background-removal-js 。
- React / React DOM、Phosphor Icons、ag-psd、ONNX Runtime 及其他依赖：保留其各自原许可证，不将第三方代码重新声明为项目原创。完整依赖版本与声明见 licenses/DEPENDENCY-LICENSES.json，发现的许可原文见 licenses/npm。
- IS-Net / DIS 模型与 WASM 文件来自 IMG.LY 锁定的 1.7.0 数据包：https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/ 。未分发训练数据集。供应方 ThirdPartyLicenses.json 将 ISNET 标为 MIT，上游 DIS 仓库当前声明 Apache-2.0；原供应方声明和上游 Apache-2.0 原文均保留，不擅自将其改为项目 AGPL 作品。上游 https://github.com/xuebinqin/DIS 。
- source / src、锁文件、构建和安装脚本属于对应源码交付。第三方库按锁定版本从官方 npm 分发获取；AGPL 依赖另附精确源码快照。作者链接只是外链，不参与照片处理。

## 九张内置背景（不属于程序 AGPL 许可）

图片与其缩略图按各自素材许可使用，不得据程序 LICENSE 声称取得图片版权。前五张由用户提供的 Unsplash 文件，来源记录如下；适用 [Unsplash License](https://unsplash.com/license)，允许复制、使用及分发，但禁止未经明显修改直接销售图片或汇集图片复制竞争图库。

| 项目文件 | 摄影师/提供者 | 原图来源 |
| --- | --- | --- |
| cloud-sea.jpg | Taylor Van Riper | https://unsplash.com/photos/yQorCngxzwI |
| soft-sky.jpg | Uriel | https://unsplash.com/photos/xtgONQzGgOE |
| golden-sea.jpg | Rafael Garcin | https://unsplash.com/photos/EFb-V85HuAA |
| green-field.jpg | Rodion Kutsaiev | https://unsplash.com/photos/PEm_sLmJT-w |
| pink-cloud.jpg | Szabo Viktor | https://unsplash.com/photos/28ZbKOWiZfs |
| empty-grass.png | 安鱼提供并确认可公开分发 | 整片草地 |
| school-hall.png | 安鱼提供并确认可公开分发 | 老教学楼大厅 |
| concrete-coast.png | 安鱼提供并确认可公开分发 | 海边混凝土岸 |
| school-field.png | 安鱼提供并确认可公开分发 | 操场草地天空 |

2026-10-13：提供者确认后四张可随本项目、安装包公开分发和使用；这项确认不构成对未知第三方素材的权利担保，也不等同于对图库转售的额外授权。安鱼的品牌标识及二维码可随本工具展示，不表示向第三方授予商标权或为其背书。用户自己上传的照片仍属于其相应权利人；本工具不主动上传、收集或公开这些照片。
