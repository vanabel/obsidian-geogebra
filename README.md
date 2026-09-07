# GeoGebra for Obsidian

在 Obsidian 笔记中直接嵌入并交互 `.ggb` 文件，无需先上传到 GeoGebra 网站。

## 功能

- 拖入 / 粘贴 `.ggb` → 自动保存到库并插入嵌入
- `![[demo.ggb]]` 维基嵌入（阅读视图 / 实时预览）
- ` ```geogebra ` 代码块（可调高度、工具栏等）
- 双击打开 `.ggb` 文件，在专用视图中交互
- 也可嵌入已发布的 `material_id`

## 本地安装（开发测试）

1. 构建插件：

```bash
cd obsidian-geogebra
npm install
npm run build
```

2. 把插件目录链到你的 vault（或复制构建产物）：

```bash
# 推荐：符号链接整个开发目录
ln -s "/绝对路径/obsidian-geogebra" \
  "/你的库/.obsidian/plugins/obsidian-geogebra"
```

确保该目录里有：

- `main.js`（构建生成）
- `manifest.json`
- `styles.css`

3. 打开 Obsidian → 设置 → 社区插件 → 关闭安全模式 → 启用 **GeoGebra**。

4. 首次加载 applet 需要能访问 `https://www.geogebra.org`（加载 `deployggb.js`）。

开发时可改用：

```bash
npm run dev
```

改代码后会自动重新打包 `main.js`，在 Obsidian 里用「重新加载应用」或禁用/启用插件即可。

## 用法

### 拖入文件

把 `.ggb` 拖到笔记编辑器中。默认会：

1. 复制到 `GeoGebra/` 附件目录（可在设置里改）
2. 插入 `![[GeoGebra/xxx.ggb]]`

关闭设置里的「Prefer wiki embed on drop」则改为插入代码块。

拖入 `.ggb` 会插入 `![[文件名.ggb]]`（嵌入，不是双向链接）。

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

可用键：`file` / `material_id` / `height` / `width` / `app` / `toolbar` / `algebra` / `menu`。

### 打开文件

在文件列表中点击 `.ggb`，会在 GeoGebra 视图中打开。

## 设置

| 选项 | 说明 |
|------|------|
| Default height | 默认高度（px） |
| App type | classic / graphing / geometry / 3d / suite |
| Attachment folder | 拖入外部文件时的保存目录 |
| deployggb.js URL | CDN 或自托管脚本地址 |

## 说明

- 桌面端通过 Electron `<webview>` 加载本地 runtime HTML（与 Excalidraw 外链嵌入、Copilot/Web Viewer 同一隔离模型），因此不受 Obsidian 页面 CSP 拦截 GeoGebra CDN 样式。
- `.ggb` 数据留在本地；引擎 JS/CSS 仍从 `geogebra.org` 加载（需联网）。
- `isDesktopOnly`：移动端暂不支持交互嵌入。

## 许可

MIT
