import path from "node:path";
import fs from "node:fs";
import yaml from "js-yaml";
import kleur from "kleur";
import slugify from '@sindresorhus/slugify';
import * as entities from "entities";

import { Logger } from "./Logger.js";
import { Fetcher } from "./Fetcher.js";
import { DirectoryManager } from "./DirectoryManager.js";
import { MarkdownToHtml } from "./MarkdownToHtml.js";
import { HtmlTransformer } from "./HtmlTransformer.js";
import { Persist } from "./Persist.js";

// Data Sources
import { DataSource } from "./DataSource.js";
import { YouTubeUser } from "./DataSource/YouTubeUser.js";
import { Atom } from "./DataSource/Atom.js";
import { Rss } from "./DataSource/Rss.js";
import { WordPressApi } from "./DataSource/WordPressApi.js";
import { BlueskyUser } from "./DataSource/BlueskyUser.js";
import { FediverseUser } from "./DataSource/FediverseUser.js";

import pkg from "../package.json" with { type: "json" };

// For testing
const MAX_IMPORT_SIZE_DEFAULT = 0;

class Importer {
	#draftsFolder = "drafts";
	#outputFolder = ".";
	#assetReferenceType;

	constructor() {
		this.startTime = new Date();
		this.sources = [];
		this.isVerbose = true;
		this.dryRun = false;
		this.safeMode = true;
		this.allowDraftsToOverwrite = false;
		this.counts = {
			files: 0
		};

		this.markdownService = new MarkdownToHtml();
		this.htmlTransformer = new HtmlTransformer();
		this.directoryManager = new DirectoryManager();
		this.persistManager = new Persist();
		this.fetcher = new Fetcher();

		this.htmlTransformer.setFetcher(this.fetcher);

		this.fetcher.setDirectoryManager(this.directoryManager);
		this.fetcher.setPersistManager(this.persistManager);
	}

	// CSS selectors to preserve on markdown conversion
	addPreserved(selectors) {
		for(let sel of (selectors || "").split(",")) {
			this.markdownService.addPreservedSelector(sel);
		}
	}

	getCounts() {
		return {
			...this.counts,
			...this.fetcher.getCounts(),
			...this.markdownService.getCounts(),
			...this.persistManager.getCounts()
		}
	}

	// --overwrite--allow (independent of and bypasses --overwrite)
	setOverwriteAllow(overwrite = "") {
		let s = overwrite.split(",");
		if(s.includes("drafts")) {
			this.allowDraftsToOverwrite = true;
		}
	}

	setSafeMode(safeMode) {
		this.safeMode = Boolean(safeMode);

		this.fetcher.setSafeMode(safeMode);
	}

	setDryRun(isDryRun) {
		this.dryRun = Boolean(isDryRun);

		this.fetcher.setDryRun(isDryRun);
		this.directoryManager.setDryRun(isDryRun);
		this.persistManager.setDryRun(isDryRun);
	}

	setVerbose(isVerbose) {
		this.isVerbose = Boolean(isVerbose);

		this.fetcher.setVerbose(isVerbose);
		this.markdownService.setVerbose(isVerbose);
		this.persistManager.setVerbose(isVerbose);

		for(let source of this.sources) {
			source.setVerbose(isVerbose);
		}
	}

	setAssetsFolder(folder) {
		this.fetcher.setAssetsFolder(folder);
	}

	shouldDownloadAssets() {
		return this.#assetReferenceType !== "disabled";
	}

	isAssetsColocated() {
		return this.#assetReferenceType === "colocate";
	}

	setAssetReferenceType(refType) {
		if(refType === "colocate") {
			// no assets subfolder
			this.setAssetsFolder("");
		}

		if(refType === "disabled") {
			this.fetcher.setDownloadAssets(false);
		} else if(refType === "absolute") {
			this.fetcher.setUseRelativeAssetPaths(false);
		} else if(refType === "relative" || refType === "colocate") {
			this.fetcher.setUseRelativeAssetPaths(true);
		} else {
			throw new Error(`Invalid value for --assetrefs, must be one of: relative, colocate, absolute, or disabled. Received: ${refType} (${typeof refType})`);
		}

		this.#assetReferenceType = refType;
	}

