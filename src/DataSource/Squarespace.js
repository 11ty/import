import { DataSource } from "../DataSource.js";

// Public JSON (`?format=json`) for a collection (blog, events, products), a collection item, or a regular page
export class Squarespace extends DataSource {
	static TYPE = "squarespace";
	static TYPE_FRIENDLY = "Squarespace";
	static DECODE_HTML = false;
	static ASSET_HOSTS = ["images.squarespace-cdn.com", "static1.squarespace.com"];
	static SUPPORTS_COMMENTS = true;
	static APPROVED_COMMENT_STATUS = 1;

	#nextOffset;
	#collectionType;
	#commentCounts = new Map();

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

	// Squarespace CDN files and `/s/` file uploads
	isLinkedAsset(url) {
		if(Squarespace.ASSET_HOSTS.includes(url.hostname)) {
			return true;
		}

		return url.origin === this.getSiteUrl() && url.pathname.startsWith("/s/");
	}

	#getJsonUrl(offset) {
		let url = new URL(this.url);
		url.searchParams.set("format", "json");
		if(offset) {
			url.searchParams.set("offset", offset);
		}
		return url.toString();
	}

	// Collections are paged by an `offset` cursor (`nextPageUrl` can be relative to a different collection path)
	getUrl() {
		return (pageNumber = 1) => {
			if(pageNumber === 1) {
				this.#nextOffset = undefined;
				return this.#getJsonUrl();
			}

			if(this.#nextOffset) {
				return this.#getJsonUrl(this.#nextOffset);
			}

			return false;
		};
	}

	getEntriesFromData(data) {
		this.#collectionType = data?.collection?.typeName;

		let previousOffset = this.#nextOffset;
		this.#nextOffset = undefined;

		if(Array.isArray(data?.items)) {
			let { nextPage, nextPageOffset } = data.pagination || {};
			if(nextPage && nextPageOffset && String(nextPageOffset) !== String(previousOffset)) {
				this.#nextOffset = nextPageOffset;
			}
			return data.items;
		}

		if(data?.item) {
			return [data.item];
		}

		// Regular pages have content but no item
		if(typeof data?.mainContent === "string" && data.collection) {
			let { id, title, fullUrl, updatedOn, description } = data.collection;
			return [{ id, title, fullUrl, updatedOn, excerpt: description, body: data.mainContent, isPage: true }];
		}

		return [];
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${Squarespace.TYPE}::${entry.id}`;
	}

	static toDate(timestamp) {
		if(timestamp) {
			return new Date(timestamp);
		}
	}

	getRawEntryDates(rawEntry) {
		return {
			created: Squarespace.toDate(rawEntry.publishOn || rawEntry.addedOn || rawEntry.updatedOn),
			updated: Squarespace.toDate(rawEntry.updatedOn),
		};
	}

	// Removes template `<style>`, `<script>`, and `<noscript>` duplicates, empty paragraphs and spacer blocks, and adds `src` to lazy-loaded images
	static cleanContent(content) {
		return (content || "")
			.replace(/<(style|script|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
			.replace(/<(p|div)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, "")
			.replace(/<img\b[^>]*>/gi, img => {
				let dataSrc = img.match(/\sdata-src="([^"]+)"/);
				if(!dataSrc || /\ssrc="/.test(img)) {
					return img;
				}
				return img.replace(/^<img\b/i, `<img src="${dataSrc[1]}"`);
			})
			.replace(/\n\s*\n+/g, "\n")
			.trim();
	}

	static getAuthors(rawEntry) {
		let name = rawEntry.author?.displayName;
		if(!name) {
			return [];
		}

		let author = { name };
		let avatarUrl = rawEntry.author.avatarAssetUrl || rawEntry.author.avatarUrl;
		if(avatarUrl) {
			author.avatarUrl = avatarUrl;
		}
		return [author];
	}

	// Approved comments from the same API Squarespace’s own comment threads use, flattened with `ancestors`
	static cleanComment(rawComment) {
		let parent = rawComment.ancestors?.at(-1);

		return DataSource.cleanComment({
			id: rawComment.id,
			parentId: parent?.id ?? parent,
			author: {
				name: rawComment.authorName,
			},
			date: Squarespace.toDate(rawComment.addedOn),
			content: rawComment.body,
		});
	}

	#getCommentsUrl(id, pageNumber) {
		return `${this.getSiteUrl()}/api/comment/GetComments?targetId=${encodeURIComponent(id)}&targetType=1&page=${pageNumber}`;
	}

	async #getComments(id, entry) {
		let comments = [];
		for(let pageNumber = 1; ; pageNumber++) {
			let data = await this.getOptionalData(this.#getCommentsUrl(id, pageNumber), "json", [entry]);
			let pageComments = data?.comments || [];
			if(pageComments.length === 0) {
				break;
			}

			comments.push(...pageComments);
			if(comments.length >= data.totalComments) {
				break;
			}
		}

		return DataSource.sortComments(comments.filter(comment => {
			return comment.status === Squarespace.APPROVED_COMMENT_STATUS && !comment.cleared;
		}).map(comment => Squarespace.cleanComment(comment)));
	}

	// Only requested for items with public comments
	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let id = entry.metadata?.id;
			if(this.#commentCounts.get(id) > 0) {
				entry.comments = await this.#getComments(id, entry);
			}
		}));
	}

	cleanEntry(rawEntry) {
		this.#commentCounts.set(rawEntry.id, rawEntry.publicCommentCount ?? rawEntry.commentCount ?? 0);

		let { created, updated } = this.getRawEntryDates(rawEntry);

		let metadata = {
			id: rawEntry.id,
			postType: rawEntry.isPage ? "page" : this.#collectionType,
		};

		let slug = rawEntry.urlId?.split("/").pop();
		if(slug) {
			metadata.slug = slug;
		}

		if(rawEntry.assetUrl && rawEntry.contentType?.startsWith("image/")) {
			metadata.media = { featuredImage: rawEntry.assetUrl };
		}

		let categories = rawEntry.categories || [];
		if(categories.length) {
			metadata.categories = categories;
		}

		let tags = rawEntry.tags || [];
		if(tags.length) {
			metadata.tags = tags;
		}

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: Squarespace.TYPE,
			title: rawEntry.title,
			url: new URL(rawEntry.fullUrl, this.url).toString(),
			authors: Squarespace.getAuthors(rawEntry),
			date: created,
			dateUpdated: updated,
			content: Squarespace.cleanContent(rawEntry.body),
			contentType: "html",
			metadata,
		};

		let description = DataSource.htmlToPlainText(rawEntry.seoData?.seoDescription || rawEntry.excerpt);
		if(description) {
			cleanEntry.description = description;
		}

		if(categories.length) {
			cleanEntry.tags = categories;
		}

		return cleanEntry;
	}
}
