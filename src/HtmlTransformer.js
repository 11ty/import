import path from "node:path";
import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import urlsDefaults from "@11ty/posthtml-urls/lib/defaultOptions.js";
import * as entities from "entities";

const ASSET_TAGS = ["img", "video", "audio", "source", "link", "script", "track"];
// Media type of an element, `<source>` and `<track>` use their parent’s
const MEDIA_TAGS = {
	img: "image",
	picture: "image",
	audio: "audio",
	video: "video",
};

class HtmlTransformer {
	#fetcher;
	// Page key to imported file path
	#filePaths = new Map();

	setFetcher(fetcher) {
		this.#fetcher = fetcher;
	}

	setEntryFilePaths(entries) {
		this.#filePaths = new Map();
		for(let entry of entries) {
			let key = entry.filePath && HtmlTransformer.getPageKey(entry.url);
			if(key && !this.#filePaths.has(key)) {
				this.#filePaths.set(key, entry.filePath);
			}
		}
	}

	// Same page with or without `www.`, a trailing slash, `index.html`, or extension
	static getPageKey(url) {
		try {
			let { hostname, pathname, search } = new URL(url);
			if(search) {
				return;
			}
			pathname = pathname
				.replace(/\/index\.(?:html?|php)$/i, "")
				.replace(/\.(?:html?|php)$/i, "")
				.replace(/\/$/, "");
			return `${this.#normalizeHostname(hostname)}${pathname}`;
		} catch(e) {
			// invalid URL
		}
	}

	static #normalizeHostname(hostname) {
		return hostname.replace(/^www\./, "");
	}

	static isSiteUrl(url, siteUrl) {
		let site = new URL(siteUrl);
		let sitePathname = site.pathname.endsWith("/") ? site.pathname : `${site.pathname}/`;

		return this.#normalizeHostname(url.hostname) === this.#normalizeHostname(site.hostname)
			&& `${url.pathname}/`.startsWith(sitePathname);
	}

	static isAbsoluteUrl(url) {
		return url.startsWith("https:") || url.startsWith("http:") || url.startsWith("//");
	}

	// Root-relative path for absolute URLs on the imported site
	static getSiteRelativeUrl(url, siteUrl) {
		if(!siteUrl || !this.isAbsoluteUrl(url)) {
			return;
		}

		let resolved;
		try {
			resolved = new URL(url.startsWith("//") ? `https:${url}` : url);
		} catch(e) {
			return;
		}

		// Links with a query string (e.g. `?p=123`, search) won’t exist on a static site
		if(resolved.search || !this.isSiteUrl(resolved, siteUrl)) {
			return;
		}

		return `${resolved.pathname}${resolved.hash}`;
	}

	// Downloads linked files (e.g. uploads) and makes links to the imported site root-relative
	async transformLink(url, entry) {
		let source = entry.source;

		let resolved;
		try {
			resolved = new URL(url, entry.url);
		} catch(e) {
			return;
		}

		if(resolved.protocol !== "https:" && resolved.protocol !== "http:") {
			return;
		}

		if(source?.isLinkedAsset(resolved)) {
			return this.#fetcher.fetchAsset(resolved.toString(), entry);
		}

		let siteRelativeUrl = HtmlTransformer.getSiteRelativeUrl(url, source?.getSiteUrl());

		// Links to other imported pages point to their files (relative to this one), for sources with URLs that don’t match their output (e.g. `.html`)
		let filePath = siteRelativeUrl && source?.constructor.LINKS_TO_FILES && entry.filePath && this.#filePaths.get(HtmlTransformer.getPageKey(resolved));
		if(filePath) {
			return `${path.posix.relative(path.posix.dirname(entry.filePath), filePath)}${resolved.hash}`;
		}

		return siteRelativeUrl;
	}

	// Elements (and their descendants) of media types the source doesn’t download
	static getSkippedNodes(tree, source) {
		let nodes = new WeakSet();
		let add = node => {
			if(node && typeof node === "object") {
				nodes.add(node);
				for(let child of node.content || []) {
					add(child);
				}
			}
			return node;
		};
		let tags = Object.keys(MEDIA_TAGS).filter(tag => source.shouldDownloadAssets(MEDIA_TAGS[tag]) === false);
		if(tags.length) {
			tree.match(tags.map(tag => ({ tag })), add);
		}
		return nodes;
	}

	// Default posthtml-urls filter minus skipped nodes, `eachURL` only receives the tag name
	static getUrlsFilter(skippedNodes) {
		return Object.fromEntries(Object.entries(urlsDefaults.filter).map(([tag, attrs]) => [
			tag,
			Object.fromEntries(Object.entries(attrs).map(([attr, accept]) => [
				attr,
				(node, attrName) => !skippedNodes.has(node) && (typeof accept === "function" ? accept(node, attrName) : accept),
			])),
		]));
	}

	async transform(content, entry) {
		let options = {
			eachURL: async (rawUrl, attr, tagName) => {
				// Attribute values aren’t decoded (e.g. `&amp;`) when the content will be converted to Markdown
				let url = entities.decodeHTML(rawUrl);

				// See https://github.com/11ty/eleventy-posthtml-urls/blob/main/lib/defaultOptions.js
				if(ASSET_TAGS.includes(tagName)) {
					let assetUrl = await this.#fetcher.fetchAsset(url, entry);
					return assetUrl === url ? rawUrl : assetUrl;
				}

				if((tagName === "a" || tagName === "area") && attr === "href") {
					let linkUrl = await this.transformLink(url, entry);
					return linkUrl && linkUrl !== url ? linkUrl : rawUrl;
				}

				return rawUrl;
			}
		};

		let result = await posthtml()
			.use(tree => {
				if(entry.source?.shouldDownloadAssets) {
					options.filter = HtmlTransformer.getUrlsFilter(HtmlTransformer.getSkippedNodes(tree, entry.source));
				}
				return urls(options)(tree);
			})
			.process(content);

		return result.html;
	}
}

export { HtmlTransformer }
