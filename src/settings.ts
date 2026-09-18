export interface GeoGebraPluginSettings {
	height: number;
	width: number | "100%";
	appName: "classic" | "graphing" | "geometry" | "3d" | "suite";
	showToolBar: boolean;
	/** Bottom input bar (命令输入行), not the left Algebra View panel. */
	showAlgebraInput: boolean;
	/**
	 * Left Algebra View panel (对象列表).
	 * Applied after load via setPerspective("+A" / "-A").
	 * `auto` keeps whatever the .ggb file saved.
	 */
	showAlgebraView: "auto" | "show" | "hide";
	showMenuBar: boolean;
	allowStyleBar: boolean;
	enableRightClick: boolean;
	enableShiftDragZoom: boolean;
	showResetIcon: boolean;
	/** Show floating Save button that writes current construction back to the .ggb file. */
	showSaveButton: boolean;
	attachmentFolder: string;
	deployScriptUrl: string;
	preferWikiEmbed: boolean;
}

export const DEFAULT_SETTINGS: GeoGebraPluginSettings = {
	height: 640,
	width: "100%",
	appName: "classic",
	showToolBar: true,
	showAlgebraInput: true,
	showAlgebraView: "auto",
	showMenuBar: false,
	allowStyleBar: true,
	enableRightClick: false,
	enableShiftDragZoom: true,
	showResetIcon: true,
	showSaveButton: true,
	attachmentFolder: "GeoGebra",
	deployScriptUrl: "https://www.geogebra.org/apps/deployggb.js",
	preferWikiEmbed: true,
};

export interface ParsedGeoGebraBlock {
	file?: string;
	materialId?: string;
	height?: number;
	width?: number | string;
	caption?: string;
	appName?: GeoGebraPluginSettings["appName"];
	showToolBar?: boolean;
	showAlgebraInput?: boolean;
	showAlgebraView?: "auto" | "show" | "hide";
	showMenuBar?: boolean;
	allowStyleBar?: boolean;
}

/** Image-like wiki alias: `400`, `400x300`, `caption`, or `400|caption`. */
export function parseEmbedDisplay(display: string): Pick<
	ParsedGeoGebraBlock,
	"width" | "height" | "caption"
> {
	const result: Pick<ParsedGeoGebraBlock, "width" | "height" | "caption"> = {};
	const parts = display
		.split("|")
		.map((part) => part.trim())
		.filter(Boolean);
	const sizeRe = /^(\d{2,4})(?:\s*[x×]\s*(\d{2,4}))?$/i;

	for (const part of parts) {
		const match = part.match(sizeRe);
		if (match && result.width === undefined) {
			result.width = Number(match[1]);
			if (match[2]) {
				result.height = Number(match[2]);
			}
			continue;
		}
		if (!result.caption) {
			result.caption = part;
		} else {
			result.caption = `${result.caption}|${part}`;
		}
	}
	return result;
}

/**
 * Read size/caption from an Obsidian embed element.
 * Live Preview often puts the wiki alias in `alt` (possibly after first paint);
 * Reading view may keep `path|alias` in `src`.
 */
export function parseEmbedElementAttrs(
	el: HTMLElement
): Pick<ParsedGeoGebraBlock, "width" | "height" | "caption"> {
	const candidates: string[] = [];

	const src = el.getAttribute("src") ?? "";
	const pipe = src.indexOf("|");
	if (pipe >= 0) {
		candidates.push(src.slice(pipe + 1).trim());
	}

	const alt = (el.getAttribute("alt") ?? "").trim();
	if (alt) candidates.push(alt);

	const widthAttr = (el.getAttribute("width") ?? "").trim();
	const heightAttr = (el.getAttribute("height") ?? "").trim();
	if (widthAttr && heightAttr && /^\d+$/.test(widthAttr) && /^\d+$/.test(heightAttr)) {
		candidates.push(`${widthAttr}x${heightAttr}`);
	} else if (widthAttr && /^\d+$/.test(widthAttr)) {
		candidates.push(widthAttr);
	}

	for (const display of candidates) {
		const parsed = parseEmbedDisplay(display);
		if (
			parsed.width !== undefined ||
			parsed.height !== undefined ||
			parsed.caption !== undefined
		) {
			return parsed;
		}
	}
	return {};
}

