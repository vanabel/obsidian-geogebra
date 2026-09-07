import {
	App,
	FileSystemAdapter,
	Platform,
	Plugin,
	TFile,
	normalizePath,
	requestUrl,
} from "obsidian";
import type { GeoGebraPluginSettings } from "./settings";
import { stripWikiTarget } from "./settings";

/**
 * Embedding strategy:
 * - Excalidraw / Web Viewer: desktop external pages use Electron <webview>
 * - drawio: local 127.0.0.1 for CSP isolation (we use file:// runtime HTML instead)
 *
 * Sizing (evidence-based, not guessed):
 * 1. Electron webview docs require `display:inline-flex` with explicit width/height.
 *    Overwriting with `display:block` leaves guest content at a small default size
 *    in the top-left of a large host box:
 *    https://www.electronjs.org/docs/latest/api/webview-tag
 * 2. GeoGebra Apps API: after inject, call `ggbApplet.setSize(w, h)` from the
 *    container's offsetWidth/offsetHeight (official resize path):
 *    https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/
 */

export interface AppletOptions {
	settings: GeoGebraPluginSettings;
	height?: number;
	width?: number | string;
	appName?: GeoGebraPluginSettings["appName"];
	showToolBar?: boolean;
	showAlgebraInput?: boolean;
	showMenuBar?: boolean;
	ggbBase64?: string;
	materialId?: string;
	fillContainer?: boolean;
}

export interface MountContext {
	plugin: Plugin;
}

export interface MountedApplet {
	el: HTMLElement;
	revoke: () => void;
}

interface ElectronWebview extends HTMLElement {
	src: string;
	executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
}

export function resolveGgbFile(
	app: App,
	raw: string,
	sourcePath: string
): TFile {
	const name = stripWikiTarget(raw).replace(/\\/g, "/").replace(/^\.\//, "");
	if (!name) {
		throw new Error("未指定 .ggb 文件");
	}

	const fromLink = app.metadataCache.getFirstLinkpathDest(name, sourcePath);
	if (fromLink instanceof TFile) return fromLink;

	const byPath = app.vault.getAbstractFileByPath(normalizePath(name));
	if (byPath instanceof TFile) return byPath;

	const base = name.split("/").pop() ?? name;
	const stem = base.replace(/\.ggb$/i, "");
	const matches = app.vault
		.getFiles()
		.filter(
			(file) =>
				file.extension.toLowerCase() === "ggb" &&
				(file.name === base || file.basename === stem)
		);

	if (matches.length === 1) return matches[0];
	if (matches.length > 1) {
		const nearby = matches.find((file) =>
			sourcePath.startsWith(file.parent?.path ? `${file.parent.path}/` : "")
		);
		return nearby ?? matches[0];
	}

	throw new Error(`找不到文件: ${raw}`);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

export function resolvedHeight(
	options: Pick<AppletOptions, "height" | "settings">
): number {
	return options.height ?? options.settings.height;
}

export function parseHeightHint(el: HTMLElement, fallback: number): number {
	const attr =
		el.getAttribute("height") ||
		el.getAttribute("alt") ||
		el.getAttribute("width");
	if (!attr) return fallback;
	const match = attr.match(/(\d{2,4})/);
	if (!match) return fallback;
	const value = Number(match[1]);
	return Number.isFinite(value) && value > 80 ? value : fallback;
}

export async function mountGeoGebraApplet(
	container: HTMLElement,
	options: AppletOptions,
	ctx: MountContext
): Promise<MountedApplet> {
	if (!Platform.isDesktopApp) {
		throw new Error(
			"交互式 GeoGebra 目前仅支持桌面端（需 Electron webview，与 Excalidraw/Web Viewer 相同）。"
		);
	}

	const adapter = ctx.plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error("当前 vault 不是本地文件系统，无法创建 GeoGebra runtime。");
	}

	const height = resolvedHeight(options);

	container.empty();
	container.addClass("geogebra-embed");
	container.style.display = "block";
	container.style.width = "100%";
	container.style.position = "relative";
	container.style.background = "#fff";
	container.style.overflow = "hidden";
	if (options.fillContainer) {
		container.style.height = "100%";
	} else {
		container.style.height = `${height}px`;
		container.style.minHeight = `${height}px`;
	}

	const status = container.createDiv({ cls: "geogebra-status" });
	status.setText("正在加载 GeoGebra…");
	status.style.position = "absolute";
	status.style.inset = "0";
	status.style.zIndex = "2";
	status.style.pointerEvents = "none";

	const webview = createWebviewElement();
	if (!webview) {
		throw new Error(
			"当前 Obsidian 未启用 Electron webview。请使用桌面版 Obsidian（与 Excalidraw 外链嵌入相同依赖）。"
		);
	}

	webview.className = "geogebra-webview";
	webview.setAttribute("allowpopups", "");
	webview.setAttribute(
		"webpreferences",
		"autoplayPolicy=document-user-activation-required"
	);
	container.appendChild(webview);

	await new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	);

	const measure = (): { w: number; h: number } => {
		const w = Math.max(
			Math.floor(
				container.clientWidth || container.getBoundingClientRect().width
			),
			320
		);
		const h = Math.max(
			Math.floor(
				container.clientHeight ||
					container.getBoundingClientRect().height ||
					height
			),
			height
		);
		return { w, h };
	};

	/**
	 * Electron webview-tag docs: use display:inline-flex + explicit px size.
	 * Never use display:block — guest content then fails to fill the host box.
	 */
	const applyWebviewBox = (w: number, h: number) => {
		webview.style.display = "inline-flex";
		webview.style.position = "absolute";
		webview.style.left = "0";
		webview.style.top = "0";
		webview.style.border = "0";
		webview.style.background = "#fff";
		webview.style.width = `${w}px`;
		webview.style.height = `${h}px`;
	};

	let { w: boxW, h: boxH } = measure();
	applyWebviewBox(boxW, boxH);

	const cleanups: Array<() => void> = [];
	let revoked = false;
	let webviewReady = false;
	const clearStatus = () => {
		if (status.isConnected) status.remove();
	};

	const syncSize = () => {
		if (revoked || !webview.isConnected) return;
		const { w, h } = measure();
		boxW = w;
		boxH = h;
		applyWebviewBox(w, h);
		if (!webviewReady || w < 2 || h < 2) return;
		// GeoGebra Apps API setSize — official way to change applet pixel size.
		void webview
			.executeJavaScript(
				`(function(){
  var w=${w}, h=${h};
  try {
    if (window.ggbApplet && typeof window.ggbApplet.setSize === "function") {
      window.ggbApplet.setSize(w, h);
    }
  } catch (e) {}
  try { window.dispatchEvent(new Event("resize")); } catch (e) {}
  return {w:w,h:h,iw:window.innerWidth,ih:window.innerHeight};
})()`,
				false
			)
			.catch(() => undefined);
	};

	const markReady = () => {
		webviewReady = true;
		clearStatus();
		syncSize();
		window.setTimeout(() => syncSize(), 300);
		window.setTimeout(() => syncSize(), 1000);
	};

	const ro = new ResizeObserver(() => syncSize());
	ro.observe(container);
	cleanups.push(() => ro.disconnect());

	if (options.materialId && !options.ggbBase64) {
		webview.src = buildMaterialEmbedUrl(
			options.materialId,
			boxW,
			boxH,
			options
		);
		wireWebviewReady(webview, markReady, cleanups, () => revoked);
		return {
			el: webview,
			revoke: () => {
				revoked = true;
				runCleanups(cleanups);
				webview.remove();
			},
		};
	}

	const html = buildAppletHtml(options, boxW, boxH);
	const runtime = await writeRuntimeHtml(ctx.plugin, adapter, html);
	cleanups.push(runtime.cleanup);

	webview.src = runtime.fileUrl;
	wireWebviewReady(webview, markReady, cleanups, () => revoked);

	const safety = window.setTimeout(() => markReady(), 8000);
	cleanups.push(() => window.clearTimeout(safety));

	return {
		el: webview,
		revoke: () => {
			revoked = true;
			runCleanups(cleanups);
			webview.remove();
		},
	};
}

