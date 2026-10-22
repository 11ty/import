import posthtml from "posthtml";
import * as entities from "entities";

import { DataSource } from "../DataSource.js";
import { Logger } from "../Logger.js";

// Latest archived HTML pages for a site (or a path on a site) from the Internet Archive’s Wayback Machine (https://archive.org/developers/wayback-cdx-server.html)
export class WaybackMachine extends DataSource {
	static TYPE = "wayback";
	static TYPE_FRIENDLY = "Wayback Machine";
	static HOST = "https://web.archive.org";
	static FIELDS = ["urlkey", "timestamp", "original"];
	static PER_PAGE = 5000;
	static FIRST_YEAR = 1996;
	static TIMEOUT = "60s";
	static CONCURRENCY = 2;
	static CONTENT_CLASSES = ["e-content", "entry-content", "post-content", "article-content", "post-body"];
	static REMOVED_TAGS = ["script", "style", "noscript", "template", "nav", "header", "footer", "aside", "form"];
	static ASSET_ATTRIBUTES = ["src", "poster", "srcset"];
	static LINKS_TO_FILES = true;

	// Original asset URL to the first archive URL used for it
	#assetUrls = new Map();
	#contentSelector;

	constructor(target) {
		super();
		this.url = WaybackMachine.parseTarget(target);
		this.to = WaybackMachine.getArchiveTimestamp(String(target).trim());
	}

