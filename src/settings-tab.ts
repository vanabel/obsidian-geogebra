import {
	App,
	PluginSettingTab,
	Setting,
	requireApiVersion,
	type SettingDefinitionItem,
} from "obsidian";
import type GeoGebraPlugin from "./main";
import { DEFAULT_SETTINGS, type GeoGebraPluginSettings } from "./settings";

const APP_NAME_OPTIONS: Record<GeoGebraPluginSettings["appName"], string> = {
	classic: "Classic",
	graphing: "Graphing",
	geometry: "Geometry",
	"3d": "3D Calculator",
	suite: "Calculator Suite",
};

const ALGEBRA_VIEW_OPTIONS: Record<
	GeoGebraPluginSettings["showAlgebraView"],
	string
> = {
	auto: "Keep from .ggb file",
	show: "Always show",
	hide: "Always hide",
};

export class GeoGebraSettingTab extends PluginSettingTab {
	plugin: GeoGebraPlugin;

	constructor(app: App, plugin: GeoGebraPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Obsidian 1.13+: searchable declarative settings (skips display when non-empty). */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Default height",
				desc: "Applet height in pixels",
				control: {
					type: "number",
					key: "height",
					min: 1,
					placeholder: "500",
					defaultValue: DEFAULT_SETTINGS.height,
				},
			},
			{
				name: "App type",
				desc: "Default GeoGebra app when opening .ggb files",
				control: {
					type: "dropdown",
					key: "appName",
					options: APP_NAME_OPTIONS,
					defaultValue: DEFAULT_SETTINGS.appName,
				},
			},
			{
				name: "Show toolbar",
				control: { type: "toggle", key: "showToolBar" },
			},
			{
				name: "Show algebra input",
				desc: "Bottom command input bar (not the left Algebra View panel)",
				control: { type: "toggle", key: "showAlgebraInput" },
			},
			{
				name: "Algebra view panel",
				desc: "Left object list panel; auto keeps the layout saved in the .ggb file",
				control: {
					type: "dropdown",
					key: "showAlgebraView",
					options: ALGEBRA_VIEW_OPTIONS,
					defaultValue: DEFAULT_SETTINGS.showAlgebraView,
				},
			},
			{
				name: "Show menu bar",
				desc: "Needed for View ▸ Algebra and Options ▸ Graphics at runtime",
				control: { type: "toggle", key: "showMenuBar" },
			},
			{
				name: "Allow style bar",
				desc: "Graphics style bar (axes / grid toggles); useful if context-menu grid dialog fails in webview",
				control: { type: "toggle", key: "allowStyleBar" },
			},
			{
				name: "Enable right-click",
				desc: "Often broken in Electron webview; prefer Allow style bar for axes/grid",
				control: { type: "toggle", key: "enableRightClick" },
			},
			{
				name: "Enable shift-drag zoom",
				control: { type: "toggle", key: "enableShiftDragZoom" },
			},
			{
				name: "Show reset icon",
				control: { type: "toggle", key: "showResetIcon" },
			},
			{
				name: "Show save button",
				desc: "Vertical Reset + Save under the style-bar toggle (local .ggb only)",
				control: { type: "toggle", key: "showSaveButton" },
			},
			{
				name: "Attachment folder",
				desc: "Vault-relative folder used when dropping external .ggb files",
				control: {
					type: "text",
					key: "attachmentFolder",
					placeholder: "GeoGebra",
					defaultValue: DEFAULT_SETTINGS.attachmentFolder,
				},
			},
			{
				name: "Prefer wiki embed on drop",
				desc: "Insert ![[file.ggb]] instead of a geogebra code block",
				control: { type: "toggle", key: "preferWikiEmbed" },
			},
			{
				name: "deployggb.js URL",
				desc: "CDN or self-hosted GeoGebra loader script",
				control: {
					type: "text",
					key: "deployScriptUrl",
					placeholder: DEFAULT_SETTINGS.deployScriptUrl,
					defaultValue: DEFAULT_SETTINGS.deployScriptUrl,
				},
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "attachmentFolder") {
			this.plugin.settings.attachmentFolder =
				String(value ?? "").trim() || DEFAULT_SETTINGS.attachmentFolder;
			await this.plugin.saveSettings();
			return;
		}
		if (key === "deployScriptUrl") {
			this.plugin.settings.deployScriptUrl =
				String(value ?? "").trim() || DEFAULT_SETTINGS.deployScriptUrl;
			await this.plugin.saveSettings();
			return;
		}
		if (requireApiVersion("1.13.0")) {
			await super.setControlValue(key, value);
			// Core may only saveData; remount open applets without plugin reload.
			this.plugin.notifySettingsChanged();
		}
	}

	/** Fallback for Obsidian before 1.13.0 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default height")
			.setDesc("Applet height in pixels")
			.addText((text) =>
				text
					.setPlaceholder("500")
					.setValue(String(this.plugin.settings.height))
					.onChange(async (value) => {
						const n = Number(value);
						if (Number.isFinite(n) && n > 0) {
							this.plugin.settings.height = n;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("App type")
			.setDesc("Default GeoGebra app when opening .ggb files")
			.addDropdown((dropdown) => {
				dropdown.addOptions(APP_NAME_OPTIONS);
				dropdown.setValue(this.plugin.settings.appName);
				dropdown.onChange(async (value) => {
					this.plugin.settings.appName =
						value as GeoGebraPluginSettings["appName"];
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Show toolbar")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showToolBar)
					.onChange(async (value) => {
						this.plugin.settings.showToolBar = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show algebra input")
			.setDesc("Bottom command input bar (not the left Algebra View panel)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showAlgebraInput)
					.onChange(async (value) => {
						this.plugin.settings.showAlgebraInput = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Algebra view panel")
			.setDesc("Left object list panel; auto keeps the layout saved in the .ggb file")
			.addDropdown((dropdown) => {
				dropdown.addOptions(ALGEBRA_VIEW_OPTIONS);
				dropdown.setValue(this.plugin.settings.showAlgebraView ?? "auto");
				dropdown.onChange(async (value) => {
					this.plugin.settings.showAlgebraView =
						value as GeoGebraPluginSettings["showAlgebraView"];
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Show menu bar")
			.setDesc("Needed for View ▸ Algebra and Options ▸ Graphics at runtime")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showMenuBar)
					.onChange(async (value) => {
						this.plugin.settings.showMenuBar = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Allow style bar")
			.setDesc(
				"Graphics style bar (axes / grid toggles); useful if context-menu grid dialog fails in webview"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.allowStyleBar)
					.onChange(async (value) => {
						this.plugin.settings.allowStyleBar = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable right-click")
			.setDesc(
				"Often broken in Electron webview; prefer Allow style bar for axes/grid"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableRightClick)
					.onChange(async (value) => {
						this.plugin.settings.enableRightClick = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable shift-drag zoom")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableShiftDragZoom)
					.onChange(async (value) => {
						this.plugin.settings.enableShiftDragZoom = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show reset icon")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showResetIcon)
					.onChange(async (value) => {
						this.plugin.settings.showResetIcon = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show save button")
			.setDesc(
				"Vertical Reset + Save under the style-bar toggle (local .ggb only)"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showSaveButton)
					.onChange(async (value) => {
						this.plugin.settings.showSaveButton = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Attachment folder")
			.setDesc("Vault-relative folder used when dropping external .ggb files")
			.addText((text) =>
				text
					.setPlaceholder("GeoGebra")
					.setValue(this.plugin.settings.attachmentFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachmentFolder =
							value.trim() || DEFAULT_SETTINGS.attachmentFolder;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Prefer wiki embed on drop")
			.setDesc("Insert ![[file.ggb]] instead of a geogebra code block")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.preferWikiEmbed)
					.onChange(async (value) => {
						this.plugin.settings.preferWikiEmbed = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("deployggb.js URL")
			.setDesc("CDN or self-hosted GeoGebra loader script")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.deployScriptUrl)
					.setValue(this.plugin.settings.deployScriptUrl)
					.onChange(async (value) => {
						this.plugin.settings.deployScriptUrl =
							value.trim() || DEFAULT_SETTINGS.deployScriptUrl;
						await this.plugin.saveSettings();
					})
			);
	}
}