/**
 * Fallback: read displayText from metadata cache for `![[file|…]]`.
 * If the same file is embedded multiple times, prefers an alias that looks like a size.
 */
export function findEmbedDisplayInCache(
	app: { metadataCache: { getCache: (path: string) => { embeds?: Array<{ link: string; displayText?: string }> } | null; getFirstLinkpathDest: (link: string, path: string) => { path: string } | null } },
	sourcePath: string,
	filePath: string
): string | undefined {
	const cache = app.metadataCache.getCache(sourcePath);
	const embeds = cache?.embeds;
	if (!embeds?.length) return undefined;

	const matches: string[] = [];
	for (const embed of embeds) {
		const dest = app.metadataCache.getFirstLinkpathDest(embed.link, sourcePath);
		if (!dest || dest.path !== filePath) continue;
		const display = embed.displayText?.trim();
		if (!display || display === embed.link) continue;
		// Skip when displayText is just the basename without alias.
		const base = filePath.split("/").pop() ?? filePath;
		if (display === base || display === filePath) continue;
		matches.push(display);
	}
	if (!matches.length) return undefined;

	const sized = matches.find((m) =>
		/^(\d{2,4})(\s*[x×]\s*\d{2,4})?(\s*\|.*)?$/i.test(m)
	);
	return sized ?? matches[0];
}

export function stripWikiTarget(value: string): string {
	return value
		.trim()
		.replace(/^!/, "")
		.replace(/^\[\[/, "")
		.replace(/\]\]$/, "")
		.split("|")[0]
		.split("#")[0]
		.trim();
}

function parseBool(value: string): boolean {
	return value.toLowerCase() !== "false" && value !== "0";
}

function parseAlgebraView(value: string): "auto" | "show" | "hide" {
	const v = value.trim().toLowerCase();
	if (v === "auto" || v === "default" || v === "file" || v === "") return "auto";
	if (v === "false" || v === "0" || v === "off" || v === "hide") return "hide";
	return "show";
}

export function parseGeoGebraBlock(source: string): ParsedGeoGebraBlock {
	const result: ParsedGeoGebraBlock = {};
	for (const rawLine of source.split("\n")) {
		const line = rawLine.replace(/^\uFEFF/, "").trim();
		if (!line || line.startsWith("#")) continue;

		const colon = line.indexOf(":");
		if (colon === -1) {
			if (!result.file && looksLikeGgbTarget(line)) {
				result.file = stripWikiTarget(line);
			}
			continue;
		}

		const key = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();

		switch (key) {
			case "file":
			case "filename":
			case "path":
				result.file = stripWikiTarget(value);
				break;
			case "material":
			case "material_id":
			case "materialid":
				result.materialId = value;
				break;
			case "height":
				result.height = Number(value) || undefined;
				break;
			case "width":
				result.width = value === "100%" ? "100%" : Number(value) || value;
				break;
			case "caption":
			case "title":
			case "label":
				result.caption = value;
				break;
			case "app":
			case "appname":
				if (
					value === "classic" ||
					value === "graphing" ||
					value === "geometry" ||
					value === "3d" ||
					value === "suite"
				) {
					result.appName = value;
				}
				break;
			case "toolbar":
			case "showtoolbar":
				result.showToolBar = parseBool(value);
				break;
			case "algebra":
			case "algebrainput":
			case "showalgebrainput":
				result.showAlgebraInput = parseBool(value);
				break;
			case "algebraview":
			case "showalgebraview":
			case "algebra_panel":
				result.showAlgebraView = parseAlgebraView(value);
				break;
			case "menu":
			case "showmenubar":
				result.showMenuBar = parseBool(value);
				break;
			case "stylebar":
			case "allowstylebar":
			case "showstylebar":
				result.allowStyleBar = parseBool(value);
				break;
		}
	}
	return result;
}

function looksLikeGgbTarget(line: string): boolean {
	const target = stripWikiTarget(line);
	return /\.ggb$/i.test(target) || line.startsWith("[[") || line.startsWith("![[");
}
