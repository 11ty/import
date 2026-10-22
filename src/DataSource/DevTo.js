import { DataSource } from "../DataSource.js";

// Published articles for a DEV user or organization (https://developers.forem.com/api/v1)
export class DevTo extends DataSource {
	static TYPE = "devto";
	static TYPE_FRIENDLY = "DEV";
	static API = "https://dev.to/api/";
	static PER_PAGE = 100;
	static SUPPORTS_COMMENTS = true;
	static MAX_RETRIES = 5;
	static DEFAULT_RETRY_SECONDS = 5;

	#commentCounts = new Map();

	constructor(username) {
		super();
		this.username = username.replace(/^@/, "");
	}

	getType() {
		return "json";
	}

	getUrl() {
		return (pageNumber = 1) => `${DevTo.API}articles?username=${encodeURIComponent(this.username)}&per_page=${DevTo.PER_PAGE}&page=${pageNumber}`;
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${DevTo.TYPE}::${entry.id}`;
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.published_at || rawEntry.published_timestamp),
			updated: this.toDateObj(rawEntry.edited_at),
		};
	}

	static getAuthor(user) {
		let author = { name: user?.name };
		if(user?.username) {
			author.url = `https://dev.to/${user.username}`;
		}
		if(user?.profile_image) {
			author.avatarUrl = user.profile_image;
		}
		return author;
	}

	// Threaded comments, deleted and hidden comments have no `user`
	static getComments(comments, parentId) {
		let flattened = [];
		for(let comment of comments || []) {
			if(comment.user) {
				flattened.push(DataSource.cleanComment({
					id: comment.id_code,
					parentId,
					url: `https://dev.to/${comment.user.username}/comment/${comment.id_code}`,
					author: DevTo.getAuthor({ ...comment.user, profile_image: comment.user.profile_image_90 }),
					date: new Date(Date.parse(comment.created_at)),
					content: comment.body_html,
				}));
			}
			flattened.push(...DevTo.getComments(comment.children, comment.id_code));
		}
		return flattened;
	}

	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let id = entry.metadata?.id;
			if(this.#commentCounts.get(id) > 0) {
				let comments = await this.getOptionalData(`${DevTo.API}comments?a_id=${id}`, "json");
				entry.comments = DataSource.sortComments(DevTo.getComments(comments));
			}
		}));
	}

	// The API is rate limited, waits for `Retry-After` on 429 responses
	async #getDataWithRetry(url) {
		for(let attempt = 0; ; attempt++) {
			try {
				return await this.getData(url, "json", false);
			} catch(e) {
				let response = e?.cause;
				if(!(response instanceof Response) || response.status !== 429 || attempt >= DevTo.MAX_RETRIES) {
					throw e;
				}

				this.fetcher.clearError(url);
				let seconds = Number(response.headers.get("retry-after")) || DevTo.DEFAULT_RETRY_SECONDS;
				await new Promise(resolve => setTimeout(resolve, seconds * 1000));
			}
		}
	}

	// Article lists don’t include content
	async cleanEntry(rawEntry) {
		this.#commentCounts.set(rawEntry.id, rawEntry.comments_count || 0);

		let article = await this.#getDataWithRetry(`${DevTo.API}articles/${rawEntry.id}`);
		let { created, updated } = this.getRawEntryDates(article);

		let metadata = {
			id: article.id,
			slug: article.slug,
		};

		if(article.cover_image) {
			metadata.media = { featuredImage: article.cover_image };
		}

		// Cross-posted articles
		if(article.canonical_url && article.canonical_url !== article.url) {
			metadata.canonicalUrl = article.canonical_url;
		}

		let tags = Array.isArray(article.tags) ? article.tags : (article.tag_list || []);
		if(typeof tags === "string") {
			tags = tags.split(",").map(tag => tag.trim()).filter(Boolean);
		}

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(article),
			type: DevTo.TYPE,
			title: article.title,
			url: article.url,
			authors: [DevTo.getAuthor(article.user)],
			date: created,
			dateUpdated: updated,
			content: article.body_html || "",
			contentType: "html",
			metadata,
		};

		if(article.description) {
			cleanEntry.description = article.description;
		}

		if(tags.length) {
			metadata.tags = tags;
			cleanEntry.tags = tags;
		}

		return cleanEntry;
	}
}
