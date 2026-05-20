import { DataSource } from "../DataSource.js";

export class YouTubeUser extends DataSource {
	static TYPE = "youtube";
	static TYPE_FRIENDLY = "YouTube";

	constructor(channelId) {
		super();
		this.channelId = channelId;
	}

	getType() {
		return "xml";
	}

	getUrl() {
		return `https://www.youtube.com/feeds/videos.xml?channel_id=${this.channelId}`
	}

	getEntriesFromData(data) {
		return data.feed?.entry || [];
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${YouTubeUser.TYPE}::${entry['yt:videoId']}`;
	}

	static getFilePath(url) {
		let { searchParams } = new URL(url);
		return searchParams.get("v");
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.published),
			updated: this.toDateObj(rawEntry.updated),
		};
	}

	cleanEntry(rawEntry) {
		let { created, updated } = this.getRawEntryDates(rawEntry);

		return {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: YouTubeUser.TYPE,
			title: rawEntry.title,
			url: `https://www.youtube.com/watch?v=${rawEntry['yt:videoId']}`,
			authors: [
				{
					name: rawEntry.author.name,
					url: rawEntry.author.uri,
				}
			],
			date: created,
			dateUpdated: updated,
			// TODO linkify, nl2br
			content: rawEntry['media:group']['media:description'],
			contentType: "text",
		}
	}
}
