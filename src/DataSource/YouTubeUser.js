import { DataSource } from "../DataSource.js";
import { MediaRss } from "../MediaRss.js";

export class YouTubeUser extends DataSource {
	static TYPE = "youtube";
	static TYPE_FRIENDLY = "YouTube";
	static API = "https://www.googleapis.com/youtube/v3/";
	// Requires a YOUTUBE_API_KEY environment variable
	static SUPPORTS_COMMENTS = true;

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
		let featuredImage = MediaRss.getFeaturedImageUrl(rawEntry);

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
			...(featuredImage ? { metadata: { media: { featuredImage } } } : {}),
		}
	}

	// Keeps the key out of logged URLs
	getHeaders(url) {
		if(url?.startsWith(YouTubeUser.API) && process.env.YOUTUBE_API_KEY) {
			return {
				"X-Goog-Api-Key": process.env.YOUTUBE_API_KEY,
			};
		}

		return {};
	}

	// Videos with comments turned off
	async isErrorWorthWorryingAbout(e) {
		if(e?.cause instanceof Response) {
			try {
				let { error } = await e.cause.json();
				if(error?.errors?.some(({ reason }) => reason === "commentsDisabled")) {
					return false;
				}
			} catch(e) {
				// not JSON
			}
		}

		return true;
	}

	static cleanComment(comment, videoId) {
		let snippet = comment.snippet || {};

		return DataSource.cleanComment({
			id: comment.id,
			parentId: snippet.parentId,
			url: `https://www.youtube.com/watch?v=${videoId}&lc=${comment.id}`,
			author: {
				name: snippet.authorDisplayName,
				url: snippet.authorChannelUrl,
				avatarUrl: snippet.authorProfileImageUrl,
			},
			date: new Date(Date.parse(snippet.publishedAt)),
			content: snippet.textDisplay,
		});
	}

	async #getPaged(route, query) {
		let items = [];
		let pageToken = "";
		do {
			let data = await this.getOptionalData(`${YouTubeUser.API}${route}?${query}&maxResults=100&textFormat=html${pageToken ? `&pageToken=${pageToken}` : ""}`, "json");
			items.push(...(data?.items || []));
			pageToken = data?.nextPageToken;
		} while(pageToken);

		return items;
	}

	async #getComments(videoId) {
		let comments = [];
		for(let thread of await this.#getPaged("commentThreads", `part=${encodeURIComponent("snippet,replies")}&videoId=${videoId}`)) {
			let { topLevelComment, totalReplyCount = 0 } = thread.snippet || {};
			if(!topLevelComment) {
				continue;
			}
			comments.push(YouTubeUser.cleanComment(topLevelComment, videoId));

			// Threads only include a few replies
			let replies = thread.replies?.comments || [];
			if(replies.length < totalReplyCount) {
				replies = await this.#getPaged("comments", `part=snippet&parentId=${topLevelComment.id}`);
			}
			comments.push(...replies.map(reply => YouTubeUser.cleanComment(reply, videoId)));
		}

		return DataSource.sortComments(comments);
	}

	async addComments(entries) {
		if(!process.env.YOUTUBE_API_KEY) {
			return;
		}

		await Promise.all(entries.map(async entry => {
			let videoId = new URL(entry.url).searchParams.get("v");
			if(videoId) {
				entry.comments = await this.#getComments(videoId);
			}
		}));
	}
}