	setDraftsFolder(dir) {
		this.#draftsFolder = dir;
	}

	setOutputFolder(dir) {
		this.#outputFolder = dir;
		this.fetcher.setOutputFolder(dir);
	}

	setCacheDuration(duration) {
		if(duration) {
			this.fetcher.setCacheDuration(duration);
		}
	}

	setPersistTarget(persistTarget) {
		this.persistManager.setTarget(persistTarget);
	}

	addSource(type, options = {}) {
		let cls;
		if(typeof type === "string") {
			type = type?.toLowerCase();

			if(type === "youtubeuser") {
				cls = YouTubeUser;
			} else if(type === "atom") {
				cls = Atom;
			} else if(type === "rss") {
				cls = Rss;
			} else if(type === "wordpress") {
				cls = WordPressApi;
			} else if(type === "bluesky") {
				cls = BlueskyUser; // RSS
			} else if(type === "fediverse") {
				cls = FediverseUser; // RSS
			}
		} else if(typeof type === "function") {
			cls = type;
		}

		if(!cls) {
			throw new Error(`${type} is not a supported type for addSource(). Requires a string type or a DataSource class.`);
		}

		let identifier;
		let label;
		let filepathFormat;

		if(typeof options === "string") {
			identifier = options;
		} else {
			identifier = options.url || options.id;
			label = options.label;
			filepathFormat = options.filepathFormat;
		}

		let source = new cls(identifier);

		if(!(source instanceof DataSource)) {
			throw new Error(`${cls?.name} is not a supported type for addSource(). Requires a string type or a DataSource class.`);
		}

		source.setFetcher(this.fetcher);
		source.setVerbose(this.isVerbose);

		if(this.#outputFolder) {
			source.setOutputFolder(this.#outputFolder);
		}

		if(label) {
			source.setLabel(label);
		}

		if(filepathFormat) {
			source.setFilepathFormatFunction(filepathFormat);
		}

		this.sources.push(source);
	}

	getSources() {
		return this.sources;
	}

	getSourcesForType(type) {
		return this.sources.filter(entry => entry.constructor.TYPE === type);
	}

	addDataOverride(type, url, data) {
		let found = false;
		for(let source of this.getSourcesForType(type)) {
			source.setDataOverride(url, data);
			found = true;
		}

		if(!found) {
			throw new Error("addDataOverride(type) not found: " + type)
		}
	}

	static shouldUseMarkdownFileExtension(entry) {
		return this.isText(entry) || this.isHtml(entry);
	}

	static shouldConvertToMarkdown(entry) {
		return this.isHtml(entry);
	}

	static isText(entry) {
		return (entry.importContentType || entry.contentType) === "text";
	}

	static isHtml(entry) {
		// TODO add a CLI override for --importContentType?
		// TODO add another path to guess if content is HTML https://mimesniff.spec.whatwg.org/#identifying-a-resource-with-an-unknown-mime-type
		return (entry.importContentType || entry.contentType) === "html";
	}

	async fetchRelatedMedia(cleanEntry) {
		let relatedMedia = cleanEntry?.metadata?.media;
		if(!relatedMedia) {
			return;
		}

		for(let mediaType in relatedMedia || {}) {
			let rawUrl = relatedMedia[mediaType];
			let localUrl = await this.fetcher.fetchAsset(rawUrl, cleanEntry);

			// TODO parallel
			cleanEntry.metadata.media[mediaType] = localUrl;
		}
	}

	async getTransformedContent(entry, isWritingToMarkdown) {
		let content = entry.content;

		if(Importer.isHtml(entry)) {
			let transformedHtml = content;
			if(!isWritingToMarkdown) {
				// decoding built-in with Markdown
				transformedHtml = entities.decodeHTML(content);
			}

			if(!this.shouldDownloadAssets()) {
				content = transformedHtml;
			} else {
				content = await this.htmlTransformer.transform(transformedHtml, entry);
			}
		}

		if(isWritingToMarkdown) {
			if(Importer.isText(entry)) {
				// _only_ decode newlines
				content = content.split("&#xA;").join("\n");
			}

			if(Importer.shouldConvertToMarkdown(entry)) {
				await this.markdownService.asyncInit();

				content = await this.markdownService.toMarkdown(content, entry);
			}
		}

		return content;
	}


	// Is used to filter getEntries and in toFiles (which also checks conflicts)
	shouldSkipEntry(entry) {
		if(entry.filePath === false) {
			return true;
		}

		// File system operations
		// TODO use https://www.npmjs.com/package/diff to compare file contents and skip
		if(this.safeMode && fs.existsSync(entry.filePath)) {
			// Not a draft or drafts are skipped (via --overwrite-allow)
			if(entry.status !== "draft" || !this.allowDraftsToOverwrite) {
				return true;
			}
		}

		return false;
	}

	async getEntries(options = {}) {
		// alias to better name (but keep backwards compat)
		let outputContentTypeOverride = options.outputContentType || options.contentType;

		let maxLimit = options.limit ?? MAX_IMPORT_SIZE_DEFAULT;

		for(let source of this.sources) {
			source.setWithin(options.within);
		}

		let entries = [];
		for(let source of this.sources) {
			for(let entry of await source.getEntries()) {
				let filePathContentType;
				if(options.importContentType) {
					entry.importContentType = options.importContentType;
				}
				if(outputContentTypeOverride) {
					entry.outputContentType = outputContentTypeOverride;
				}

				// change output to Markdown
				if(Importer.shouldUseMarkdownFileExtension(entry) && outputContentTypeOverride === "markdown") {
					filePathContentType = "markdown";
				}

				entry.filePath = this.getFilePath(entry, filePathContentType);

				// to prevent fetching assets and transforming contents on entries that won’t get written
				if(options.target === "fs" && this.shouldSkipEntry(entry)) {
					// do nothing
				} else {
					entries.push(entry);
				}
			}
		}

		if(maxLimit) {
			entries = entries.slice(0, maxLimit);
		}

		let promises = await Promise.allSettled(entries.map(async entry => {
			await this.fetchRelatedMedia(entry);
			entry.content = await this.getTransformedContent(entry, outputContentTypeOverride === "markdown");

			if(outputContentTypeOverride === "markdown" && Importer.shouldConvertToMarkdown(entry)) {
				entry.contentType = "markdown";
			}

			return entry;
		}));

		if(!this.dryRun) {
			this.markdownService.cleanup();
		}

		return promises.filter(entry => {
			// Documents with errors
			return entry.status !== "rejected";
		}).map(entry => {
			return entry.value;
		}).sort((a, b) => {
			if(a.date < b.date) {
				return 1;
			}
			if(a.date > b.date) {
				return -1;
			}
			return 0;
		});
	}

	getFilePath(entry, contentType) {
		let { url } = entry;

		let source = entry.source;

		// prefer addSource specific override, then fallback to DataSource type default
		let fallbackPath;
		let hasFilePathFallback = typeof source?.constructor?.getFilePath === "function";
		if(hasFilePathFallback) {
			fallbackPath = source?.constructor?.getFilePath(url);
		} else {
			fallbackPath = (new URL(url)).pathname;
		}

		// Data source specific override
		let outputOverrideFn = source?.getFilepathFormatFunction();
		if(outputOverrideFn && typeof outputOverrideFn === "function") {
			let pathname = outputOverrideFn(url, fallbackPath);
			if(pathname === false) {
				return false;
			}

			// does method does *not* add a file extension for you, you must supply one in `filepathFormat` function
			return path.join(this.#outputFolder, pathname);
		}

		// WordPress draft posts only have a `p` query param e.g. ?p=ID_NUMBER
		if(fallbackPath === "/") {
			fallbackPath = Fetcher.createHash(entry.url);
		}

		let subdirs = [];
		if(this.#outputFolder) {
			subdirs.push(this.#outputFolder);
		}
		if(this.#draftsFolder && entry.status === "draft") {
			subdirs.push(this.#draftsFolder);
		}

		let pathname = path.join(".", ...subdirs, path.normalize(fallbackPath));
		let extension = contentType === "markdown" ? ".md" : ".html";

		if(pathname.endsWith("/")) {
			if(this.isAssetsColocated()) {
				return `${pathname}index${extension}`;
			}
			return `${pathname.slice(0, -1)}${extension}`;
		}

		if(this.isAssetsColocated()) {
			return `${pathname}/index${extension}`;
		}
		return `${pathname}${extension}`;
	}

	static convertEntryToYaml(entry) {
		let data = {};
		data.title = entry.title;
		data.authors = entry.authors;
		data.date = entry.date;
		data.metadata = entry.metadata || {};
		data.metadata.uuid = entry.uuid;
		data.metadata.type = entry.type;
		data.metadata.url = entry.url;

		// Eleventy specific options
		if(entry.status === "draft") {
			data.draft = true;
		}

		if(entry.tags) {
			if(!Array.isArray(entry.tags)) {
				entry.tags = [entry.tags];
			}

			// slugify the tags
			data.tags = entry.tags.map(tag => slugify(tag));
		}

		// https://www.npmjs.com/package/js-yaml#dump-object---options-
		let frontMatter = yaml.dump(data, {
			// sortKeys: true,
			noCompatMode: true,
		});

		return frontMatter;
	}

	// TODO options.pathPrefix
	async toFiles(entries = []) {
		let filepathConflicts = {};

		for(let entry of entries) {
			let pathname = entry.filePath;
			if(pathname === false) {
				continue;
			}

			if(filepathConflicts[pathname]) {
				throw new Error(`Multiple entries attempted to write to the same place: ${pathname} (originally via ${filepathConflicts[pathname]})`);
			}
			filepathConflicts[pathname] = entry.url || true;

			let frontMatter = Importer.convertEntryToYaml(entry);
			let content = `---
${frontMatter}---
${entry.content}`;

			if(this.shouldSkipEntry(entry)) {
				if(this.isVerbose) {
					Logger.skipping("post", pathname, entry.url);
				}
				continue;
			}

			if(this.isVerbose) {
				Logger.importing("post", pathname, entry.url, {
					size: content.length,
					dryRun: this.dryRun
				});
			}

			if(!this.dryRun) {
				this.counts.files++;

				this.directoryManager.createDirectoryForPath(pathname);

				fs.writeFileSync(pathname, content, { encoding: "utf8" });
			}

			// Happens independent of file system (--dryrun or --overwrite)
			// Don’t persist if post is a draft
			if(entry.status !== "draft" && this.persistManager.canPersist()) {
				await this.persistManager.persistFile(pathname, content, {
					url: entry.url,
					type: "post",
				});
			}
		}
	}

	logResults() {
		let counts = this.getCounts();
		let sourcesDisplay = this.getSources().map(source => source.constructor.TYPE_FRIENDLY || source.constructor.TYPE).join(", ");
		let content = [];
		content.push(kleur.green("Wrote"));
		content.push(kleur.green(`${counts.files} ${Logger.plural(counts.files, "document")}`));
		content.push(kleur.green("and"));
		content.push(kleur.green(`${counts.assets - counts.cleaned} ${Logger.plural(counts.assets - counts.cleaned, "asset")}`));
		if(counts.cleaned) {
			content.push(kleur.gray(`(${counts.cleaned} cleaned, unused)`));
		}
		content.push(kleur.green(`from ${sourcesDisplay}`));
		if(counts.persist) {
			content.push(kleur.blue(`(${counts.persist} persisted)`));
		}
		content.push(kleur[counts.errors > 0 ? "red" : "gray"](`(${counts.errors} ${Logger.plural(counts.errors, "error")})`));
		if(this.startTime) {
			content.push(`in ${Logger.time(Date.now() - this.startTime)}`);
		}

		content.push(`(v${pkg.version})`);

		Logger.log(content.join(" "));
	}
}

export { Importer };
