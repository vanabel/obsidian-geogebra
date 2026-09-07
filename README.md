# GeoGebra for Obsidian

Embed interactive local GeoGebra (`.ggb`) constructions in Obsidian notes without uploading them to GeoGebra.org.

**Desktop only** (requires Electron `webview`). Loading the applet needs network access to `https://www.geogebra.org`.

在 Obsidian 笔记中直接嵌入并交互本地 `.ggb` 文件，无需先上传到 GeoGebra 网站。

> **桌面端专用**（依赖 Electron `webview`）。首次加载需能访问 `https://www.geogebra.org`。

## Install / 安装

> 插件 id 为 `geogebra`，安装目录必须是 `.obsidian/plugins/geogebra/`。  
> 若你之前装过 `obsidian-geogebra` 目录，请删掉旧目录后按下面重装（设置不会自动迁移）。

### 手动安装（推荐）

1. 打开 [Releases](https://github.com/vanabel/obsidian-geogebra/releases)，下载最新版的：
   - `geogebra-x.y.z.zip`，**或**
   - `main.js`、`manifest.json`、`styles.css` 三个文件
2. 解压 / 复制到你的库：

```text
你的库/.obsidian/plugins/geogebra/
```

3. Obsidian → 设置 → 社区插件 → 关闭安全模式 → 刷新 → 启用 **GeoGebra**。

### 用 BRAT

1. 安装社区插件 [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. BRAT → Add Beta plugin → 填入：

```text
https://github.com/vanabel/obsidian-geogebra
```

3. 启用 **GeoGebra**

### 从源码构建

1. 构建插件：

```bash
cd obsidian-geogebra
npm install
npm run build
```

2. 把构建产物放到 vault（目录名必须是 `geogebra`）：

```bash
mkdir -p "/你的库/.obsidian/plugins/geogebra"
cp main.js manifest.json styles.css "/你的库/.obsidian/plugins/geogebra/"
```

或符号链接开发目录到 `plugins/geogebra`（链接名也要是 `geogebra`）。

确保该目录里有：

- `main.js`（构建生成）
- `manifest.json`
- `styles.css`

3. 打开 Obsidian → 设置 → 社区插件 → 关闭安全模式 → 启用 **GeoGebra**。

开发时可改用：

```bash
npm run dev
```

改代码后会自动重新打包 `main.js`，在 Obsidian 里用「重新加载应用」或禁用/启用插件即可。

### 提交官方社区目录

仓库与 Release 准备好后，到 [community.obsidian.md](https://community.obsidian.md) 登录 → 绑定 GitHub → 添加本仓库。详见 [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)。

## 功能

- 拖入 / 粘贴 `.ggb` → 自动保存到库并插入 `![[…]]` 嵌入（不是普通双向链接）
- `![[demo.ggb]]` 维基嵌入（阅读视图 / 实时预览）
- `ggb` / `geogebra` 代码块（高度、工具栏、代数区、样式栏等）
- 在文件列表打开 `.ggb`，在专用视图中全屏交互
- 本地构造可 **重置 / 保存** 写回 `.ggb`（图形区右上角竖排按钮）
- 也可嵌入已发布的 `material_id`（远端材料不能直接覆盖保存）
- 修改插件设置后，已打开的 applet **自动重挂载**，无需 Reload 插件

## 用法

### 拖入文件

把 `.ggb` 拖到笔记编辑器中。默认会：

1. 复制到 `GeoGebra/` 附件目录（可在设置里改）
2. 插入 `![[GeoGebra/xxx.ggb]]`

关闭设置里的「Prefer wiki embed on drop」则改为插入代码块。

拖入 / 粘贴 `.ggb` 时插件会拦截默认行为，直接插入 `![[文件名.ggb]]`（嵌入，不是双向链接 `[[...]]`）。

### 代码块

代码块里可以直接写文件名：

````markdown
```ggb
GGB-14-01-01-密克圆-三角形.ggb
```
````

也可以写完整参数：

````markdown
```geogebra
file: GeoGebra/demo.ggb
height: 520
toolbar: true
algebra: true
algebraView: show
menu: true
styleBar: true
app: classic
```
````

也支持发布材料：

````markdown
```geogebra
material_id: RHYH3UQ8
height: 480
```
````

可用键：`file` / `material_id` / `height` / `width` / `app` / `toolbar` / `algebra`（底部输入栏）/ `algebraView`（`auto`|`show`|`hide` 左侧代数区）/ `menu` / `styleBar`。

说明：

- `algebra` = 底部命令输入行；`algebraView` = 左侧代数区（对象列表）。`auto` 表示保留 `.ggb` 文件里保存的布局。
- 坐标轴 / 网格：请用图形区 **样式栏**（设置里默认开启 Allow style bar），或打开菜单栏后「选项 → 图形区」。右键菜单在 Electron webview 里经常不可用，**默认关闭右键**。
- 运行时切换代数区：开菜单栏后用「视图 → 代数」，或在设置 / 代码块里设 `algebraView`。

### 重置与保存

本地 `.ggb`（维基嵌入、代码块、文件视图）在图形区右上角、「显示/隐藏样式栏」下方竖排：

| 按钮 | 作用 |
|------|------|
| **重置** | `ggbApplet.reset()`，恢复到打开时的构造 |
| **保存** | `getBase64()` 后写回库内原 `.ggb` 文件 |

开启保存栏时会隐藏 GeoGebra 自带重置图标，避免重叠。可用设置 **Show save button** 关闭整组按钮。纯 `material_id` 远端材料没有本地文件可写，不显示该栏。

### 打开文件

在文件列表中点击 `.ggb`，会在 GeoGebra 视图中打开。

## 设置

修改下列与 applet 相关的选项后，当前已打开的视图 / 嵌入会自动按新设置重挂载（未点「保存」的画布改动会丢失）。

| 选项 | 说明 | 默认 |
|------|------|------|
| Default height | 嵌入默认高度（px） | `640` |
| App type | classic / graphing / geometry / 3d / suite | classic |
| Show toolbar | 顶部工具栏 | 开 |
| Show algebra input | 底部命令输入栏 | 开 |
| Algebra view panel | 左侧代数区：`auto` 跟文件 / `show` / `hide` | auto |
| Show menu bar | 菜单栏（视图 → 代数、选项 → 图形区等） | 关 |
| Allow style bar | 图形区样式栏（坐标轴 / 网格等） | 开 |
| Enable right-click | webview 里经常不可用；建议关，改用样式栏 | **关** |
| Enable shift-drag zoom | Shift+拖动缩放 | 开 |
| Show reset icon | GeoGebra 自带角标重置（开启保存栏时会被隐藏） | 开 |
| Show save button | 样式栏下方竖排「重置 / 保存」 | 开 |
| Attachment folder | 拖入外部 `.ggb` 时的保存目录 | `GeoGebra` |
| Prefer wiki embed on drop | 拖入时插入 `![[…]]` 而非代码块 | 开 |
| deployggb.js URL | CDN 或自托管 GeoGebra 加载脚本 | geogebra.org CDN |

## 说明

- 桌面端通过 Electron `<webview>` 加载本地 runtime HTML（与 Excalidraw 外链嵌入、Copilot/Web Viewer 同一隔离模型），因此不受 Obsidian 页面 CSP 拦截 GeoGebra CDN 样式。
- `.ggb` 数据留在本地；引擎 JS/CSS 仍从 `geogebra.org` 加载（需联网）。
- `isDesktopOnly`：移动端暂不支持交互嵌入。
- 插件目录名必须是 `geogebra`（与 `manifest.json` 的 `id` 一致），否则 Obsidian 不会正确加载。

## 相对 0.3.3 的变更

- 代数区面板设置（`showAlgebraView` / 代码块 `algebraView`）
- 默认开启样式栏；默认关闭右键（webview 对话框不可靠）
- 本地 `.ggb` 竖排 **重置 / 保存**，写回原文件
- 改设置后自动重挂载已打开的 applet，无需 Reload 插件

## 许可

MIT
