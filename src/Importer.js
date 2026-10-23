import fs from "node:fs";
import { createHash } from "node:crypto";
import matter from "@11ty/gray-matter";
import kleur from "kleur";
import slugify from '@sindresorhus/slugify';
import * as entities from "entities";

import { Logger } from "./Logger.js";
import { Fetcher } from "./Fetcher.js";
import { DirectoryManager } from "./DirectoryManager.js";
import { MarkdownToHtml } from "./MarkdownToHtml.js";
import { HtmlTransformer } from "./HtmlTransformer.js";
import { Persist } from "./Persist.js";
import { Utils } from "./Utils.js";

// Data Sources
import { DataSource } from "./DataSource.js";
import { YouTubeUser } from "./DataSource/YouTubeUser.js";
import { Atom } from "./DataSource/Atom.js";
import { Rss } from "./DataSource/Rss.js";
import { WordPressApi } from "./DataSource/WordPressApi.js";
import { WordPressXml } from "./DataSource/WordPressXml.js";
import { BlueskyUser } from "./DataSource/BlueskyUser.js";
import { FediverseUser } from "./DataSource/FediverseUser.js";
import { Squarespace } from "./DataSource/Squarespace.js";
import { Twitter } from "./DataSource/Twitter.js";
import { Instagram } from "./DataSource/Instagram.js";
import { Substack } from "./DataSource/Substack.js";
import { Ghost } from "./DataSource/Ghost.js";
import { JsonFeed } from "./DataSource/JsonFeed.js";
import { Blogger } from "./DataSource/Blogger.js";
import { DevTo } from "./DataSource/DevTo.js";
import { MediumExport } from "./DataSource/MediumExport.js";
import { WaybackMachine } from "./DataSource/WaybackMachine.js";
import { Typepad } from "./DataSource/Typepad.js";
import { Hobix } from "./DataSource/Hobix.js";
import { Linktree } from "./DataSource/Linktree.js";
import { Npm } from "./DataSource/Npm.js";
import { GitHub } from "./DataSource/GitHub.js";
import { GitHubGist } from "./DataSource/GitHubGist.js";
import { CodePen } from "./DataSource/CodePen.js";
import { Webmentions } from "./DataSource/Webmentions.js";
import { Letterboxd } from "./DataSource/Letterboxd.js";
import { Flickr } from "./DataSource/Flickr.js";

import pkg from "../package.json" with { type: "json" };

// For testing
const MAX_IMPORT_SIZE_DEFAULT = 0;

class Importer {
	// Service names that map to another source type, with an optional target transform
	static ALIASES = {
		buttondown: {
			type: "rss",
			// Username or newsletter URL (custom domains too)
			getTarget(target) {
				if(target.startsWith("https://") || target.startsWith("http://")) {
					let url = new URL(target);
					if(!url.pathname.endsWith("/rss")) {
						url.pathname = url.pathname.replace(/\/?$/, "/rss");
					}
					return url.toString();
				}
				return `https://buttondown.com/${target.replace(/^@/, "")}/rss`;
			},
		},
	};

	#draftsFolder = "drafts";
	#outputFolder = ".";
	#assetReferenceType;
	#avatarReferenceType;
	#dataFiles = new Map();
	// Entries with all of their comments (none failed), so their data file items are replaced
	#completeComments = new WeakSet();
	#documentErrors = 0;

