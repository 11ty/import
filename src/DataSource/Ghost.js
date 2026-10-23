import { DataSource } from "../DataSource.js";

// Content API (posts and pages), the public key is discovered from the site’s search script or a `GHOST_CONTENT_API_KEY` environment variable
export class Ghost extends DataSource {
	static TYPE = "ghost";
	static TYPE_FRIENDLY = "Ghost";
	static DECODE_HTML = false;
	static RESOURCES = ["posts", "pages"];
	static PER_PAGE = 100;
	static COMMENT_COUNTS_BATCH_SIZE = 50;
	static SUPPORTS_COMMENTS = true;

	#resource = "posts";
	#apiUrl;
	#key;
	#hasNextPage = false;

	constructor(url) {
		super();
		this.url = url;
	}

	getType() {
		return "json";
	}

	getSiteUrl() {
		return new URL(this.url).origin;
	}

	static getAttribute(html, name) {
		return html.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1];
	}

	async #discoverApi() {
		if(this.#key) {
			return;
		}

		let html = "";
		try {
			html = await this.getData(this.url, "text");
		} catch(e) {
			// An environment variable key still works
			this.fetcher.clearError(this.url);
		}

		this.#key = process.env.GHOST_CONTENT_API_KEY || Ghost.getAttribute(html, "data-key");
		if(!this.#key) {
			throw new Error(`Could not find a Ghost Content API key for ${this.url}, supply one with a GHOST_CONTENT_API_KEY environment variable (Settings → Integrations → Custom).`);
		}

		let apiUrl = Ghost.getAttribute(html, "data-api") || `${this.getSiteUrl()}/ghost/api/content/`;
		this.#apiUrl = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
	}

	async getEntries() {
		await this.#discoverApi();

		let entries = [];
		for(let resource of Ghost.RESOURCES) {
			this.#resource = resource;
			entries.push(...await super.getEntries());
		}
		return entries;
	}

	getUrl() {
		return (pageNumber = 1) => {
			if(pageNumber > 1 && !this.#hasNextPage) {
				return false;
			}
			return `${this.#apiUrl}${this.#resource}/?key=${this.#key}&limit=${Ghost.PER_PAGE}&page=${pageNumber}&include=tags,authors&formats=html`;
		};
	}

	getEntriesFromData(data) {
		this.#hasNextPage = Boolean(data?.meta?.pagination?.next);
		return data?.[this.#resource] || [];
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${Ghost.TYPE}::${entry.id}`;
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.published_at),
			updated: this.toDateObj(rawEntry.updated_at),
		};
	}

	static getAuthors(rawEntry) {
		return (rawEntry.authors || []).map(({ name, url, profile_image }) => {
			let author = { name };
			if(url) {
				author.url = url;
			}
			if(profile_image) {
				author.avatarUrl = profile_image;
			}
			return author;
		});
	}

	static cleanComment(comment) {
		return DataSource.cleanComment({
			id: comment.id,
			parentId: comment.in_reply_to_id || comment.parent_id,
			author: {
				name: comment.member?.name,
				avatarUrl: comment.member?.avatar_image,
			},
			date: new Date(Date.parse(comment.created_at)),
			content: comment.html,
		});
	}

	async #getPagedComments(url, entry) {
		let comments = [];
		for(let pageNumber = 1; ; pageNumber++) {
			let data = await this.getOptionalData(`${url}?limit=${Ghost.PER_PAGE}&page=${pageNumber}&order=${encodeURIComponent("created_at asc")}`, "json", [entry]);
			comments.push(...(data?.comments || []));
			if(!data?.meta?.pagination?.next) {
				return comments;
			}
		}
	}

	// Native comments from the members API, threads only include a few replies
	async #getComments(id, entry) {
		let comments = [];
		for(let comment of await this.#getPagedComments(`${this.getSiteUrl()}/members/api/comments/post/${id}/`, entry)) {
			comments.push(comment);

			let replies = comment.replies || [];
			if(replies.length < (comment.count?.replies || 0)) {
				replies = await this.#getPagedComments(`${this.getSiteUrl()}/members/api/comments/${comment.id}/replies/`, entry);
			}
			comments.push(...replies);
		}

		return DataSource.sortComments(comments.filter(comment => comment.status === "published").map(comment => Ghost.cleanComment(comment)));
	}

	async addComments(entries) {
		let ids = entries.map(entry => entry.metadata?.id).filter(Boolean);
		let counts = {};
		for(let j = 0; j < ids.length; j += Ghost.COMMENT_COUNTS_BATCH_SIZE) {
			let batch = ids.slice(j, j + Ghost.COMMENT_COUNTS_BATCH_SIZE);
			Object.assign(counts, await this.getOptionalData(`${this.getSiteUrl()}/members/api/comments/counts/?ids=${batch.join(",")}`, "json", entries.filter(entry => batch.includes(entry.metadata?.id))));
		}

		await Promise.all(entries.map(async entry => {
			let id = entry.metadata?.id;
			if(counts[id] > 0) {
				entry.comments = await this.#getComments(id, entry);
			}
		}));
	}

	cleanEntry(rawEntry) {
		let { created, updated } = this.getRawEntryDates(rawEntry);

		let metadata = {
			id: rawEntry.id,
			slug: rawEntry.slug,
			postType: this.#resource === "pages" ? "page" : "post",
		};

		if(rawEntry.visibility && rawEntry.visibility !== "public") {
			metadata.visibility = rawEntry.visibility;
		}

		let media = {};
		if(rawEntry.feature_image) {
			media.featuredImage = rawEntry.feature_image;
		}
		if(rawEntry.og_image && rawEntry.og_image !== rawEntry.feature_image) {
			media.opengraphImage = rawEntry.og_image;
		}
		if(Object.keys(media).length > 0) {
			metadata.media = media;
		}

		// Internal tags (`#name`) aren’t public
		let tags = (rawEntry.tags || []).filter(tag => tag.visibility !== "internal").map(tag => tag.name);
		if(tags.length) {
			metadata.tags = tags;
		}

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: Ghost.TYPE,
			title: rawEntry.title,
			url: rawEntry.url,
			authors: Ghost.getAuthors(rawEntry),
			date: created,
			dateUpdated: updated,
			content: rawEntry.html || "",
			contentType: "html",
			metadata,
		};

		let description = rawEntry.meta_description || rawEntry.custom_excerpt;
		if(description) {
			cleanEntry.description = description;
		}

		if(tags.length) {
			cleanEntry.tags = tags;
		}

		return cleanEntry;
	}
}