	// Simple selector for the content element (e.g. `div.entry`, `.entry-content`, `#main`), pages without a match are skipped
	setContentSelector(selector) {
		let match = String(selector).trim().match(/^([a-z][a-z0-9-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/i);
		if(!match || !match.slice(1).some(Boolean)) {
			throw new Error(`Invalid content selector \`${selector}\`, expected a tag, id, and/or class names (e.g. div.entry, .entry-content, #main)`);
		}
		let [, tag, id, classes] = match;
		let classNames = classes.split(".").filter(Boolean);
		this.#contentSelector = node => (!tag || node.tag?.toLowerCase() === tag.toLowerCase())
			&& (!id || node.attrs?.id === id)
			&& classNames.every(name => WaybackMachine.hasClass(node, name));
	}

	// Also limits captures (e.g. before a domain was parked)
	setUntil(until) {
		this.to = super.setUntil(until);
	}

	// Captures on or before the Wayback Machine URL timestamp (e.g. `2022` or `20221120`) skip later content, like a parked domain
	static getArchiveTimestamp(url) {
		return url.match(/^(?:https?:)?(?:\/\/)?web\.archive\.org\/web\/(\d{1,14})/i)?.[1];
	}

	// Domain, URL, or a Wayback Machine URL (e.g. `https://web.archive.org/web/2020/https://example.com/`)
	static parseTarget(target) {
		let url = String(target).trim();
		let archived = WaybackMachine.getUnarchivedUrl(url);
		if(archived) {
			url = archived;
		}
		if(!/^https?:\/\//i.test(url)) {
			url = `https://${url}`;
		}

		let parsed = new URL(url);
		parsed.search = "";
		parsed.hash = "";
		return parsed;
	}

	static getUnarchivedUrl(url) {
		return url.match(/^(?:https?:)?(?:\/\/)?web\.archive\.org\/web\/[^/]*\/(.+)$/i)?.[1];
	}

	static getArchiveUrl(timestamp, url, modifier = "id_") {
		return `${WaybackMachine.HOST}/web/${timestamp}${modifier}/${url}`;
	}

	// `20200102030405` → Date
	static timestampToDate(timestamp) {
		let [, year, month, day, hours = 0, minutes = 0, seconds = 0] = String(timestamp).match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/) || [];
		if(year) {
			return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
		}
	}

	// Same page with or without a trailing slash, `index.html`, or extension (matches `getFilePath`), pages with a query string are skipped
	static getPageKey(urlkey) {
		if(urlkey.includes("?")) {
			return;
		}
		return urlkey
			.replace(/\/index\.(?:html?|php)$/i, "")
			.replace(/\.(?:html?|php)$/i, "")
			.replace(/\/$/, "");
	}

	// Resume key rows follow an empty row at the end
	static getResumeKey(rows) {
		if(rows.at(-2)?.length === 0 && rows.at(-1)?.length === 1) {
			return rows.at(-1)[0];
		}
	}

	static getFilePath(url) {
		let pathname = new URL(url).pathname
			.replace(/\/index\.(?:html?|php)$/i, "/")
			.replace(/\.(?:html?|php)$/i, "");
		return pathname === "/" ? "/index" : pathname;
	}

	getSiteUrl() {
		return `${this.url.origin}${this.url.pathname}`;
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${this.constructor.TYPE}::${entry.key}`;
	}

	getRawEntryDates(rawEntry) {
		return {
			updated: WaybackMachine.timestampToDate(rawEntry.timestamp),
		};
	}

	#getCdxUrl(resumeKey, range = {}) {
		let params = new URLSearchParams({
			url: `${this.url.host}${range.pathname || this.url.pathname}`,
			matchType: "prefix",
			output: "json",
			fl: WaybackMachine.FIELDS.join(","),
			filter: "statuscode:200",
			collapse: "digest",
			showResumeKey: "true",
			limit: WaybackMachine.PER_PAGE,
		});
		params.append("filter", "mimetype:text/html");
		if(range.from) {
			params.set("from", range.from);
		}
		if(range.to || this.to) {
			params.set("to", range.to || this.to);
		}
		if(resumeKey) {
			params.set("resumeKey", resumeKey);
		}
		return `${WaybackMachine.HOST}/cdx/search/cdx?${params}`;
	}

	// Bursts of requests (e.g. archived assets) are rate limited
	setFetcher(fetcher) {
		super.setFetcher(fetcher);
		fetcher.setOriginLimit(WaybackMachine.HOST, { concurrency: WaybackMachine.CONCURRENCY });
	}

	// The Wayback Machine is often slow to respond
	getFetchOptions() {
		return {
			timeout: WaybackMachine.TIMEOUT,
		};
	}

	// CDX queries newest first when limited (results are in URL order, not date order), otherwise one query for everything
	getCaptureRanges() {
		if(!this.getLimit()) {
			return [{}];
		}

		let ranges = [];
		let lastYear = Number(this.to?.slice(0, 4)) || new Date().getUTCFullYear();
		for(let year = lastYear; year >= WaybackMachine.FIRST_YEAR; year--) {
			let from = String(year);
			ranges.push({ from, to: this.to?.startsWith(from) ? this.to : from });
		}
		return ranges;
	}

	// One capture per page: the latest (for content) and the earliest (a fallback publish date), stops at a range with enough pages for the limit
	async #getCaptures() {
		let pages = new Map();
		for(let range of this.getCaptureRanges()) {
			await this.#addCaptures(pages, range);
			if(this.getLimit() && pages.size >= this.getLimit()) {
				break;
			}
		}
		return Array.from(pages.values());
	}

	async #addCaptures(pages, range) {
		let resumeKey;
		do {
			let url = this.#getCdxUrl(resumeKey, range);
			let rows = await super.getData(url, "json") || [];
			resumeKey = WaybackMachine.getResumeKey(rows);

			for(let row of rows) {
				if(row.length !== WaybackMachine.FIELDS.length || row[0] === "urlkey") {
					continue;
				}

				let [urlkey, timestamp, original] = row;
				let key = WaybackMachine.getPageKey(urlkey);
				if(!key || !this.isPage(urlkey)) {
					continue;
				}

				let page = pages.get(key);
				if(!page) {
					pages.set(key, { key, timestamp, original, firstTimestamp: timestamp });
				} else {
					if(timestamp > page.timestamp) {
						page.timestamp = timestamp;
						page.original = original;
					}
					if(timestamp < page.firstTimestamp) {
						page.firstTimestamp = timestamp;
					}
				}
			}
		} while(resumeKey);
	}

	// Hooks for site-specific subclasses
	isPage(urlkey) {
		return true;
	}

	// Newest first, the earliest capture is close to the publish date
	getRawEntrySortValue(page) {
		return page.firstTimestamp;
	}

	getContentNode(tree) {
		return WaybackMachine.getContentNode(tree);
	}

	// `{ title, date, authors, tags, comments }`, each optional
	async getPageData(tree, options) {
		return {};
	}

	async getData(url, ...args) {
		if(url) {
			return super.getData(url, ...args);
		}
		return this.#getCaptures();
	}

	// Pages that failed to fetch are skipped
	async getCleanedEntries(data) {
		return (await super.getCleanedEntries(data)).filter(Boolean);
	}

	static find(nodes, test) {
		for(let node of nodes || []) {
			if(!node || typeof node !== "object") {
				continue;
			}
			if(test(node)) {
				return node;
			}
			let found = WaybackMachine.find(node.content, test);
			if(found) {
				return found;
			}
		}
	}

	static findAll(nodes, test, results = []) {
		for(let node of nodes || []) {
			if(!node || typeof node !== "object") {
				continue;
			}
			if(test(node)) {
				results.push(node);
			}
			WaybackMachine.findAll(node.content, test, results);
		}
		return results;
	}

	static hasClass(node, name) {
		return (node.attrs?.class || "").split(/\s+/).includes(name);
	}

	static getText(node) {
		if(typeof node === "string") {
			return node;
		}
		return (node?.content || []).map(child => WaybackMachine.getText(child)).join("");
	}

	// `property`, `name`, or `itemprop` to `content` values
	static getMeta(tree) {
		let meta = {};
		for(let node of WaybackMachine.findAll(tree, node => node.tag === "meta" && node.attrs?.content)) {
			let name = (node.attrs.property || node.attrs.name || node.attrs.itemprop || "").toLowerCase();
			if(name) {
				(meta[name] ??= []).push(node.attrs.content.trim());
			}
		}
		return meta;
	}

	// First JSON-LD item with a publish date
	static getLinkedData(tree) {
		let items = [];
		for(let node of WaybackMachine.findAll(tree, node => node.tag === "script" && node.attrs?.type === "application/ld+json")) {
			try {
				items.push(JSON.parse(WaybackMachine.getText(node)));
			} catch(e) {
				// invalid JSON
			}
		}

		return items.flat().flatMap(item => item?.["@graph"] || [item]).find(item => item?.datePublished) || {};
	}

	static getContentNode(tree) {
		let tests = [
			node => node.attrs?.itemprop === "articleBody",
			node => WaybackMachine.CONTENT_CLASSES.some(name => WaybackMachine.hasClass(node, name)),
			node => node.tag === "article",
			node => node.tag === "main" || node.attrs?.role === "main",
			node => node.tag === "body",
		];

		for(let test of tests) {
			let node = WaybackMachine.find(tree, test);
			if(node) {
				return node;
			}
		}
	}

	static removeNodes(nodes) {
		return (nodes || []).filter(node => {
			if(typeof node === "string") {
				return !node.trim().startsWith("<!--");
			}
			return !WaybackMachine.REMOVED_TAGS.includes(node?.tag);
		}).map(node => {
			if(node?.content) {
				node.content = WaybackMachine.removeNodes(node.content);
			}
			return node;
		});
	}

	static firstDate(...values) {
		for(let value of values) {
			let date = value instanceof Date ? value : new Date(Date.parse(value));
			if(value && !isNaN(date)) {
				return date;
			}
		}
	}

	#resolveUrl(url, baseUrl) {
		url = url.trim();
		if(!url || /^(?:#|data:|mailto:|tel:|javascript:)/i.test(url)) {
			return;
		}

		try {
			let resolved = new URL(url, baseUrl).toString();
			return WaybackMachine.getUnarchivedUrl(resolved) || resolved;
		} catch(e) {
			// invalid URL
		}
	}

	// Assets are only fetched from the archive, never the live site, one archive URL per asset (any timestamp redirects to the nearest capture)
	#resolveAssetUrl(url, baseUrl, timestamp) {
		let resolved = this.#resolveUrl(url, baseUrl);
		if(resolved) {
			if(!this.#assetUrls.has(resolved)) {
				this.#assetUrls.set(resolved, WaybackMachine.getArchiveUrl(timestamp, resolved));
			}
			return this.#assetUrls.get(resolved);
		}
	}

	// Absolute URLs (lazy-loaded images too) so links to the site are root-relative
	resolveUrls(nodes, baseUrl, timestamp) {
		for(let node of WaybackMachine.findAll(nodes, node => node.attrs)) {
			let { attrs } = node;
			if(node.tag === "img" && attrs["data-src"] && (!attrs.src || attrs.src.startsWith("data:"))) {
				attrs.src = attrs["data-src"];
			}

			for(let name of WaybackMachine.ASSET_ATTRIBUTES) {
				if(typeof attrs[name] !== "string") {
					continue;
				}

				if(name === "srcset") {
					attrs.srcset = attrs.srcset.split(",").map(candidate => {
						let [url, ...descriptors] = candidate.trim().split(/\s+/);
						return [this.#resolveAssetUrl(url, baseUrl, timestamp) || url, ...descriptors].join(" ");
					}).join(", ");
				} else {
					attrs[name] = this.#resolveAssetUrl(attrs[name], baseUrl, timestamp) || attrs[name];
				}
			}

			if(typeof attrs.href === "string" && (node.tag === "a" || node.tag === "area")) {
				attrs.href = this.#resolveUrl(attrs.href, baseUrl) || attrs.href;
			}
		}
	}

	async cleanEntry(rawEntry) {
		let { timestamp, original } = rawEntry;
		let archiveUrl = WaybackMachine.getArchiveUrl(timestamp, original);

		let html;
		try {
			html = await this.getData(archiveUrl, "text");
		} catch(e) {
			return;
		}

		// Pathologically nested markup (e.g. thousands of unclosed tags) overflows the call stack, the page is skipped
		try {
			return await this.#cleanPage(rawEntry, html);
		} catch(e) {
			if(!(e instanceof RangeError)) {
				throw e;
			}
			if(this.isVerbose) {
				Logger.error(`Skipping ${this.getLogUrl(archiveUrl)}: markup is nested too deeply to parse`);
			}
		}
	}

	async #cleanPage(rawEntry, html) {
		let { timestamp, original } = rawEntry;
		let url = new URL(original).toString();
		let { tree } = await posthtml().process(String(html));
		let meta = WaybackMachine.getMeta(tree);
		let linkedData = WaybackMachine.getLinkedData(tree);
		let baseUrl = this.#resolveUrl(WaybackMachine.find(tree, node => node.tag === "base")?.attrs?.href || "", url) || url;

		let pageData = await this.getPageData(tree, { baseUrl, timestamp });
		let contentNode = this.#contentSelector ? WaybackMachine.find(tree, this.#contentSelector) : this.getContentNode(tree);
		if(this.#contentSelector && !contentNode) {
			return;
		}
		let contentNodes = WaybackMachine.removeNodes(contentNode ? contentNode.content : tree);
		this.resolveUrls(contentNodes, baseUrl, timestamp);

		let heading = WaybackMachine.find(contentNodes, node => node.tag === "h1");
		let headingText = heading ? WaybackMachine.getText(heading).trim() : undefined;
		let title = pageData.title
			|| meta["og:title"]?.[0]
			|| linkedData.headline
			|| headingText
			|| WaybackMachine.getText(WaybackMachine.find(tree, node => node.tag === "title")).trim();

		// Title is in front matter
		if(heading && entities.decodeHTML(headingText) === entities.decodeHTML(title)) {
			heading.tag = false;
			heading.content = [];
		}

		let time = WaybackMachine.find(contentNodes, node => node.tag === "time" && node.attrs?.datetime && WaybackMachine.hasClass(node, "dt-published"))
			|| WaybackMachine.find(contentNodes, node => node.tag === "time" && node.attrs?.datetime);

		let date = WaybackMachine.firstDate(
			pageData.date,
			meta["article:published_time"]?.[0],
			linkedData.datePublished,
			meta["datepublished"]?.[0],
			meta["date"]?.[0],
			time?.attrs.datetime,
			WaybackMachine.timestampToDate(rawEntry.firstTimestamp),
		);
		let dateUpdated = WaybackMachine.firstDate(meta["article:modified_time"]?.[0], linkedData.dateModified);

		let authorNames = pageData.authors || meta["author"] || [linkedData.author].flat().map(author => typeof author === "string" ? author : author?.name);

		let metadata = {
			archiveUrl: WaybackMachine.getArchiveUrl(timestamp, original, ""),
		};

		let image = meta["og:image"]?.[0];
		let featuredImage = image && this.#resolveAssetUrl(image, baseUrl, timestamp);
		if(featuredImage) {
			metadata.media = { featuredImage };
		}

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: this.constructor.TYPE,
			title,
			url,
			authors: authorNames.filter(Boolean).map(name => ({ name })),
			date,
			dateUpdated,
			content: (await posthtml().process(contentNodes, { skipParse: true })).html.trim(),
			contentType: "html",
			metadata,
		};

		let description = DataSource.htmlToPlainText(meta["description"]?.[0] || meta["og:description"]?.[0]);
		if(description) {
			cleanEntry.description = description;
		}

		let tags = pageData.tags || meta["article:tag"] || [];
		if(tags.length) {
			cleanEntry.tags = tags;
		}

		if(this.shouldIncludeComments() && pageData.comments?.length) {
			cleanEntry.comments = pageData.comments;
		}

		return cleanEntry;
	}
}
