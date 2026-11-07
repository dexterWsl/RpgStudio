# rpgStudio

RPG Maker **MZ / MV** 的剧情编辑器。用来看懂一个游戏的剧情结构、改台词、加事件，不需要任何第三方依赖。

- 只在本机跑：只听 `127.0.0.1`，没有登录，没有账号。
- 无损：打开不改直接保存一定不改数据，改一句只动那一句；写盘前自动备份。
- 认识具体游戏之外的一切：约定写在 `profiles/` 里（`generic` 通用、`example` 示例）。

详细说明见 **[app/studio/README.md](app/studio/README.md)**（功能、地图编辑、剧情进度、场景、回想房、代码结构）。

## 直接使用（自带运行环境）

双击 **`启动.cmd`**。第一次用会先检查环境，然后自动打开 <http://127.0.0.1:8700/studio>。
导入游戏：选本机文件夹（复制一份 / 直接改原文件夹）或者上传 zip。

环境有问题时双击 **`检查环境.cmd`**，会一项项列出 Node.js、程序文件、data 能不能写、端口能不能用。
更多见 **[使用说明.txt](使用说明.txt)**。

## 从源码跑

需要 Node.js 18 以上。

```bash
# 直接改游戏目录（保存前自动备份）
node app/studio/server.js --project "D:\Games\我的游戏"

# 什么都不指定：打开后在「工程」里导入游戏
node app/studio/server.js
```

参数：`--port 8700`、`--host 127.0.0.1`、`--profile generic|example`、`--read-only`、`--projects <导入的游戏放哪>`。

回归测试（只读，需要一个 RPG Maker 工程）：

```bash
node app/studio/test/roundtrip.js "D:\Games\我的游戏"   # 改台词必须无损
node app/studio/test/progress.js  "D:\Games\我的游戏"   # 剧情进度自检
```

## 目录

```text
启动.cmd / 检查环境.cmd   本地版入口（Windows）
使用说明.txt              本地版使用说明
app/start.js              本地版启动器：检查环境 → 起服务 → 开浏览器
app/studio/               编辑器本体（server / handler / core / routes / profiles / web）
runtime/node/             本地版自带的 Node.js（不进仓库，发布时打进去）
tools/build-release.js    打发布包
data/                     你的东西：导入的游戏、备份、设置（不进仓库）
```

## 发布（做一个「下载就能用」的版本）

发布包 = `app/` + 两个 `.cmd` + 说明 + **一份 Node.js**，压成一个 zip。用户解压、双击 `启动.cmd`，什么都不用装。

仓库里**不放** `runtime/node/`（80 多 MB，还不该进 git），它在打包时才下载并塞进去。

### 自动发布（推荐）

`.github/workflows/release.yml` 已经配好：**打 tag 就出包**。

```bash
git tag v2026.11.04
git push origin v2026.11.04
```

Actions 会跑语法检查、打两个包、生成 `.sha256`，然后建一个 Release 把文件挂上去（附安装说明）。

也可以在仓库页面手动触发：Actions → 发布 → Run workflow。

### 本地打包

```bash
node tools/build-release.js                              # 用 app/version.json 的版本号，下载 Node 后打包
node tools/build-release.js --version v2026.11.04        # 指定版本（开头的 v 会去掉）
node tools/build-release.js --runtime .\runtime\node     # 不联网，直接用现成的 runtime\node
node tools/build-release.js --no-runtime --out dist-lite # 轻量包：不带 Node.js
```

产物在 `dist/`：

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `rpgStudio-<版本>-win-x64.zip` | ~33 MB | 自带 Node.js，Windows 解压即用 |
| `rpgStudio-<版本>-lite.zip` | ~0.3 MB | 只有编辑器，需要电脑上已装 Node.js 18+（跨平台） |
| `*.sha256` | | 校验和 |

打包时会自动用**打进去的那个 node** 跑一遍 `--check`（Node.js / 程序文件 / 数据目录 / 端口），不过就直接失败，不会产出坏包。zip 由编辑器自己的 `core/zip.js` 写（带 UTF-8 文件名标记，Windows 资源管理器解压中文名不会乱码）。

发布前记得：改 `app/version.json` 的 `version`（或打包时用 `--version` 覆盖）、补 `LICENSE`。

## 许可

[MIT](LICENSE)。发布包里另带 `runtime/node/LICENSE`（Node.js 自己的许可，OpenJS Foundation）。
