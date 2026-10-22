import * as entities from "entities";

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

		let featuredImage = MediaRss.getFeaturedImageUrl(rawEntry);

		let uuid = this.getUniqueIdFromEntry(rawEntry);
		let commentFeed = rawEntry["wfw:commentRss"];
		if(commentFeed && this.isValidHttpUrl(commentFeed)) {
			this.#commentFeeds.set(uuid, commentFeed);
		}

		return {
			...(featuredImage ? { metadata: { media: { featuredImage } } } : {}),
			uuid,
			type: Rss.TYPE,
			title: rawEntry.title || this.toReadableDate(rawEntry.pubDate),
			url: rawEntry.link,
			authors,
			date: created,
			// dateUpdated: rawEntry.updated,
			content,
			// contentType: "", // unknown
		}
	}

	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let url = this.#commentFeeds.get(entry.uuid);
			if(!url) {
				return;
			}

			let data = await this.getOptionalData(url);
			entry.comments = DataSource.sortComments(MediaRss.toArray(data?.rss?.channel?.item).map(item => {
				return DataSource.cleanComment({
					id: item.guid?.["#text"] ?? item.guid ?? item.link,
					url: item.link,
					author: { name: item["dc:creator"] },
					date: this.toDateObj(item.pubDate),
					content: entities.decodeHTML(item["content:encoded"] || item.description || ""),
				});
			}));
		}));
	}
}
