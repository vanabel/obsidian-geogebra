import { MarkdownRenderChild, Notice, TFile } from "obsidian";
import type GeoGebraPlugin from "./main";
import {
	applyEmbedBoxSize,
	arrayBufferToBase64,
	mountGeoGebraApplet,
	resolveEmbedBox,
	resolveGgbFile,
	type MountedApplet,
} from "./geogebra-loader";
import {
	findEmbedDisplayInCache,
	parseEmbedDisplay,
	parseEmbedElementAttrs,
	type ParsedGeoGebraBlock,
} from "./settings";

function sizeKey(config: ParsedGeoGebraBlock): string {
	return `${config.width ?? ""}x${config.height ?? ""}:${config.caption ?? ""}`;
}

export class GeoGebraRenderChild extends MarkdownRenderChild {
	private readonly plugin: GeoGebraPlugin;
	private readonly sourcePath: string;
	private readonly config: ParsedGeoGebraBlock;
	private file?: TFile;
	private mounted: MountedApplet | null = null;
	private generation = 0;
	private liveRegistered = false;
	private attrObserver: MutationObserver | null = null;
	private lastSizeKey = "";

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

	private ensureLiveRegistration(): void {
		if (this.liveRegistered) return;
		this.liveRegistered = true;
		this.register(
			this.plugin.registerLiveApplet({
				remount: () => this.render(),
			})
		);
	}

	private ensureAttrWatch(): void {
		if (this.attrObserver) return;
		this.attrObserver = new MutationObserver(() => {
			const next = sizeKey(this.effectiveConfig());
			if (next === this.lastSizeKey) return;
			void this.render();
		});
		this.attrObserver.observe(this.containerEl, {
			attributes: true,
			attributeFilter: ["src", "alt", "width", "height"],
		});
		this.register(() => {
			this.attrObserver?.disconnect();
			this.attrObserver = null;
		});
	}

	/** Obsidian embed registry calls this instead of onload(). */
	async loadFile(file?: TFile): Promise<void> {
		if (file instanceof TFile) {
			this.file = file;
		}
		this.ensureLiveRegistration();
		this.ensureAttrWatch();
		await this.render();
		// Live Preview may set `alt` after the first loadFile.
		window.setTimeout(() => {
			const next = sizeKey(this.effectiveConfig());
			if (next !== this.lastSizeKey) void this.render();
		}, 50);
	}

	onload(): void {
		this.ensureLiveRegistration();
		this.ensureAttrWatch();
		void this.render();
	}

	onunload(): void {
		this.generation += 1;
		this.mounted?.revoke();
		this.mounted = null;
	}

	/**
	 * Code-block config wins; wiki `src`/`alt` and metadata displayText fill gaps.
	 */
	private effectiveConfig(): ParsedGeoGebraBlock {
		const fromEl = parseEmbedElementAttrs(this.containerEl);
		let fromCache: Pick<ParsedGeoGebraBlock, "width" | "height" | "caption"> =
			{};
		const filePath = this.file?.path ?? this.config.file;
		if (filePath) {
			const display = findEmbedDisplayInCache(
				this.plugin.app,
				this.sourcePath,
				filePath
			);
			if (display) {
				fromCache = parseEmbedDisplay(display);
			}
		}

		return {
			...fromCache,
			...fromEl,
			...this.config,
			width: this.config.width ?? fromEl.width ?? fromCache.width,
			height: this.config.height ?? fromEl.height ?? fromCache.height,
			caption: this.config.caption ?? fromEl.caption ?? fromCache.caption,
		};
	}

	private async render(): Promise<void> {
		const token = ++this.generation;
		this.mounted?.revoke();
		this.mounted = null;

		const config = this.effectiveConfig();
		this.lastSizeKey = sizeKey(config);

		this.containerEl.empty();
		this.containerEl.addClass("geogebra-embed");
		this.containerEl.removeClass("geogebra-has-caption");

		const { width, height } = resolveEmbedBox({
			width: config.width,
			height: config.height,
			settings: this.plugin.settings,
		});
		applyEmbedBoxSize(this.containerEl, width, height);

		const status = this.containerEl.createDiv({ cls: "geogebra-status" });
		status.setText("正在加载 GeoGebra…");

		try {
			const file = this.file ?? this.resolveFile(config);
			let ggbBase64: string | undefined;
			const materialId = config.materialId;

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
					width,
					appName: config.appName,
					showToolBar: config.showToolBar,
					showAlgebraInput: config.showAlgebraInput,
					showAlgebraView: config.showAlgebraView,
					showMenuBar: config.showMenuBar,
					allowStyleBar: config.allowStyleBar,
					ggbBase64,
					materialId,
					saveFile: file ?? undefined,
				},
				{ plugin: this.plugin }
			);
			if (token !== this.generation) {
				this.mounted.revoke();
				this.mounted = null;
				return;
			}

			const caption = config.caption?.trim();
			if (caption) {
				this.containerEl.addClass("geogebra-has-caption");
				this.containerEl.createDiv({
					cls: "geogebra-caption",
					text: caption,
				});
			}
		} catch (error) {
			if (token !== this.generation) return;
			const message = error instanceof Error ? error.message : String(error);
			status.setText(message);
			status.addClass("geogebra-status-error");
			new Notice(`GeoGebra: ${message}`);
		}
	}

	private resolveFile(config: ParsedGeoGebraBlock): TFile | null {
		if (config.file) {
			return resolveGgbFile(
				this.plugin.app,
				config.file,
				this.sourcePath
			);
		}
		return null;
	}
}
