import { DataSource } from "../DataSource.js";
import { MediaRss } from "../MediaRss.js";

// JSON Feed 1.0 and 1.1 (https://www.jsonfeed.org/version/1.1/), follows `next_url` paging
export class JsonFeed extends DataSource {
	static TYPE = "jsonfeed";
	static TYPE_FRIENDLY = "JSON Feed";
	static DECODE_HTML = false;

	#nextUrl;

	constructor(url) {
		super();
		this.url = url;
	}

	getType() {
		return "json";
	}

	getUrl() {
		return (pageNumber = 1) => {
			if(pageNumber === 1) {
				return this.url;
			}
			return this.#nextUrl || false;
		};
	}

	getEntriesFromData(data) {
		let nextUrl = data?.next_url;
		this.#nextUrl = nextUrl && this.isValidHttpUrl(nextUrl) && nextUrl !== this.#nextUrl ? nextUrl : undefined;
		return Array.isArray(data?.items) ? data.items : [];
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${JsonFeed.TYPE}::${entry.id ?? entry.url}`;
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.date_published || rawEntry.date_modified),
			updated: this.toDateObj(rawEntry.date_modified),
		};
	}

	// `authors` (1.1) or `author` (1.0), on the item or the feed
	static getAuthors(rawEntry, data) {
		let authors = rawEntry.authors || (rawEntry.author ? [rawEntry.author] : undefined) || data?.authors || (data?.author ? [data.author] : []);
		return authors.map(({ name, url, avatar }) => {
			let author = { name: name || data?.title };
			if(url) {
				author.url = url;
			}
			if(avatar) {
				author.avatarUrl = avatar;
			}
			return author;
		});
	}

	cleanEntry(rawEntry, data) {
		let { created, updated } = this.getRawEntryDates(rawEntry);

		let content = rawEntry.content_html;
		let contentType = "html";
		if(typeof content !== "string") {
			content = rawEntry.content_text || "";
			contentType = "text";
		}

		if(contentType === "html") {
			let enclosures = (rawEntry.attachments || []).map(attachment => ({ url: attachment.url, type: attachment.mime_type }));
			content = MediaRss.appendToContent(content, MediaRss.getMediaFromEnclosures(enclosures));
		}

		let metadata = {};
		let media = {};
		if(rawEntry.image) {
			media.featuredImage = rawEntry.image;
		}
		if(rawEntry.banner_image && rawEntry.banner_image !== rawEntry.image) {
			media.bannerImage = rawEntry.banner_image;
		}
		if(Object.keys(media).length > 0) {
			metadata.media = media;
		}

		if(rawEntry.external_url) {
			metadata.externalUrl = rawEntry.external_url;
		}

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: JsonFeed.TYPE,
			title: rawEntry.title || this.toReadableDate(created),
			url: rawEntry.url || rawEntry.external_url,
			authors: JsonFeed.getAuthors(rawEntry, data),
			date: created,
			dateUpdated: updated,
			content,
			contentType,
		};

		if(Object.keys(metadata).length > 0) {
			cleanEntry.metadata = metadata;
		}

		if(rawEntry.summary) {
			cleanEntry.description = rawEntry.summary;
		}

		if(Array.isArray(rawEntry.tags) && rawEntry.tags.length) {
			cleanEntry.tags = rawEntry.tags;
		}

		return cleanEntry;
	}
}
