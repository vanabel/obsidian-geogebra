export interface GeoGebraPluginSettings {
	height: number;
	width: number | "100%";
	appName: "classic" | "graphing" | "geometry" | "3d" | "suite";
	showToolBar: boolean;
	showAlgebraInput: boolean;
	showMenuBar: boolean;
	enableRightClick: boolean;
	enableShiftDragZoom: boolean;
	showResetIcon: boolean;
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
	showMenuBar: false,
	enableRightClick: true,
	enableShiftDragZoom: true,
	showResetIcon: true,
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
	showMenuBar?: boolean;
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
				result.showToolBar = value.toLowerCase() !== "false";
				break;
			case "algebra":
			case "showalgebrainput":
				result.showAlgebraInput = value.toLowerCase() !== "false";
				break;
			case "menu":
			case "showmenubar":
				result.showMenuBar = value.toLowerCase() !== "false";
				break;
		}
	}
	return result;
}

function looksLikeGgbTarget(line: string): boolean {
	const target = stripWikiTarget(line);
	return /\.ggb$/i.test(target) || line.startsWith("[[") || line.startsWith("![[");
}
