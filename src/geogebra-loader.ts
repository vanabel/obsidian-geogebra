import {
	App,
	FileSystemAdapter,
	Notice,
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
 *    https://www.electronjs.org/docs/latest/api/webview-tag
 * 2. GeoGebra Apps API: `ggbApplet.setSize(w, h)` from the container box.
 *    https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/
 */

export interface AppletOptions {
	settings: GeoGebraPluginSettings;
	height?: number;
	width?: number | string;
	appName?: GeoGebraPluginSettings["appName"];
	showToolBar?: boolean;
	showAlgebraInput?: boolean;
	showAlgebraView?: "auto" | "show" | "hide";
	showMenuBar?: boolean;
	allowStyleBar?: boolean;
	ggbBase64?: string;
	materialId?: string;
	fillContainer?: boolean;
	/** Local vault file to overwrite when the user clicks Save. */
	saveFile?: TFile;
}

export interface MountContext {
	plugin: Plugin;
}

export interface MountedApplet {
	el: HTMLElement;
	revoke: () => void;
	/** Export current construction as base64 .ggb (local applet only). */
	getBase64: () => Promise<string>;
	/** Write current construction back to saveFile, if available. */
	save: () => Promise<void>;
	canSave: boolean;
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

	// Prefer an explicit vault path over scanning the whole vault.
	throw new Error(
		`找不到文件: ${raw}（请使用库内完整路径，例如 GeoGebra/demo.ggb）`
	);
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

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
	const cleaned = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
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
	if (options.fillContainer) {
		container.addClass("geogebra-embed-fill");
		container.removeClass("geogebra-embed-fixed");
		container.setCssProps({ "--geogebra-height": "100%" });
	} else {
		container.addClass("geogebra-embed-fixed");
		container.removeClass("geogebra-embed-fill");
		container.setCssProps({ "--geogebra-height": `${height}px` });
	}

	const canSave = Boolean(options.saveFile && options.settings.showSaveButton);
	/** Host chrome owns Reset when Save is shown, so hide GeoGebra's corner reset icon. */
	const hostOwnsReset = canSave;
	const effectiveOptions: AppletOptions = hostOwnsReset
		? {
				...options,
				settings: { ...options.settings, showResetIcon: false },
			}
		: options;

	const status = container.createDiv({ cls: "geogebra-status geogebra-status-overlay" });
	status.setText("正在加载 GeoGebra…");

	const stage = container.createDiv({ cls: "geogebra-stage" });

	const webview = createWebviewElement();
	if (!webview) {
		throw new Error(
			"当前 Obsidian 未启用 Electron webview。请使用桌面版 Obsidian（与 Excalidraw 外链嵌入相同依赖）。"
		);
	}

	webview.addClass("geogebra-webview");
	webview.setAttribute("allowpopups", "");
	webview.setAttribute(
		"webpreferences",
		"autoplayPolicy=document-user-activation-required"
	);
	stage.appendChild(webview);

	await new Promise<void>((resolve) =>
		window.requestAnimationFrame(() =>
			window.requestAnimationFrame(() => resolve())
		)
	);

	const measure = (): { w: number; h: number } => {
		const box = stage;
		const w = Math.max(
			Math.floor(box.clientWidth || box.getBoundingClientRect().width),
			320
		);
		const h = Math.max(
			Math.floor(
				box.clientHeight ||
					box.getBoundingClientRect().height ||
					height
			),
			120
		);
		return { w, h };
	};

	/**
	 * Electron webview-tag docs: use display:inline-flex + explicit px size.
	 * Never use display:block — guest content then fails to fill the host box.
	 */
	const applyWebviewBox = (w: number, h: number) => {
		webview.setCssProps({
			"--geogebra-webview-width": `${w}px`,
			"--geogebra-webview-height": `${h}px`,
		});
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
	ro.observe(stage);
	cleanups.push(() => ro.disconnect());

	const getBase64 = async (): Promise<string> => {
		if (revoked || !webview.isConnected) {
			throw new Error("GeoGebra 已卸载，无法导出");
		}
		const result = await webview.executeJavaScript(
			`(function () {
  return new Promise(function (resolve, reject) {
    try {
      var api = window.ggbApplet;
      if (!api || typeof api.getBase64 !== "function") {
        reject(new Error("GeoGebra API 尚未就绪"));
        return;
      }
      var done = false;
      var finish = function (value) {
        if (done) return;
        done = true;
        if (typeof value === "string" && value.length > 0) resolve(value);
        else reject(new Error("getBase64 返回为空"));
      };
      try {
        api.getBase64(function (b64) { finish(b64); });
      } catch (err) {
        try {
          finish(api.getBase64());
        } catch (err2) {
          reject(err2);
        }
      }
      window.setTimeout(function () {
        if (!done) reject(new Error("导出 .ggb 超时"));
      }, 20000);
    } catch (e) {
      reject(e);
    }
  });
})()`,
			true
		);
		if (typeof result !== "string" || !result) {
			throw new Error("无法导出当前构造");
		}
		return result;
	};

	const reset = async (): Promise<void> => {
		if (revoked || !webview.isConnected) {
			throw new Error("GeoGebra 已卸载，无法重置");
		}
		await webview.executeJavaScript(
			`(function () {
  var api = window.ggbApplet;
  if (!api || typeof api.reset !== "function") {
    throw new Error("GeoGebra API 尚未就绪");
  }
  api.reset();
  return true;
})()`,
			true
		);
	};

	const save = async (): Promise<void> => {
		const file = options.saveFile;
		if (!file) {
			throw new Error("当前嵌入没有可写入的本地 .ggb 文件（远端 material 无法直接覆盖）");
		}
		const b64 = await getBase64();
		const buffer = base64ToArrayBuffer(b64);
		await ctx.plugin.app.vault.modifyBinary(file, buffer);
	};

	const attachSideActions = () => {
		if (!canSave) return;
		/** Vertical stack under GeoGebra's style-bar toggle (graphics top-right). */
		const actions = container.createDiv({ cls: "geogebra-side-actions" });
		actions.setAttr(
			"title",
			"位于「显示/隐藏样式栏」下方：重置与保存"
		);

		const resetBtn = actions.createEl("button", {
			cls: "geogebra-action-btn",
			text: "重置",
			attr: {
				type: "button",
				title: "恢复到打开时的构造（与 GeoGebra 重置图标相同）",
			},
		});
		const saveBtn = actions.createEl("button", {
			cls: "geogebra-action-btn",
			text: "保存",
			attr: {
				type: "button",
				title: `保存到 ${options.saveFile?.path ?? ".ggb"}`,
			},
		});

		let busy = false;
		const run = (
			btn: HTMLButtonElement,
			label: string,
			work: () => Promise<void>,
			okText: string,
			okNotice: string
		) => {
			btn.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				if (busy) return;
				busy = true;
				resetBtn.disabled = true;
				saveBtn.disabled = true;
				btn.setText(`${label}中…`);
				void (async () => {
					try {
						await work();
						new Notice(okNotice);
						btn.setText(okText);
						window.setTimeout(() => {
							if (btn.isConnected) btn.setText(label);
						}, 1200);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						new Notice(`GeoGebra ${label}失败: ${message}`);
						btn.setText(label);
					} finally {
						busy = false;
						if (resetBtn.isConnected) resetBtn.disabled = false;
						if (saveBtn.isConnected) saveBtn.disabled = false;
					}
				})();
			});
		};

		run(
			resetBtn,
			"重置",
			reset,
			"已重置",
			`GeoGebra: 已重置 ${options.saveFile?.name ?? ""}`
		);
		run(
			saveBtn,
			"保存",
			save,
			"已保存",
			`GeoGebra: 已保存 ${options.saveFile?.name ?? ""}`
		);
	};

	const finishMount = (): MountedApplet => {
		attachSideActions();
		return {
			el: webview,
			getBase64,
			save,
			canSave,
			revoke: () => {
				revoked = true;
				runCleanups(cleanups);
				webview.remove();
			},
		};
	};

	if (effectiveOptions.materialId && !effectiveOptions.ggbBase64) {
		webview.src = buildMaterialEmbedUrl(
			effectiveOptions.materialId,
			boxW,
			boxH,
			effectiveOptions
		);
		wireWebviewReady(webview, markReady, cleanups, () => revoked);
		return finishMount();
	}

	const html = buildAppletHtml(effectiveOptions, boxW, boxH);
	const runtime = await writeRuntimeHtml(ctx.plugin, adapter, html);
	cleanups.push(runtime.cleanup);

	webview.src = runtime.fileUrl;
	wireWebviewReady(webview, markReady, cleanups, () => revoked);

	const safety = window.setTimeout(() => markReady(), 8000);
	cleanups.push(() => window.clearTimeout(safety));

	return finishMount();
}

