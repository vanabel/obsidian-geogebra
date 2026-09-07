import {
	Editor,
	MarkdownFileInfo,
	MarkdownPostProcessorContext,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	normalizePath,
} from "obsidian";
import { GeoGebraRenderChild } from "./geogebra-renderer";
import { GEOGEBRA_VIEW_TYPE, GeoGebraView } from "./geogebra-view";
import {
	DEFAULT_SETTINGS,
	type GeoGebraPluginSettings,
	parseGeoGebraBlock,
} from "./settings";
import { GeoGebraSettingTab } from "./settings-tab";

interface EmbedRegistry {
	registerExtension: (
		ext: string,
		creator: (
			ctx: { containerEl: HTMLElement; sourcePath?: string },
			file: TFile,
			subpath?: string
		) => GeoGebraRenderChild
	) => void;
	unregisterExtension?: (ext: string) => void;
	isExtensionRegistered?: (ext: string) => boolean;
}

interface DragManager {
	draggable?: {
		type?: string;
		file?: TFile;
		files?: TFile[];
	} | null;
}

export default class GeoGebraPlugin extends Plugin {
	settings: GeoGebraPluginSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			GEOGEBRA_VIEW_TYPE,
			(leaf) => new GeoGebraView(leaf, this)
		);
		this.registerExtensions(["ggb"], GEOGEBRA_VIEW_TYPE);

		this.registerMarkdownCodeBlockProcessor(
			"geogebra",
			(source, el, ctx) => this.mountCodeBlock(source, el, ctx)
		);
		this.registerMarkdownCodeBlockProcessor("ggb", (source, el, ctx) =>
			this.mountCodeBlock(source, el, ctx)
		);

		this.registerWikiEmbed();
		this.registerReadingFallback();

		this.registerEvent(
			this.app.workspace.on("editor-drop", (evt, editor, info) => {
				void this.onEditorDropOrPaste(evt, editor, info);
			})
		);
		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt, editor, info) => {
				void this.onEditorDropOrPaste(evt, editor, info);
			})
		);

		this.addCommand({
			id: "insert-code-block",
			name: "Insert code block",
			editorCallback: (editor) => {
				const snippet = [
					"```ggb",
					"path/to/file.ggb",
					"```",
					"",
				].join("\n");
				editor.replaceSelection(snippet);
			},
		});

		this.addSettingTab(new GeoGebraSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<GeoGebraPluginSettings>
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private mountCodeBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): void {
		const config = parseGeoGebraBlock(source);
		ctx.addChild(new GeoGebraRenderChild(el, this, ctx.sourcePath, config));
	}

	private registerWikiEmbed(): void {
		const embedRegistry = (
			this.app as unknown as { embedRegistry?: EmbedRegistry }
		).embedRegistry;
		if (!embedRegistry?.registerExtension) return;

		try {
			if (embedRegistry.isExtensionRegistered?.("ggb")) {
				embedRegistry.unregisterExtension?.("ggb");
			}
		} catch {
			// Older Obsidian builds may not expose isExtensionRegistered.
		}

		try {
			embedRegistry.unregisterExtension?.("ggb");
		} catch {
			// Already unregistered.
		}

		embedRegistry.registerExtension("ggb", (ctx, file) => {
			return new GeoGebraRenderChild(
				ctx.containerEl,
				this,
				ctx.sourcePath ?? file.path,
				{ file: file.path },
				file
			);
		});

		this.register(() => {
			try {
				embedRegistry.unregisterExtension?.("ggb");
			} catch {
				// ignore
			}
		});
	}

	private registerReadingFallback(): void {
		this.registerMarkdownPostProcessor((el, ctx) => {
			const embeds = el.querySelectorAll("span.internal-embed");
			for (const span of Array.from(embeds)) {
				if (!span.instanceOf(HTMLElement)) continue;
				if (span.querySelector(".geogebra-webview, .geogebra-status")) continue;

				const src = (span.getAttribute("src") ?? "").split("|")[0].trim();
				if (!src.toLowerCase().endsWith(".ggb")) continue;

				const file = this.app.metadataCache.getFirstLinkpathDest(
					src,
					ctx.sourcePath
				);
				if (!(file instanceof TFile)) continue;

				ctx.addChild(
					new GeoGebraRenderChild(
						span,
						this,
						ctx.sourcePath,
						{ file: file.path },
						file
					)
				);
			}
		});
	}

	private onEditorDropOrPaste(
		evt: DragEvent | ClipboardEvent,
		editor: Editor,
		info: MarkdownView | MarkdownFileInfo
	): void {
		if (evt.defaultPrevented) return;
		if (!this.eventHasGgb(evt)) return;

		if (this.settings.preferWikiEmbed) {
			this.scheduleEmbedPromotion(editor);
			return;
		}

		evt.preventDefault();
		void this.insertCodeBlocksFromEvent(evt, editor, info);
	}

	private eventHasGgb(evt: DragEvent | ClipboardEvent): boolean {
		if (this.externalGgbFiles(evt).length > 0) return true;
		if (this.vaultGgbFiles(evt).length > 0) return true;
		if (evt instanceof DragEvent) {
			return this.extractInternalGgbPaths(evt).length > 0;
		}
		return false;
	}

	private scheduleEmbedPromotion(editor: Editor): void {
		const startLine = Math.max(0, editor.getCursor().line - 2);
		window.setTimeout(() => {
			const endLine = Math.min(editor.lastLine(), editor.getCursor().line + 2);
			for (let i = startLine; i <= endLine; i++) {
				const line = editor.getLine(i);
				const next = line.replace(
					/(?<!!)\[\[([^[\]]+\.ggb(?:\|[^\]]*)?)\]\]/gi,
					"![[$1]]"
				);
				if (next !== line) {
					editor.setLine(i, next);
				}
			}
		}, 0);
	}

	private async insertCodeBlocksFromEvent(
		evt: DragEvent | ClipboardEvent,
		editor: Editor,
		info: MarkdownView | MarkdownFileInfo
	): Promise<void> {
		const sourcePath =
			info instanceof MarkdownView ? (info.file?.path ?? "") : "";
		const paths: string[] = [];

		if (evt instanceof DragEvent) {
			paths.push(...this.extractInternalGgbPaths(evt));
		}
		for (const file of this.vaultGgbFiles(evt)) {
			paths.push(file.path);
		}
		for (const file of this.externalGgbFiles(evt)) {
			try {
				paths.push(await this.importGgbFile(file, sourcePath));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`GeoGebra: ${message}`);
			}
		}

		for (const path of [...new Set(paths)]) {
			editor.replaceSelection(
				["```ggb", path, "```", ""].join("\n")
			);
		}
	}

	private externalGgbFiles(evt: DragEvent | ClipboardEvent): File[] {
		const list =
			evt instanceof DragEvent
				? evt.dataTransfer?.files
				: evt.clipboardData?.files;
		if (!list) return [];
		return Array.from(list).filter((file) =>
			file.name.toLowerCase().endsWith(".ggb")
		);
	}

	private vaultGgbFiles(_evt: DragEvent | ClipboardEvent): TFile[] {
		const draggable = (this.app as unknown as { dragManager?: DragManager })
			.dragManager?.draggable;
		if (!draggable) return [];

		const files: TFile[] = [];
		if (draggable.file instanceof TFile) files.push(draggable.file);
		if (Array.isArray(draggable.files)) {
			for (const file of draggable.files) {
				if (file instanceof TFile) files.push(file);
			}
		}
		return files.filter((file) => file.extension.toLowerCase() === "ggb");
	}

	private extractInternalGgbPaths(evt: DragEvent): string[] {
		const dt = evt.dataTransfer;
		if (!dt) return [];

		const candidates: string[] = [];
		for (const type of ["text/plain", "Text", "text/uri-list"]) {
			const raw = dt.getData(type);
			if (raw) candidates.push(raw);
		}

		const paths: string[] = [];
		for (const raw of candidates) {
			for (const line of raw.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed) continue;

				const wiki = trimmed.match(/!?\[\[([^\]]+)\]\]/);
				const path = (wiki?.[1] ?? trimmed)
					.split("|")[0]
					.split("#")[0]
					.trim();
				if (!path.toLowerCase().endsWith(".ggb")) continue;

				const file =
					this.app.vault.getAbstractFileByPath(normalizePath(path)) ??
					this.app.metadataCache.getFirstLinkpathDest(path, "");
				if (file instanceof TFile) paths.push(file.path);
			}
		}

		return [...new Set(paths)];
	}

	private async importGgbFile(
		file: File,
		_sourcePath: string
	): Promise<string> {
		const folder = await this.ensureAttachmentFolder();
		const uniqueName = await this.uniqueFileName(folder, file.name);
		const vaultPath = normalizePath(`${folder}/${uniqueName}`);
		const buffer = await file.arrayBuffer();
		await this.app.vault.createBinary(vaultPath, buffer);
		return vaultPath;
	}

	private async ensureAttachmentFolder(): Promise<string> {
		const configured = this.settings.attachmentFolder.trim() || "GeoGebra";
		const folder = normalizePath(configured);
		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		return folder;
	}

	private async uniqueFileName(
		folder: string,
		originalName: string
	): Promise<string> {
		const safe = originalName.replace(/[\\/]/g, "-");
		let candidate = safe;
		let i = 1;
		while (this.app.vault.getAbstractFileByPath(`${folder}/${candidate}`)) {
			const dot = safe.lastIndexOf(".");
			const base = dot === -1 ? safe : safe.slice(0, dot);
			const ext = dot === -1 ? "" : safe.slice(dot);
			candidate = `${base}-${i}${ext}`;
			i += 1;
		}
		return candidate;
	}
}
