import { App, PluginSettingTab, Setting } from "obsidian";
import type GeoGebraPlugin from "./main";
import type { GeoGebraPluginSettings } from "./settings";

export class GeoGebraSettingTab extends PluginSettingTab {
	plugin: GeoGebraPlugin;

	constructor(app: App, plugin: GeoGebraPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("GeoGebra").setHeading();

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
				const options: Record<GeoGebraPluginSettings["appName"], string> = {
					classic: "Classic",
					graphing: "Graphing",
					geometry: "Geometry",
					"3d": "3D Calculator",
					suite: "Calculator Suite",
				};
				dropdown.addOptions(options);
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
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showAlgebraInput)
					.onChange(async (value) => {
						this.plugin.settings.showAlgebraInput = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show menu bar")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showMenuBar)
					.onChange(async (value) => {
						this.plugin.settings.showMenuBar = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable right-click")
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
			.setName("Attachment folder")
			.setDesc("Vault-relative folder used when dropping external .ggb files")
			.addText((text) =>
				text
					.setPlaceholder("GeoGebra")
					.setValue(this.plugin.settings.attachmentFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachmentFolder = value.trim() || "GeoGebra";
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
					.setPlaceholder("https://www.geogebra.org/apps/deployggb.js")
					.setValue(this.plugin.settings.deployScriptUrl)
					.onChange(async (value) => {
						this.plugin.settings.deployScriptUrl =
							value.trim() ||
							"https://www.geogebra.org/apps/deployggb.js";
						await this.plugin.saveSettings();
					})
			);
	}
}
