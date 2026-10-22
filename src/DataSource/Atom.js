import { DataSource } from "../DataSource.js";
import { MediaRss } from "../MediaRss.js";

export class Atom extends DataSource {
	static TYPE = "atom";
	static TYPE_FRIENDLY = "Atom";

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

		// Parsed as a plain value (not an object) when <content> has no attributes
		let content = rawEntry.content;
		let hasAttributes = typeof content === "object" && content !== null;
		let contentType = hasAttributes ? content["@_type"] : undefined;
		if(hasAttributes) {
			content = content["#text"];
		}

		// Media markup only makes sense in HTML content
		if(contentType === "html") {
			let enclosures = MediaRss.toArray(rawEntry.link).filter(link => link["@_rel"] === "enclosure").map(link => ({ url: link["@_href"], type: link["@_type"] }));
			content = MediaRss.appendToContent(content, [
				...MediaRss.getMediaFromEntry(rawEntry),
				...MediaRss.getMediaFromEnclosures(enclosures),
			]);
		}

		let featuredImage = MediaRss.getFeaturedImageUrl(rawEntry);

		return {
			...(featuredImage ? { metadata: { media: { featuredImage } } } : {}),
			uuid: this.getUniqueIdFromEntry(rawEntry),
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
}