/** @deprecated use mountGeoGebraApplet */
export const mountGeoGebraIframe = mountGeoGebraApplet;

function createWebviewElement(): ElectronWebview | null {
	const el = document.createElement("webview") as ElectronWebview;
	if (el.tagName.toUpperCase() !== "WEBVIEW") {
		return null;
	}
	return el;
}

function wireWebviewReady(
	webview: ElectronWebview,
	onReady: () => void,
	cleanups: Array<() => void>,
	isRevoked: () => boolean
): void {
	let signaled = false;
	const markReady = () => {
		if (isRevoked() || signaled) return;
		signaled = true;
		onReady();
	};

	const onDomReady = () => {
		markReady();
	};
	webview.addEventListener("dom-ready", onDomReady);
	webview.addEventListener("did-finish-load", onDomReady);
	cleanups.push(() => {
		webview.removeEventListener("dom-ready", onDomReady);
		webview.removeEventListener("did-finish-load", onDomReady);
	});
}

function runCleanups(cleanups: Array<() => void>): void {
	for (const fn of cleanups.splice(0)) {
		try {
			fn();
		} catch {
			// ignore
		}
	}
}

async function writeRuntimeHtml(
	plugin: Plugin,
	adapter: FileSystemAdapter,
	html: string
): Promise<{ fileUrl: string; cleanup: () => void }> {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const path = require("path") as typeof import("path");
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const fs = require("fs") as typeof import("fs");
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { pathToFileURL } = require("url") as typeof import("url");

	const pluginDirName = plugin.manifest.dir;
	if (!pluginDirName) {
		throw new Error("无法解析插件目录（manifest.dir 为空）");
	}
	const pluginDir = path.join(adapter.getBasePath(), pluginDirName);
	const runtimeDir = path.join(pluginDir, ".runtime");
	fs.mkdirSync(runtimeDir, { recursive: true });

	const fileName = `ggb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`;
	const filePath = path.join(runtimeDir, fileName);
	fs.writeFileSync(filePath, html, "utf8");

	try {
		const files = fs
			.readdirSync(runtimeDir)
			.filter((name) => name.startsWith("ggb-") && name.endsWith(".html"))
			.map((name) => ({
				name,
				mtime: fs.statSync(path.join(runtimeDir, name)).mtimeMs,
			}))
			.sort((a, b) => b.mtime - a.mtime);
		for (const stale of files.slice(20)) {
			try {
				fs.unlinkSync(path.join(runtimeDir, stale.name));
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}

	return {
		fileUrl: pathToFileURL(filePath).href,
		cleanup: () => {
			try {
				fs.unlinkSync(filePath);
			} catch {
				// ignore
			}
		},
	};
}

function buildMaterialEmbedUrl(
	materialId: string,
	width: number,
	height: number,
	options: AppletOptions
): string {
	const { settings } = options;
	const ai = (options.showAlgebraInput ?? settings.showAlgebraInput)
		? "true"
		: "false";
	const stb = (options.showToolBar ?? settings.showToolBar) ? "true" : "false";
	const smb = (options.showMenuBar ?? settings.showMenuBar) ? "true" : "false";
	return (
		`https://www.geogebra.org/material/iframe/id/${encodeURIComponent(materialId)}` +
		`/width/${width}/height/${height}/border/888888` +
		`/rc/${settings.enableRightClick}/ai/${ai}/sdz/${settings.enableShiftDragZoom}` +
		`/smb/${smb}/stb/${stb}/stbh/false/ld/false/sri/${settings.showResetIcon}`
	);
}

/**
 * Guest page: fixed design size at inject, then setSize from host + local
 * ResizeObserver on #ggb-host (GeoGebra Apps API pattern).
 */
function buildAppletHtml(
	options: AppletOptions,
	width: number,
	height: number
): string {
	const { settings } = options;
	const params: Record<string, unknown> = {
		appName: options.appName ?? settings.appName,
		width,
		height,
		showToolBar: options.showToolBar ?? settings.showToolBar,
		showAlgebraInput: options.showAlgebraInput ?? settings.showAlgebraInput,
		showMenuBar: options.showMenuBar ?? settings.showMenuBar,
		enableRightClick: settings.enableRightClick,
		enableShiftDragZoom: settings.enableShiftDragZoom,
		showResetIcon: settings.showResetIcon,
		language: "zh",
		preventFocus: false,
		borderColor: null,
		autoHeight: false,
	};

	if (options.ggbBase64) {
		params.ggbBase64 = options.ggbBase64;
	}
	if (options.materialId) {
		params.material_id = options.materialId;
	}

	const scriptUrl = JSON.stringify(settings.deployScriptUrl);
	const paramsJson = JSON.stringify(params);
	const fallbackW = JSON.stringify(width);
	const fallbackH = JSON.stringify(height);

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GeoGebra</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #fff;
  }
  #ggb-host, #ggb {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }
</style>
<script src=${scriptUrl}></script>
</head>
<body>
<div id="ggb-host">
  <div id="ggb"></div>
</div>
<script>
(function () {
  function fail(msg) {
    document.body.textContent = msg;
    document.body.style.padding = "16px";
    document.body.style.fontFamily = "sans-serif";
    document.body.style.color = "#b00020";
  }
  function hostSize() {
    var host = document.getElementById("ggb-host");
    var w = host ? host.clientWidth : 0;
    var h = host ? host.clientHeight : 0;
    return {
      w: Math.max(Math.floor(w || window.innerWidth || ${fallbackW}), 100),
      h: Math.max(Math.floor(h || window.innerHeight || ${fallbackH}), 100)
    };
  }
  function applySize(api) {
    var s = hostSize();
    try {
      if (api && typeof api.setSize === "function") api.setSize(s.w, s.h);
      else if (window.ggbApplet && typeof window.ggbApplet.setSize === "function") {
        window.ggbApplet.setSize(s.w, s.h);
      }
    } catch (e) {}
  }
  try {
    var params = ${paramsJson};
    var initial = hostSize();
    params.width = Math.max(initial.w, ${fallbackW});
    params.height = Math.max(initial.h, ${fallbackH});
    params.appletOnLoad = function (api) {
      applySize(api);
      document.documentElement.setAttribute("data-ggb-ready", "1");
    };
    if (typeof GGBApplet !== "function") {
      fail("无法加载 GeoGebra 引擎，请检查网络是否能访问 geogebra.org");
      return;
    }
    var applet = new GGBApplet(params, true);
    applet.inject("ggb");
    window.addEventListener("resize", function () { applySize(window.ggbApplet); });
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(function () { applySize(window.ggbApplet); });
      var host = document.getElementById("ggb-host");
      if (host) ro.observe(host);
    }
  } catch (err) {
    fail(String(err && err.message ? err.message : err));
  }
})();
</script>
</body>
</html>`;
}

export function isDesktopVault(app: App): boolean {
	return Platform.isDesktopApp && app.vault.adapter instanceof FileSystemAdapter;
}

export async function probeDeployScript(url: string): Promise<boolean> {
	try {
		await requestUrl({ url });
		return true;
	} catch {
		return false;
	}
}