/** @deprecated use mountGeoGebraApplet */
export const mountGeoGebraIframe = mountGeoGebraApplet;

function createWebviewElement(): ElectronWebview | null {
	// Electron <webview>; cast because createEl typings only list standard HTML tags.
	const el = createEl("webview" as keyof HTMLElementTagNameMap) as unknown as ElectronWebview;
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
	const pluginDirName = plugin.manifest.dir;
	if (!pluginDirName) {
		throw new Error("无法解析插件目录（manifest.dir 为空）");
	}

	const runtimeDir = normalizePath(`${pluginDirName}/.runtime`);
	try {
		await adapter.mkdir(runtimeDir);
	} catch {
		// Directory may already exist.
	}

	const fileName = `ggb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`;
	const relativePath = normalizePath(`${runtimeDir}/${fileName}`);
	await adapter.write(relativePath, html);

	try {
		const listed = await adapter.list(runtimeDir);
		const stale = listed.files
			.filter((name) => {
				const base = name.split("/").pop() ?? name;
				return base.startsWith("ggb-") && base.endsWith(".html");
			})
			.sort()
			.reverse()
			.slice(20);
		for (const path of stale) {
			try {
				await adapter.remove(path);
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore pruning failures
	}

	const absolutePath = adapter.getFullPath(relativePath);
	return {
		fileUrl: pathToFileUrl(absolutePath),
		cleanup: () => {
			void adapter.remove(relativePath).catch(() => undefined);
		},
	};
}

/** Build a file:// URL without importing Node's url module. */
function pathToFileUrl(absolutePath: string): string {
	const normalized = absolutePath.replace(/\\/g, "/");
	const prefixed = /^[A-Za-z]:\//.test(normalized)
		? `/${normalized}`
		: normalized.startsWith("/")
			? normalized
			: `/${normalized}`;
	return `file://${encodeURI(prefixed).replace(/#/g, "%23")}`;
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
	const showAlgebraView =
		options.showAlgebraView ?? settings.showAlgebraView;
	const allowStyleBar = options.allowStyleBar ?? settings.allowStyleBar;

	const params: Record<string, unknown> = {
		appName: options.appName ?? settings.appName,
		width,
		height,
		showToolBar: options.showToolBar ?? settings.showToolBar,
		showAlgebraInput: options.showAlgebraInput ?? settings.showAlgebraInput,
		showMenuBar: options.showMenuBar ?? settings.showMenuBar,
		allowStyleBar,
		enableRightClick: settings.enableRightClick,
		enableShiftDragZoom: settings.enableShiftDragZoom,
		enableLabelDrags: true,
		showResetIcon: settings.showResetIcon,
		errorDialogsActive: true,
		language: "zh",
		preventFocus: false,
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
	const algebraViewJson = JSON.stringify(showAlgebraView);
	const enableRightClickJson = JSON.stringify(!!settings.enableRightClick);
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
  function applyUi(api) {
    if (!api) return;
    try {
      if (typeof api.enableRightClick === "function") {
        api.enableRightClick(${enableRightClickJson});
      }
    } catch (e) {}
    var algebraView = ${algebraViewJson};
    if (algebraView === "show" || algebraView === "hide") {
      try {
        if (typeof api.setPerspective === "function") {
          api.setPerspective(algebraView === "show" ? "+A" : "-A");
        } else if (typeof api.evalCommand === "function") {
          api.evalCommand(algebraView === "show" ? 'SetPerspective("+A")' : 'SetPerspective("-A")');
        }
      } catch (e) {}
    }
  }
  try {
    var params = ${paramsJson};
    var initial = hostSize();
    params.width = Math.max(initial.w, ${fallbackW});
    params.height = Math.max(initial.h, ${fallbackH});
    params.appletOnLoad = function (api) {
      applyUi(api);
      applySize(api);
      window.setTimeout(function () { applyUi(api); applySize(api); }, 0);
      window.setTimeout(function () { applyUi(api); applySize(api); }, 250);
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
