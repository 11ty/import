import path from "node:path";
import { DataSource } from "../DataSource.js";
import { MediaRss } from "../MediaRss.js";
import { Rss } from "./Rss.js";

// Public posts via the Mastodon API (https://docs.joinmastodon.org/methods/accounts/#statuses)
export class FediverseUser extends DataSource {
	static TYPE = "fediverse";
	static TYPE_FRIENDLY = "Fediverse";
	static DECODE_HTML = false;
	static PER_PAGE = 40;
	// Mastodon allows 300 requests per 5 minutes, see `Fetcher` for `x-ratelimit-*` handling
	static CONCURRENCY = 4;
	static SUPPORTS_COMMENTS = true;
	static SUPPORTS_COUNTS = true;
	static MEDIUMS = {
		image: "image",
		gifv: "video",
		video: "video",
		audio: "audio",
	};

	#account;
	#maxId;

	constructor(fullUsername) {
		super();

		let { username, hostname } = FediverseUser.parseUsername(fullUsername);
		this.username = username;
		this.hostname = hostname;
	}

	setFetcher(fetcher) {
		super.setFetcher(fetcher);
		let origin = `https://${this.hostname}`;
		if(!fetcher.hasOriginLimit(origin)) {
			fetcher.setOriginLimit(origin, { concurrency: FediverseUser.CONCURRENCY });
		}
	}

	// Optional `MASTODON_ACCESS_TOKEN` (from the user’s server) uses a per-account rate limit instead of a per-IP one and returns full reply threads
	getHeaders(url) {
		if(process.env.MASTODON_ACCESS_TOKEN && url?.startsWith(`https://${this.hostname}/api/`)) {
			return { Authorization: `Bearer ${process.env.MASTODON_ACCESS_TOKEN}` };
		}
		return {};
	}

	static parseUsername(fullUsername) {
		if(fullUsername.startsWith("@")) {
			fullUsername = fullUsername.slice(1);
		}

		let [ username, hostname ]= fullUsername.split("@");

		return {
			username,
			hostname
		}
	}

	static parseFromUrl(url) {
		let { hostname, pathname } = new URL(url);
		let [empty, username, postId] = pathname.split("/");

		return {
			username: username.startsWith("@") ? username.slice(1) : username,
			hostname,
			postId,
		}
	}

	static getFilePath(url) {
		let { hostname, username, postId } = FediverseUser.parseFromUrl(url);
		return path.join(`${username}@${hostname}`, postId);
	}

	getType() {
		return "json";
	}

	async getEntries() {
		this.#account = await this.getData(`https://${this.hostname}/api/v1/accounts/lookup?acct=${encodeURIComponent(this.username)}`, "json");
		this.#maxId = undefined;

		return super.getEntries();
	}

	// Paged by `max_id` cursor, includes self-replies (threads) but not boosts or replies to others
	getUrl() {
		return pageNumber => {
			if(pageNumber > 1 && !this.#maxId) {
				return;
			}

			let maxId = pageNumber > 1 ? `&max_id=${this.#maxId}` : "";
			return `https://${this.hostname}/api/v1/accounts/${this.#account.id}/statuses?limit=${FediverseUser.PER_PAGE}&exclude_replies=true&exclude_reblogs=true${maxId}`;
		};
	}

	getEntriesFromData(data) {
		let statuses = Array.isArray(data) ? data : [];
		this.#maxId = statuses.at(-1)?.id;
		return statuses;
	}

	// Matches the RSS `<guid>` used by earlier versions
	getUniqueIdFromEntry(status) {
		return `${DataSource.UUID_PREFIX}::${Rss.TYPE}::${status.url}`;
	}

	getRawEntryDates(status) {
		return {
			created: this.toDateObj(status.created_at),
			updated: this.toDateObj(status.edited_at),
		};
	}

	static getMedia(status) {
		return (status.media_attachments || []).map(attachment => ({
			url: attachment.url,
			medium: FediverseUser.MEDIUMS[attachment.type],
			description: attachment.description,
			poster: attachment.preview_url,
		})).filter(media => media.url && media.medium);
	}

	cleanEntry(status) {
		let { created, updated } = this.getRawEntryDates(status);
		let account = status.account || this.#account;
		let counts = DataSource.cleanCounts({
			likes: status.favourites_count,
			reposts: status.reblogs_count,
			comments: status.replies_count,
			quotes: status.quotes_count,
		});

		return {
			uuid: this.getUniqueIdFromEntry(status),
			type: FediverseUser.TYPE,
			title: this.toReadableDate(status.created_at),
			url: status.url,
			authors: [{
				name: account?.display_name || account?.acct,
				url: account?.url,
			}],
			date: created,
			...(updated ? { dateUpdated: updated } : {}),
			content: MediaRss.appendToContent(status.content, FediverseUser.getMedia(status)),
			contentType: "html",
			metadata: {
				slug: status.id,
			},
			...(counts ? { counts } : {}),
		};
	}

	// Unlisted replies, content warnings, and authors that opted out of search engines are links only
	static isPrivate(status) {
		return status.visibility === "unlisted" || Boolean(status.sensitive || status.spoiler_text || status.account?.noindex);
	}

	static cleanComment(status, rootId) {
		return DataSource.cleanComment({
			id: status.id,
			parentId: status.in_reply_to_id === rootId ? 0 : status.in_reply_to_id,
			url: status.url,
			author: {
				name: status.account?.display_name || status.account?.acct,
				url: status.account?.url,
				avatarUrl: status.account?.avatar,
			},
			date: new Date(Date.parse(status.created_at)),
			content: status.content,
			isPrivate: FediverseUser.isPrivate(status),
		});
	}

	// Only includes replies known to the user’s server
	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let { postId } = FediverseUser.parseFromUrl(entry.url);
			if(!postId) {
				// Nothing to request, existing comments are kept
				this.setCommentsIncomplete([entry]);
				return;
			}

			let data = await this.getOptionalData(`https://${this.hostname}/api/v1/statuses/${postId}/context`, "json", [entry]);
			entry.comments = DataSource.sortComments((data?.descendants || []).map(status => FediverseUser.cleanComment(status, postId)));
		}));
	}
}
