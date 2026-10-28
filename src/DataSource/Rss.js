import * as entities from "entities";
import slugify from "@sindresorhus/slugify";

import { DataSource } from "../DataSource.js";
import { MediaRss } from "../MediaRss.js";

export class Rss extends DataSource {
	static TYPE = "rss";
	static TYPE_FRIENDLY = "RSS";
	static SUPPORTS_COMMENTS = true;

	// Per-entry comment feeds (e.g. WordPress `wfw:commentRss`)
	#commentFeeds = new Map();

	constructor(url) {
		super();
		this.url = url;
	}

	getType() {
		return "xml";
	}

	getUrl() {
		return this.url;
	}

	getEntriesFromData(data) {
		if(Array.isArray(data.rss?.channel?.item)) {
			return data.rss.channel.item;
		}

		if(data.rss?.channel?.item) {
			return [data.rss.channel.item];
		}

		return [];
	}

	getUniqueIdFromEntry(entry) {
		// <guid> is parsed as a plain value (not an object) when it has no attributes
		let id = entry.guid?.["#text"] ?? entry.guid ?? entry.link;
		return `${DataSource.UUID_PREFIX}::${Rss.TYPE}::${id}`;
	}

	static getText(value) {
		let text = MediaRss.getText(value);
		return text === undefined || text === null ? "" : String(text).trim();
	}

	// RSS guids are permalinks unless `isPermaLink="false"`
	static isGuidPermaLink(guid) {
		let attr = guid?.["@_isPermaLink"];
		return attr !== false && attr !== "false";
	}

	getEntryUrl(rawEntry, enclosures) {
		let link = Rss.getText(rawEntry.link);
		if(this.isValidHttpUrl(link)) {
			return { url: link };
		}

		let guid = Rss.getText(rawEntry.guid);
		if(Rss.isGuidPermaLink(rawEntry.guid) && this.isValidHttpUrl(guid)) {
			return { url: guid };
		}

		let enclosureUrl = enclosures.map(enclosure => enclosure.url).find(url => this.isValidHttpUrl(url));
		return { url: enclosureUrl, fromEnclosure: Boolean(enclosureUrl) };
	}

	static getItunesImageUrl(container) {
		return MediaRss.toArray(container?.["itunes:image"])[0]?.["@_href"];
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(this.toIsoDate(rawEntry.pubDate)),
			// updated: this.toDateObj(rawEntry.updated),
		};
	}

	cleanEntry(rawEntry, data) {
		let authors = [];
		// https://www.rssboard.org/rss-profile#namespace-elements-dublin-creator
		if(Array.isArray(rawEntry['dc:creator'])) {
			for(let name of rawEntry['dc:creator']) {
				authors.push({ name });
			}
		} else if(rawEntry['dc:creator']) {
			authors.push({ name: rawEntry['dc:creator'] });
		} else if(Rss.getText(rawEntry['itunes:author'])) {
			authors.push({ name: Rss.getText(rawEntry['itunes:author']) });
		} else {
			authors.push({
				name: data.rss.channel.title,
				url: data.rss.channel.link,
			});
		}

		let content = rawEntry["content:encoded"] || rawEntry.content || rawEntry.description;

		let enclosures = MediaRss.toArray(rawEntry.enclosure).map(enclosure => ({ url: enclosure["@_url"], type: enclosure["@_type"] }));
		content = MediaRss.appendToContent(content, [
			...MediaRss.getMediaFromEntry(rawEntry),
			...MediaRss.getMediaFromEnclosures(enclosures),
		]);

		let { created } = this.getRawEntryDates(rawEntry);

		let featuredImage = [
			MediaRss.getFeaturedImageUrl(rawEntry),
			Rss.getItunesImageUrl(rawEntry),
			Rss.getItunesImageUrl(data.rss.channel),
		].find(url => this.isValidHttpUrl(url));

		let uuid = this.getUniqueIdFromEntry(rawEntry);

		// Enclosure pathnames (e.g. `.mp3`) make poor file paths
		let { url, fromEnclosure } = this.getEntryUrl(rawEntry, enclosures);
		let filePathSlug;
		if(!url || fromEnclosure) {
			filePathSlug = slugify(entities.decodeHTML(Rss.getText(rawEntry.title) || Rss.getText(rawEntry["itunes:title"]) || Rss.getText(rawEntry.guid))) || undefined;
		}

		let commentFeed = rawEntry["wfw:commentRss"];
		if(commentFeed && this.isValidHttpUrl(commentFeed)) {
			this.#commentFeeds.set(uuid, commentFeed);
		}

		return {
			...(featuredImage ? { metadata: { media: { featuredImage } } } : {}),
			uuid,
			type: Rss.TYPE,
			title: rawEntry.title || rawEntry["itunes:title"] || this.toReadableDate(rawEntry.pubDate),
			url,
			...(filePathSlug ? { filePathSlug } : {}),
			authors,
			date: created,
			// dateUpdated: rawEntry.updated,
			content,
			// contentType: "", // unknown
		}
	}

	getCommentFeedUrl(uuid) {
		return this.#commentFeeds.get(uuid);
	}

	getCommentsFromData(data) {
		return DataSource.sortComments(MediaRss.toArray(data?.rss?.channel?.item).map(item => {
			return DataSource.cleanComment({
				id: item.guid?.["#text"] ?? item.guid ?? item.link,
				url: item.link,
				author: { name: item["dc:creator"] },
				date: this.toDateObj(item.pubDate),
				content: entities.decodeHTML(item["content:encoded"] || item.description || ""),
			});
		}));
	}

	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let url = this.getCommentFeedUrl(entry.uuid);
			if(!url) {
				// Nothing to request, existing comments are kept
				this.setCommentsIncomplete([entry]);
				return;
			}

			let data = await this.getOptionalData(url, this.getType(), [entry]);
			entry.comments = this.getCommentsFromData(data);
		}));
	}
}
