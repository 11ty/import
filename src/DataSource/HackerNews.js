import * as entities from "entities";

import { DataSource } from "../DataSource.js";

// Hacker News stories linking to an origin, via the Algolia search API (https://hn.algolia.com/api)
export class HackerNews extends DataSource {
	static TYPE = "hackernews";
	static TYPE_FRIENDLY = "Hacker News";
	static DECODE_HTML = false;
	static SUPPORTS_COUNTS = true;
	// Equally relevant hits are ranked by points, then comments
	static API = "https://hn.algolia.com/api/v1/search";
	static WEBSITE = "https://news.ycombinator.com";
	// Most popular only, no paging (`limit` sets the request size)
	static PER_PAGE = 100;
	static MAX_PER_PAGE = 500;

	constructor(origin) {
		super();
		if(!origin) {
			throw new Error("Hacker News requires an origin (e.g. https://www.11ty.dev).");
		}
		this.hostname = HackerNews.getHostname(origin);
	}

	// Origin, URL, or domain, `www.` is optional (as on Hacker News)
	static getHostname(origin) {
		let url = new URL(/^https?:\/\//.test(origin) ? origin : `https://${origin}`);
		return HackerNews.normalizeHostname(url.hostname);
	}

	static normalizeHostname(hostname) {
		return hostname.toLowerCase().replace(/^www\./, "");
	}

	// Item ID from `item?id=…`
	static getFilePath(url) {
		return new URL(url).searchParams.get("id");
	}

	getType() {
		return "json";
	}

	getUrl() {
		let url = new URL(HackerNews.API);
		url.searchParams.set("query", this.hostname);
		url.searchParams.set("restrictSearchableAttributes", "url");
		url.searchParams.set("tags", "story");
		url.searchParams.set("hitsPerPage", Math.min(this.getLimit() || HackerNews.PER_PAGE, HackerNews.MAX_PER_PAGE));
		return url.toString();
	}

	// Search matches words anywhere in the URL, so other hosts are filtered out
	isSameOrigin(url) {
		try {
			return HackerNews.normalizeHostname(new URL(url).hostname) === this.hostname;
		} catch(e) {
			return false;
		}
	}

	getEntriesFromData(data) {
		return (data?.hits || []).filter(hit => hit.url && this.isSameOrigin(hit.url));
	}

	// `limit` keeps the most popular
	getRawEntrySortValue(hit) {
		return hit.points || 0;
	}

	getUniqueIdFromEntry(hit) {
		return `${DataSource.UUID_PREFIX}::${HackerNews.TYPE}::${hit.objectID}`;
	}

	getRawEntryDates(hit) {
		return {
			created: hit.created_at_i ? new Date(hit.created_at_i * 1000) : this.toDateObj(hit.created_at),
		};
	}

	cleanEntry(hit) {
		let { created } = this.getRawEntryDates(hit);
		let title = hit.title || hit.url;

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(hit),
			type: HackerNews.TYPE,
			title,
			url: `${HackerNews.WEBSITE}/item?id=${hit.objectID}`,
			authors: [{ name: hit.author, url: `${HackerNews.WEBSITE}/user?id=${encodeURIComponent(hit.author)}` }],
			date: created,
			content: `<p><a href="${entities.escapeAttribute(hit.url)}">${entities.escapeUTF8(title)}</a></p>`,
			contentType: "html",
			metadata: {
				id: hit.objectID,
				externalUrl: hit.url,
			},
		};

		let counts = DataSource.cleanCounts({ points: hit.points, comments: hit.num_comments });
		if(counts) {
			cleanEntry.counts = counts;
		}

		return cleanEntry;
	}
}
