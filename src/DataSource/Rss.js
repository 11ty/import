import { DataSource } from "../DataSource.js";

export class Rss extends DataSource {
	static TYPE = "rss";
	static TYPE_FRIENDLY = "RSS";

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
		return `${DataSource.UUID_PREFIX}::${Rss.TYPE}::${entry.guid["#text"]}`;
	}

	getHtmlFromMediaEntry(mediaSources) {
		if(!Array.isArray(mediaSources)) {
			mediaSources = [mediaSources];
		}
		/* {
			'media:rating': { '#text': 'nonadult', '@_scheme': 'urn:simple' },
			'media:description': {
				'#text': 'A fake blue sky wall sits behind a body of water. A man climbs a flight of stairs meant to blend in with the wall. From the Truman Show',
				'@_type': 'plain'
			},
			'@_url': 'https://cdn.masto.host/fediversezachleatcom/media_attachments/files/113/487/344/514/939/049/original/ff062be4c5eaf642.png',
			'@_type': 'image/png',
			'@_fileSize': 879593,
			'@_medium': 'image'
			} */

		return mediaSources.filter(source => {
			// Only supporting images for now
			return !source["@_medium"] || source["@_medium"] === "image";
		}).map(source => {
			return `<img src="${source["@_url"]}" alt="${source["media:description"]?.["#text"] || ""}">`;
		}).join("\n");
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

		if(rawEntry["media:content"]) {
			content += `\n${this.getHtmlFromMediaEntry(rawEntry["media:content"])}`;
		}

		let { created } = this.getRawEntryDates(rawEntry);

		return {
			uuid: this.getUniqueIdFromEntry(rawEntry),
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
}
