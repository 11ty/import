import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import * as entities from "entities";

const ASSET_TAGS = ["img", "video", "audio", "source", "link", "script", "track"];

class HtmlTransformer {
	#fetcher;

	setFetcher(fetcher) {
		this.#fetcher = fetcher;
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

		return HtmlTransformer.getSiteRelativeUrl(url, source?.getSiteUrl());
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
			.use(urls(options))
			.process(content);

		return result.html;
	}
}

export { HtmlTransformer }
