import * as entities from "entities";

import { DataSource } from "../DataSource.js";
import { MediaRss } from "../MediaRss.js";

export class Atom extends DataSource {
	static TYPE = "atom";
	static TYPE_FRIENDLY = "Atom";
	static SUPPORTS_COMMENTS = true;

	// Per-entry comment feeds (RFC 4685 `<link rel="replies">`)
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
		if(Array.isArray(data.feed?.entry)) {
			return data.feed.entry;
		}

		if(data.feed?.entry) {
			return [data.feed.entry];
		}

		return [];
	}

	getUrlFromEntry(entry) {
		if(this.isValidHttpUrl(entry.id)) {
			return entry.id;
		}
		let alternate = MediaRss.toArray(entry.link).find(link => link["@_rel"] === "alternate");
		if(alternate?.["@_href"] && this.isValidHttpUrl(alternate["@_href"])) {
			return alternate["@_href"];
		}
		return entry.id;
	}

	getUniqueIdFromEntry(entry) {
		// id is a unique URL
		return `${DataSource.UUID_PREFIX}::${Atom.TYPE}::${entry.id}`;
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.published || rawEntry.updated),
			updated: this.toDateObj(rawEntry.updated)
		};
	}

	// Parsed as a plain value (not an object) when <content> has no attributes
	static getContent(rawEntry) {
		let content = rawEntry.content;
		if(typeof content === "object" && content !== null) {
			return { content: content["#text"], contentType: content["@_type"] };
		}
		return { content };
	}

	cleanEntry(rawEntry, data) {
		let authors = [];
		if(Array.isArray(rawEntry?.author)) {
			authors = rawEntry.author.map(author => ({ name: author?.name ?? author }));
		} else {
			authors.push({
				name: rawEntry?.author?.name || data.feed?.author?.name,
			});
		}

		let { created, updated } = this.getRawEntryDates(rawEntry);

		let { content, contentType } = Atom.getContent(rawEntry);

		// Media markup only makes sense in HTML content
		if(contentType === "html") {
			let enclosures = MediaRss.toArray(rawEntry.link).filter(link => link["@_rel"] === "enclosure").map(link => ({ url: link["@_href"], type: link["@_type"] }));
			content = MediaRss.appendToContent(content, [
				...MediaRss.getMediaFromEntry(rawEntry),
				...MediaRss.getMediaFromEnclosures(enclosures),
			]);
		}

		let featuredImage = MediaRss.getFeaturedImageUrl(rawEntry);

		let uuid = this.getUniqueIdFromEntry(rawEntry);
		let replies = MediaRss.toArray(rawEntry.link).find(link => link["@_rel"] === "replies" && (!link["@_type"] || link["@_type"] === "application/atom+xml"));
		if(replies?.["@_href"] && this.isValidHttpUrl(replies["@_href"])) {
			this.#commentFeeds.set(uuid, { url: replies["@_href"], id: rawEntry.id });
		}

		return {
			...(featuredImage ? { metadata: { media: { featuredImage } } } : {}),
			uuid,
			type: Atom.TYPE,
			title: rawEntry.title,
			url: this.getUrlFromEntry(rawEntry),
			authors,
			date: created,
			dateUpdated: updated,
			content,
			contentType,
		}
	}

	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let feed = this.#commentFeeds.get(entry.uuid);
			if(!feed) {
				return;
			}

			let data = await this.getOptionalData(feed.url);
			entry.comments = DataSource.sortComments(MediaRss.toArray(data?.feed?.entry).map(rawComment => {
				let { content, contentType } = Atom.getContent(rawComment);
				let alternate = MediaRss.toArray(rawComment.link).find(link => !link["@_rel"] || link["@_rel"] === "alternate");
				let parentId = rawComment["thr:in-reply-to"]?.["@_ref"];
				let author = MediaRss.toArray(rawComment.author)[0];

				return DataSource.cleanComment({
					id: rawComment.id,
					parentId: parentId === feed.id ? 0 : parentId,
					url: alternate?.["@_href"],
					author: typeof author === "string" ? { name: author } : { name: author?.name, url: author?.uri },
					date: this.toDateObj(rawComment.published || rawComment.updated),
					content: contentType === "html" || contentType === "xhtml" ? entities.decodeHTML(content || "") : DataSource.textToHtml(entities.decodeHTML(content || "")),
				});
			}));
		}));
	}
}