	constructor() {
		this.startTime = new Date();
		this.sources = [];
		this.isVerbose = true;
		this.dryRun = false;
		this.safeMode = true;
		this.allowDraftsToOverwrite = false;
		this.pruneAssets = false;
		this.counts = {
			files: 0,
			pruned: 0,
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

	// Third-party embeds to keep as HTML on markdown conversion: `{ selector, script, output }` (class name, optional script URL, "html" or "link")
	addEmbed(name, options) {
		this.markdownService.addEmbed(name, options);
	}

	// Built-in embed names: instagram, twitter, tiktok, bluesky
	removeEmbed(name) {
		this.markdownService.removeEmbed(name);
	}

	getCounts() {
		let fetcherCounts = this.fetcher.getCounts();
		return {
			...this.counts,
			...fetcherCounts,
			...this.markdownService.getCounts(),
			...this.persistManager.getCounts(),
			errors: fetcherCounts.errors + this.#documentErrors,
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

	// --prune
	setPruneAssets(prune) {
		this.pruneAssets = Boolean(prune);
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
		}	}

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

	static REFERENCE_TYPES = ["relative", "colocate", "absolute", "disabled"];

	// Keys in a post’s data file (e.g. `my-post.json`), filled by sources
	static DATA_KEYS = ["comments", "likes", "reposts", "bookmarks", "rsvps"];

	// Avatars are shared across posts, so default to the root assets folder (or disabled with assets)
	setAvatarReferenceType(refType) {
		if(!Importer.REFERENCE_TYPES.includes(refType)) {
			throw new Error(`Invalid value for --avatarrefs, must be one of: ${Importer.REFERENCE_TYPES.join(", ")}. Received: ${refType} (${typeof refType})`);
		}
		this.#avatarReferenceType = refType;
	}

	getAvatarReferenceType() {
		return this.#avatarReferenceType ?? (this.shouldDownloadAssets() ? "absolute" : "disabled");
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

	setFetchTimeout(timeout) {
		if(timeout !== undefined && timeout !== "") {
			this.fetcher.setFetchTimeout(timeout);
		}
	}

	setFetchRetries(retries) {
		if(retries !== undefined) {
			this.fetcher.setFetchRetries(retries);
		}
	}

		this.fetcher.setOriginLimit(origin, options);
	}

	setPersistTarget(persistTarget) {
		this.persistManager.setTarget(persistTarget);
	}

	addSource(type, options = {}) {
		let cls;
		let alias;
		if(typeof type === "string") {
			type = type?.toLowerCase();

			alias = Importer.ALIASES[type];
			if(alias) {
				type = alias.type;
			}

			if(type === "youtubeuser") {
				cls = YouTubeUser;
			} else if(type === "atom") {
				cls = Atom;
			} else if(type === "rss") {
				cls = Rss;
			} else if(type === "wordpress") {
				cls = WordPressApi;
			} else if(type === "wordpressxml") {
				cls = WordPressXml;
			} else if(type === "bluesky") {
				cls = BlueskyUser; // RSS
			} else if(type === "fediverse") {
				cls = FediverseUser;
			} else if(type === "squarespace") {
				cls = Squarespace;
			} else if(type === "twitter") {
				cls = Twitter;
			} else if(type === "instagram") {
				cls = Instagram;
			} else if(type === "substack") {
				cls = Substack;
			} else if(type === "ghost") {
				cls = Ghost;
			} else if(type === "jsonfeed") {
				cls = JsonFeed;
			} else if(type === "blogger") {
				cls = Blogger;
			} else if(type === "devto") {
				cls = DevTo;
			} else if(type === "medium") {
				cls = MediumExport;
			} else if(type === "typepad") {
				cls = Typepad;
			} else if(type === "hobix") {
				cls = Hobix;
			} else if(type === "wayback") {
				cls = WaybackMachine;
			} else if(type === "linktree") {
				cls = Linktree;
			} else if(type === "npm") {
				cls = Npm;
			} else if(type === "github") {
				cls = GitHub;
			} else if(type === "github-gist") {
				cls = GitHubGist;
			} else if(type === "codepen") {
				cls = CodePen;
			} else if(type === "webmention" || type === "webmentions") {
				cls = Webmentions;
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
		let postTypes;
		let comments;
		let content;
		let limit;
		let until;
		let contentSelector;

		if(typeof options === "string") {
			identifier = options;
		} else {
			identifier = options.url || options.id;
			label = options.label;
			filepathFormat = options.filepathFormat;
			postTypes = options.postTypes;
			comments = options.comments;
			content = options.content;
			limit = options.limit;
			until = options.until;
			contentSelector = options.contentSelector;
		}

		if(alias?.getTarget && identifier) {
			identifier = alias.getTarget(identifier);
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

		if(postTypes) {
			if(typeof source.setPostTypes !== "function") {
				throw new Error(`The postTypes option is not supported by the ${source.constructor.TYPE} source type.`);
			}
			source.setPostTypes(postTypes);
		}

		if(limit) {
			source.setLimit(limit);
		}

		if(until) {
			source.setUntil(until);
		}

		if(contentSelector) {
			if(typeof source.setContentSelector !== "function") {
				throw new Error(`The contentSelector option is not supported by the ${source.constructor.TYPE} source type.`);
			}
			source.setContentSelector(contentSelector);
		}

		// Enabled by default for sources that support comments
		if(comments !== undefined) {
			if(comments && !source.constructor.SUPPORTS_COMMENTS) {
				throw new Error(`The comments option is not supported by the ${source.constructor.TYPE} source type.`);
			}
			source.setComments(comments);
		}

		if(content !== undefined) {
			source.setContent(content);
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
			this.#keepAsset(localUrl, cleanEntry);
		}
	}

	// Assets referenced in front matter aren’t removed with unused `srcset` assets from the same URL
	#keepAsset(localUrl, entry) {
		if(typeof localUrl === "string" && entry.filePath) {
			this.markdownService.assetsToKeep.add(this.markdownService.recontextifyRelativeAssetPath(localUrl, entry.filePath));
		}
	}

	// Downloads avatars and makes author URLs on the imported site root-relative
	async transformAuthors(cleanEntry) {
		if(!Array.isArray(cleanEntry?.authors)) {
			return;
		}

		let siteUrl = cleanEntry.source?.getSiteUrl();

		// New objects so authors shared across entries aren’t mutated
		cleanEntry.authors = await Promise.all(cleanEntry.authors.map(async author => {
			if(!author) {
				return author;
			}

			let transformed = { ...author };
			if(author.avatarUrl) {
				transformed.avatarUrl = await this.fetcher.fetchAsset(author.avatarUrl, cleanEntry, this.getAvatarReferenceType());
				this.#keepAsset(transformed.avatarUrl, cleanEntry);
			}

			let relativeUrl = author.url && HtmlTransformer.getSiteRelativeUrl(author.url, siteUrl);
			if(relativeUrl) {
				transformed.url = relativeUrl;
			}

			return transformed;
		}));
	}

	async addComments(entries) {
		let entriesBySource = new Map();
		for(let entry of entries) {
			let source = entry.source;
			if(typeof source?.addComments === "function" && source.shouldIncludeComments()) {
				if(!entriesBySource.has(source)) {
					entriesBySource.set(source, []);
				}
				entriesBySource.get(source).push(entry);
			}
		}

		await Promise.all(Array.from(entriesBySource).map(async ([source, sourceEntries]) => {
			source.resetCommentErrors();
			await source.addComments(sourceEntries);
			// Failed requests without entries affect all of the source’s entries
			if(source.hasUnattributedCommentErrors()) {
				source.setCommentsIncomplete(sourceEntries);
			}
		}));

		for(let entry of entries) {
			if(entry.source?.shouldIncludeComments() && !DataSource.hasIncompleteComments(entry)) {
				this.#completeComments.add(entry);
			}
		}

		for(let entry of entries) {
			for(let key of Importer.DATA_KEYS) {
				if(Array.isArray(entry[key]) && entry[key].length === 0) {
					delete entry[key];
				}
			}
		}
	}

	async #fetchAvatar(author, entry) {
		if(!author?.avatarUrl) {
			return author;
		}
		let avatarUrl = await this.fetcher.fetchAsset(author.avatarUrl, entry, this.getAvatarReferenceType());
		this.#keepAsset(avatarUrl, entry);
		return { ...author, avatarUrl };
	}

	// `COMMENT_ASSETS` downloads content assets and avatars, `COMMENT_AVATARS` downloads avatars only
	async transformComments(entry) {
		let { COMMENT_ASSETS, COMMENT_AVATARS } = entry.source?.constructor || {};
		if(!COMMENT_ASSETS && !COMMENT_AVATARS) {
			return;
		}

		for(let key of Importer.DATA_KEYS) {
			if(!Array.isArray(entry[key])) {
				continue;
			}

			entry[key] = await Promise.all(entry[key].map(async item => {
				let transformed = { ...item };
				if(item.content && COMMENT_ASSETS) {
					transformed.content = await this.htmlTransformer.transform(item.content, entry);
				}
				if(item.author) {
					transformed.author = await this.#fetchAvatar(item.author, entry);
				}
				return transformed;
			}));
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

			// Also rewrites links when assets aren’t downloaded
			content = await this.htmlTransformer.transform(transformedHtml, entry);
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


	// Data files are always rewritten
	static isDataOnly(entry) {
		return Boolean(entry.source?.constructor.DATA_ONLY);
	}

	// Is used to filter getEntries and in toFiles (which also checks conflicts)
	shouldSkipEntry(entry) {
		if(entry.filePath === false) {
			return true;
		}

		if(Importer.isDataOnly(entry)) {
			return false;
		}

		// Unedited files are always rewritten
		if(this.safeMode && fs.existsSync(entry.filePath) && Importer.isLocallyModified(entry.filePath)) {
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
		let skippedEntries = [];
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
					skippedEntries.push(entry);
				} else {
					entries.push(entry);
				}
			}
		}

		if(maxLimit) {
			entries = entries.slice(0, maxLimit);
		}

		// Skipped entries are included, their files already exist
		this.htmlTransformer.setEntryFilePaths([...entries, ...skippedEntries]);

		// After skipped entries are removed to avoid extra requests
		await this.addComments(entries);

		let promises = await Promise.allSettled(entries.map(async entry => {
			await this.fetchRelatedMedia(entry);
			await this.transformAuthors(entry);

			if(Importer.isDataOnly(entry)) {
				await this.transformComments(entry);
			} else if(entry.source?.shouldIncludeContent() === false) {
				entry.content = "";
			} else {
				await this.transformComments(entry);
				entry.content = await this.getTransformedContent(entry, outputContentTypeOverride === "markdown");
			}

			if(outputContentTypeOverride === "markdown" && Importer.shouldConvertToMarkdown(entry)) {
				entry.contentType = "markdown";
			}

			return entry;
		}));

		if(!this.dryRun) {
			this.markdownService.cleanup();
		}

		return promises.filter((entry, index) => {
			// Documents with errors
			if(entry.status === "rejected") {
				this.#documentErrors++;
				if(this.isVerbose) {
					Logger.error(`Error processing document ${entries[index].url}: ${entry.reason?.message}`);
				}
				return false;
			}
			return true;
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
			return Utils.pathJoin(this.#outputFolder, pathname);
		}

		// URLs ending in `.html` (e.g. Blogger, some WordPress permalinks) get the output extension instead
		fallbackPath = fallbackPath.replace(/\.html?$/i, "");

		// WordPress draft posts only have a `p` query param e.g. ?p=ID_NUMBER
		if(fallbackPath === "/") {
			fallbackPath = Fetcher.createHash(entry.url);
		}

		let subdirs = [];
		if(this.#draftsFolder && entry.status === "draft") {
			subdirs.push(this.#draftsFolder);
		}

		// Always uses `/` separators (Windows compatible) so downstream path handling can split on `/`
		// Output folder is first so absolute paths are kept
		let pathname = Utils.pathJoin(this.#outputFolder || ".", ...subdirs, fallbackPath);
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

	static IMPORT_HASH_KEY = "importHash";

	// Front matter data (without `importHash`) and body
	static createContentHash(data, body) {
		return createHash("sha256").update(`${JSON.stringify(data)}\n${body}`).digest("hex").slice(0, 16);
	}

	// Files without a matching `importHash` were edited after import (or imported by an earlier version)
	static isLocallyModified(filePath) {
		return !Importer.getImportHash(filePath);
	}

	// Stored `importHash` and the hash computed from the rest of the file
	static parseImportHash(fileContent) {
		// Options skip gray-matter’s cache
		let { data, content } = matter(fileContent.replace(/\r\n/g, "\n"), {});
		let { [Importer.IMPORT_HASH_KEY]: hash, ...metadata } = data.metadata || {};

		return {
			hash,
			computed: Importer.createContentHash({ ...data, metadata }, content),
		};
	}

	// Hash of an unedited file, otherwise undefined
	static getImportHash(filePath) {
		try {
			let { hash, computed } = Importer.parseImportHash(fs.readFileSync(filePath, "utf8"));
			if(hash && hash === computed) {
				return hash;
			}
		} catch(e) {
			// Invalid front matter
		}
	}

	static getFileContent(entry) {
		// A file object keeps content starting with `---` from being parsed as front matter
		let toContent = importHash => matter.stringify({ content: entry.content }, Importer.getFrontMatterData(entry, { importHash }));

		// Hashed the same way getImportHash reads it back
		let { computed: hash } = Importer.parseImportHash(toContent());
		return { content: toContent(hash), hash };
	}

	static getFrontMatterData(entry, { importHash } = {}) {
		let data = {};
		data.title = entry.title;
		if(entry.description) {
			data.description = entry.description;
		}
		data.authors = entry.authors;
		data.date = entry.date;
		data.metadata = entry.metadata || {};
		data.metadata.uuid = entry.uuid;
		data.metadata.type = entry.type;
		data.metadata.url = entry.url;
		if(importHash) {
			data.metadata = { ...data.metadata, [Importer.IMPORT_HASH_KEY]: importHash };
		}

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

		return data;
	}

	// Template data file next to the post (e.g. `my-post.md` → `my-post.json`)
	static getCommentsFilePath(filePath) {
		return filePath.replace(/\.[^./]+$/, "") + ".json";
	}

	static hasData(entry) {
		return Importer.DATA_KEYS.some(key => Array.isArray(entry[key]));
	}

	// Merges into an existing data file: each item has a `via` (source type) and a source only replaces its own items
	// Items without `via` (earlier imports) belong to post sources, duplicate URLs from data only sources are dropped
	// With `replace: false` (incomplete comments) existing items are kept and items with the same `id` are updated
	static convertCommentsToJson(entry, existingData = {}, { replace = true } = {}) {
		let via = entry.source?.constructor.TYPE;
		let isDataOnly = Importer.isDataOnly(entry);
		let isOwn = item => item?.via === via || (!item?.via && !isDataOnly);
		let byDate = (a, b) => new Date(a.date) - new Date(b.date);

		let data = { ...existingData };
		for(let key of Importer.DATA_KEYS) {
			let existingItems = Array.isArray(existingData[key]) ? existingData[key] : [];
			let others = existingItems.filter(item => !isOwn(item));
			let own = (entry[key] || []).map(item => ({ ...item, via }));
			if(!replace) {
				let ids = new Set(own.map(item => item.id));
				own = [...existingItems.filter(item => isOwn(item) && !ids.has(item.id)), ...own];
			}

			let otherUrls = new Set(others.map(item => item.url).filter(Boolean));
			let ownUrls = new Set(own.map(item => item.url).filter(Boolean));
			if(isDataOnly) {
				own = own.filter(item => !otherUrls.has(item.url));
			} else {
				others = others.filter(item => !ownUrls.has(item.url));
			}

			let items = [...others, ...own].sort(byDate);
			if(items.length) {
				data[key] = items;
			} else {
				delete data[key];
			}
		}

		// Empty an existing file instead of leaving stale items
		if(Object.keys(data).length === 0) {
			return Object.keys(existingData).length ? "{}" : undefined;
		}

		return JSON.stringify(data, null, "\t");
	}

	// Contents written earlier in this run (also for --dryrun) take precedence over the file system
	#readDataFile(pathname) {
		let raw = this.#dataFiles.get(pathname);
		if(raw === undefined && fs.existsSync(pathname)) {
			raw = fs.readFileSync(pathname, "utf8");
		}
		if(raw === undefined) {
			return {};
		}

		try {
			return { raw, data: JSON.parse(raw) };
		} catch(e) {
			throw new Error(`Could not parse existing data file ${pathname}: ${e.message}`);
		}
	}

	// TODO options.pathPrefix
	async toFiles(entries = []) {
		let filepathConflicts = {};
		let postDirectories = new Set();
		let fileContents = new Map();

		for(let entry of entries) {
			let pathname = entry.filePath;
			if(pathname === false) {
				continue;
			}

			// Data only entries share data files with posts
			let isDataOnly = Importer.isDataOnly(entry);
			let conflictKey = `${isDataOnly ? "data" : "post"}:${pathname}`;
			if(filepathConflicts[conflictKey]) {
				throw new Error(`Multiple entries attempted to write to the same place: ${pathname} (originally via ${filepathConflicts[conflictKey]})`);
			}
			filepathConflicts[conflictKey] = entry.url || true;

			let files = [];
			if(!isDataOnly) {
				let { content, hash } = Importer.getFileContent(entry);

				if(this.shouldSkipEntry(entry)) {
					if(this.isVerbose) {
						Logger.skipping("post", pathname, entry.url, { reason: "locally modified, no --overwrite" });
					}
					continue;
				}

				postDirectories.add(DirectoryManager.getDirectory(pathname));
				fileContents.set(pathname, content);

				if(fs.existsSync(pathname) && Importer.getImportHash(pathname) === hash) {
					if(this.isVerbose) {
						Logger.skipping("post", pathname, entry.url, { reason: "unchanged" });
					}
				} else {
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

					files.push({ pathname, content, type: "post" });
				}
			}

			// Data only sources and complete comments replace their items, incomplete comments are merged
			let replace = isDataOnly || this.#completeComments.has(entry);
			let commentsPathname = Importer.getCommentsFilePath(pathname);
			let existing = (replace || Importer.hasData(entry)) ? this.#readDataFile(commentsPathname) : undefined;
			let commentsContent = existing && Importer.convertCommentsToJson(entry, existing.data, { replace });
			if(commentsContent !== undefined && commentsContent !== existing.raw) {
				this.#dataFiles.set(commentsPathname, commentsContent);
				fileContents.set(commentsPathname, commentsContent);
				files.push({ pathname: commentsPathname, content: commentsContent, type: "comments" });

				if(this.isVerbose) {
					Logger.importing("comments", commentsPathname, entry.url, {
						size: commentsContent.length,
						dryRun: this.dryRun
					});
				}

				if(!this.dryRun) {
					this.directoryManager.createDirectoryForPath(commentsPathname);
					fs.writeFileSync(commentsPathname, commentsContent, { encoding: "utf8" });
				}
			}

			// Happens independent of file system (--dryrun or --overwrite)
			// Don’t persist if post is a draft
			if(entry.status !== "draft" && this.persistManager.canPersist()) {
				for(let file of files) {
					await this.persistManager.persistFile(file.pathname, file.content, {
						url: entry.url,
						type: file.type,
					});
				}
			}
		}

		if(this.pruneAssets) {
			this.#pruneAssets(postDirectories, fileContents);
		}
	}

	static TEXT_FILE_EXTENSIONS = ["md", "markdown", "html", "htm", "json", "yaml", "yml", "js", "cjs", "mjs", "njk", "liquid"];

	// Removes generated asset files (e.g. from earlier imports) in imported post folders that weren’t used in this import and aren’t referenced by any file in the folder
	#pruneAssets(directories, fileContents) {
		// Shared root folder may hold assets for posts outside of this import
		if(this.#assetReferenceType !== "relative" && this.#assetReferenceType !== "colocate") {
			return;
		}

		// Failed downloads aren’t referenced locally, so don’t delete the only copy
		if(this.fetcher.errors.size > 0) {
			if(this.isVerbose) {
				Logger.warning("Skipping --prune because of fetch errors");
			}
			return;
		}

		for(let dir of directories) {
			let assetDir = Utils.pathJoin(dir || ".", this.fetcher.getAssetsFolder());
			if(!fs.existsSync(assetDir)) {
				continue;
			}

			let candidates = fs.readdirSync(assetDir, { withFileTypes: true }).filter(file => {
				return file.isFile() && Fetcher.isAssetFilename(file.name) && !this.fetcher.writtenAssetFiles.has(Utils.pathJoin(assetDir, file.name));
			}).map(file => file.name);

			if(!candidates.length) {
				continue;
			}

			// Contents written in this run (also for --dryrun) take precedence over the file system
			let references = fs.readdirSync(dir || ".", { withFileTypes: true }).filter(file => {
				return file.isFile() && !Fetcher.isAssetFilename(file.name) && Importer.TEXT_FILE_EXTENSIONS.includes(file.name.split(".").pop());
			}).map(file => {
				let pathname = Utils.pathJoin(dir, file.name);
				return fileContents.get(pathname) ?? fs.readFileSync(pathname, "utf8");
			});

			for(let name of candidates) {
				if(references.some(content => content.includes(name))) {
					continue;
				}

				let pathname = Utils.pathJoin(assetDir, name);
				if(this.isVerbose) {
					Logger.cleanup("stale asset", pathname, { dryRun: this.dryRun });
				}

				this.counts.pruned++;
				if(!this.dryRun) {
					fs.unlinkSync(pathname);
				}
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
		if(counts.pruned) {
			content.push(kleur.gray(`(${counts.pruned} pruned, stale)`));
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
