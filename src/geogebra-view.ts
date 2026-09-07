import { FileView, TFile, WorkspaceLeaf } from "obsidian";
import type GeoGebraPlugin from "./main";
import {
	arrayBufferToBase64,
	mountGeoGebraApplet,
	type MountedApplet,
} from "./geogebra-loader";

export const GEOGEBRA_VIEW_TYPE = "geogebra-view";

export class GeoGebraView extends FileView {
	plugin: GeoGebraPlugin;
	private mounted: MountedApplet | null = null;
	private remounting = false;

	constructor(leaf: WorkspaceLeaf, plugin: GeoGebraPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return GEOGEBRA_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "GeoGebra";
	}

	getIcon(): string {
		return "pyramid";
	}

	async onOpen(): Promise<void> {
		this.register(
			this.plugin.registerLiveApplet({
				remount: () => this.remountFromSettings(),
			})
		);
	}

	private async remountFromSettings(): Promise<void> {
		if (!this.file || this.remounting) return;
		this.remounting = true;
		try {
			await this.onLoadFile(this.file);
		} finally {
			this.remounting = false;
		}
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.mounted?.revoke();
		this.mounted = null;
		this.contentEl.empty();
		this.contentEl.addClass("geogebra-file-view");

		const status = this.contentEl.createDiv({ cls: "geogebra-status" });
		status.setText("正在加载 GeoGebra…");

		const host = this.contentEl.createDiv({ cls: "geogebra-embed" });

		try {
			const data = await this.plugin.app.vault.readBinary(file);
			this.mounted = await mountGeoGebraApplet(
				host,
				{
					settings: this.plugin.settings,
					ggbBase64: arrayBufferToBase64(data),
					fillContainer: true,
					saveFile: file,
				},
				{ plugin: this.plugin }
			);
			status.remove();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			status.setText(message);
			status.addClass("geogebra-status-error");
		}
	}

	async onUnloadFile(): Promise<void> {
		this.mounted?.revoke();
		this.mounted = null;
		this.contentEl.empty();
	}
}
