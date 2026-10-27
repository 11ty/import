import posthtml from "posthtml";

import { DataSource } from "../DataSource.js";
import { Fetcher } from "../Fetcher.js";
import { Logger } from "../Logger.js";
import { Atom } from "./Atom.js";
import { Rss } from "./Rss.js";
import { JsonFeed } from "./JsonFeed.js";

// Atom, RSS, or JSON Feed URL, or an HTML page that links to one (`<link rel="alternate">`)
export class Feed extends DataSource {
	static TYPE = "feed";
	static TYPE_FRIENDLY = "Feed";
	static SUPPORTS_COMMENTS = true;

	static LINK_TYPES = ["application/atom+xml", "application/rss+xml", "application/feed+json"];

	#source;
	#until;
	#dataOverrides = [];

	constructor(url) {
		super();
		this.url = url;
	}

	setUntil(until) {
		this.#until = until;
		return super.setUntil(until);
	}

	setDataOverride(url, data) {
		this.#dataOverrides.push([url, data]);
		super.setDataOverride(url, data);
	}

	getFailedPageUrls() {
		return this.#source?.getFailedPageUrls() || super.getFailedPageUrls();
	}

	isIncomplete() {
		return this.#source?.isIncomplete() || false;
	}

	static getFeedClass(data) {
		if(data?.feed) {
			return Atom;
		}
		if(data?.rss) {
			return Rss;
		}
		if(Array.isArray(data?.items) || String(data?.version).includes("jsonfeed.org")) {
			return JsonFeed;
		}
	}

	static parse(body) {
		if(typeof body !== "string") {
			return { data: body };
		}

		let text = body.replace(/^﻿/, "").trim();
		if(text.startsWith("{")) {
			try {
				return { data: JSON.parse(text) };
			} catch(e) {
				return {};
			}
		}

		// First element after declarations, comments, and doctypes
		let root = text.replace(/^(?:\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<![^>]*>))*\s*/, "").match(/^<([\w:-]+)/)?.[1]?.toLowerCase();
		if(root === "feed" || root === "rss") {
			return { data: Fetcher.parseXml(text) };
		}

		return { html: text };
	}

	static findAll(nodes, test, results = []) {
		for(let node of nodes || []) {
			if(node && typeof node === "object") {
				if(test(node)) {
					results.push(node);
				}
				Feed.findAll(node.content, test, results);
			}
		}
		return results;
	}

	// First feed in document order
	static async discover(html, pageUrl) {
		let { tree } = await posthtml().process(html);
		let base = Feed.findAll(tree, node => node.tag === "base" && node.attrs?.href)[0]?.attrs.href;
		let baseUrl = base ? new URL(base, pageUrl).toString() : pageUrl;

		let link = Feed.findAll(tree, node => {
			if(node.tag !== "link" || !node.attrs?.href) {
				return false;
			}
			let rel = String(node.attrs.rel || "").toLowerCase().split(/\s+/);
			let type = String(node.attrs.type || "").toLowerCase().split(";")[0].trim();
			return rel.includes("alternate") && Feed.LINK_TYPES.includes(type);
		})[0];

		if(link) {
			return new URL(link.attrs.href, baseUrl).toString();
		}
	}

	async #findFeed() {
		let url = this.url;
		let { data, html } = Feed.parse(await this.getData(url, "text"));

		if(html) {
			url = await Feed.discover(html, url);
			if(!url) {
				throw new Error(`No Atom, RSS, or JSON Feed found at ${this.url}`);
			}
			({ data } = Feed.parse(await this.getData(url, "text")));
		}

		let cls = Feed.getFeedClass(data);
		if(!cls) {
			throw new Error(`No Atom, RSS, or JSON Feed found at ${url}`);
		}

		return { cls, url, data };
	}

	#createSource(cls, url, data) {
		let source = new cls(url);
		source.setFetcher(this.fetcher);
		source.setVerbose(this.isVerbose);
		source.setOutputFolder(this.outputFolder);
		source.setWithin(this.within);
		source.setComments(this.shouldIncludeComments());
		source.setContent(this.shouldIncludeContent());
		if(this.label) {
			source.setLabel(this.label);
		}
		if(this.filepathFormat) {
			source.setFilepathFormatFunction(this.filepathFormat);
		}
		if(this.getLimit()) {
			source.setLimit(this.getLimit());
		}
		if(this.#until) {
			source.setUntil(this.#until);
		}
		for(let [overrideUrl, overrideData] of this.#dataOverrides) {
			source.setDataOverride(overrideUrl, overrideData);
		}

		// The first request is already parsed
		let getData = source.getData.bind(source);
		source.getData = async (requestUrl, ...args) => {
			if(data && requestUrl === url) {
				let result = data;
				data = undefined;
				return result;
			}
			return getData(requestUrl, ...args);
		};

		return source;
	}

	async getEntries() {
		let { cls, url, data } = await this.#findFeed();
		if(this.isVerbose && url !== this.url) {
			Logger.log(`Found ${cls.TYPE_FRIENDLY} feed ${url}`);
		}

		this.#source = this.#createSource(cls, url, data);
		return this.#source.getEntries();
	}
}
