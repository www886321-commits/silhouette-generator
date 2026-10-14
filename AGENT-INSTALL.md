# AI Agent 本地安装任务书｜剪影生成器 v1.3.1

## 用户一句话

请把这个剪影生成器工具包完整解压并安装到我的电脑，按 AGENT-INSTALL.md 检查运行环境，启动本地网页，验证上传照片、原图挖空与 PNG 导出，然后告诉我以后如何启动和停止；不要部署到服务器，也不要上传我的照片。

## Agent 执行规则

1. 先检查完整解压。路径允许中文和空格；避免系统目录和临时下载缓存。不要覆盖用户以前的安装目录，除非用户明确要求更新。安装位置按当前 Agent 的权限和用户偏好决定。
2. 成品包应有 app/index.html、app/models/resources.json、app/backgrounds、LICENSE、source、START-* 和 local-server.*。不要双击 HTML，不要使用 file://。
3. 优先使用已安装的 Node.js（推荐仍受支持的 LTS）；其次 Python 3.8+。两者均缺少时，按当前 Agent 的授权流程从 Node.js 官方网站安装受支持的 LTS。禁止要求用户关闭安全软件、关闭系统保护或放行旧 PowerShell 启动脚本。此包不包含 Windows 自启动项、计划任务或 PowerShell 隐藏启动脚本。
4. Windows 运行 START-WINDOWS.cmd；Mac 为 START-MAC.command / STOP-MAC.command 赋予执行权限后启动；Linux 为 START-LINUX.sh / STOP-LINUX.sh 赋予执行权限后启动。成功后启动窗口自动退出，本地静态服务器在后台运行。自动打开失败时使用输出的 http://127.0.0.1:端口/ 。默认在 4173–4193 找空闲端口，只监听本机。
5. 成品包无需 npm install。识别模型和九张背景全部内置，首次照片识别也无需联网。依赖安装阶段需要网络；这是安装运行时或从源码构建的需要，不是照片处理需要。
6. 若使用 GitHub 源码 ZIP 而不是 Releases 成品包：根目录有 src / public / package.json，而没有 app；先安装满足 Vite 7 的 Node.js（22.12+ 或支持的更新版本），再在项目根目录 npm ci、npm run build。确认 dist/index.html 和 dist/models/resources.json 后，使用同一 START-*。模型已随源码携带；不要再从网络拉模型。锁文件与 npm 包下载需要网络。
7. 验收：服务器健康端点 /__afterimage_health 返回 tool=afterimage；背景九张可加载；入口不是空白；选择用户允许的测试照片，生成后默认原图挖空；实体主体和纯色剪影可变换；上下或左右整组对调两次恢复；导出 PNG 不带 UI。不要默认上传测试照片、导出文件或日志到任何服务。
8. 停止：运行对应 STOP-*；它只停止当前文件夹通过校验的本地服务，不杀掉其他程序。启动器支持再次打开复用本目录服务。重启电脑后重新启动，不设置开机自启。
9. 失败时保留错误信息。检查是否解压完整、运行时可用、端口是否全被占用、浏览器是否过旧；模型错误时尝试 CPU 兼容重试。动态模块失效先刷新网页。startup.log 只在安装目录本地生成，不自动上传。不要恢复历史版本的 start-windows.ps1。

## 源码修改

source 为应用和安装器源码，AGPL 依赖的精确源码快照在 source/vendor。成品中的模型位于 app/models；离线重建时复制该目录到 source/public/models，再 npm ci、npm run build。构建结果替换本次安装的 app 时，先停止服务，并按用户要求保留其旧安装目录；不要无条件删除旧版本。

公开再分发必须保留 LICENSE、THIRD-PARTY-NOTICES.md、licenses 和对应源码。没有官方认证证书，不得宣传绝对无误抠图、所有电脑无条件兼容或授权闭源商用。
