import { MarkdownRenderChild, Notice, TFile } from "obsidian";
import type GeoGebraPlugin from "./main";
import {
	arrayBufferToBase64,
	mountGeoGebraApplet,
	parseHeightHint,
	resolveGgbFile,
	resolvedHeight,
	type MountedApplet,
} from "./geogebra-loader";
import type { ParsedGeoGebraBlock } from "./settings";

export class GeoGebraRenderChild extends MarkdownRenderChild {
	private readonly plugin: GeoGebraPlugin;
	private readonly sourcePath: string;
	private readonly config: ParsedGeoGebraBlock;
	private file?: TFile;
	private mounted: MountedApplet | null = null;
	private generation = 0;

	constructor(
		containerEl: HTMLElement,
		plugin: GeoGebraPlugin,
		sourcePath: string,
		config: ParsedGeoGebraBlock,
		file?: TFile
	) {
		super(containerEl);
		this.plugin = plugin;
		this.sourcePath = sourcePath;
		this.config = config;
		this.file = file;
	}

	/** Obsidian embed registry calls this instead of onload(). */
	async loadFile(file?: TFile): Promise<void> {
		if (file instanceof TFile) {
			this.file = file;
		}
		await this.render();
	}

	onload(): void {
		void this.render();
	}

	onunload(): void {
		this.generation += 1;
		this.mounted?.revoke();
		this.mounted = null;
	}

	private async render(): Promise<void> {
		const token = ++this.generation;
		this.mounted?.revoke();
		this.mounted = null;

		this.containerEl.empty();
		this.containerEl.addClass("geogebra-embed");
		this.containerEl.addClass("geogebra-embed-fixed");

		const height = parseHeightHint(
			this.containerEl,
			resolvedHeight({
				height: this.config.height,
				settings: this.plugin.settings,
			})
		);
		this.containerEl.setCssProps({ "--geogebra-height": `${height}px` });

		const status = this.containerEl.createDiv({ cls: "geogebra-status" });
		status.setText("正在加载 GeoGebra…");

		try {
			const file = this.file ?? this.resolveFile();
			let ggbBase64: string | undefined;
			const materialId = this.config.materialId;

			if (file) {
				this.file = file;
				const data = await this.plugin.app.vault.readBinary(file);
				if (token !== this.generation) return;
				ggbBase64 = arrayBufferToBase64(data);
			} else if (!materialId) {
				throw new Error("未指定 .ggb 文件或 material_id");
			}

			if (token !== this.generation) return;
			this.mounted = await mountGeoGebraApplet(
				this.containerEl,
				{
					settings: this.plugin.settings,
					height,
					width: this.config.width,
					appName: this.config.appName,
					showToolBar: this.config.showToolBar,
					showAlgebraInput: this.config.showAlgebraInput,
					showMenuBar: this.config.showMenuBar,
					ggbBase64,
					materialId,
				},
				{ plugin: this.plugin }
			);
			if (token !== this.generation) {
				this.mounted.revoke();
				this.mounted = null;
			}
		} catch (error) {
			if (token !== this.generation) return;
			const message = error instanceof Error ? error.message : String(error);
			status.setText(message);
			status.addClass("geogebra-status-error");
			new Notice(`GeoGebra: ${message}`);
		}
	}

	private resolveFile(): TFile | null {
		if (this.config.file) {
			return resolveGgbFile(
				this.plugin.app,
				this.config.file,
				this.sourcePath
			);
		}
		return null;
	}
}
