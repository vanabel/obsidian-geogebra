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
	appName?: GeoGebraPluginSettings["appName"];
	showToolBar?: boolean;
	showAlgebraInput?: boolean;
	showAlgebraView?: "auto" | "show" | "hide";
	showMenuBar?: boolean;
	allowStyleBar?: boolean;
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
