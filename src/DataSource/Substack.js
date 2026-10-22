import { DataSource } from "../DataSource.js";
import { MediaRss } from "../MediaRss.js";

// Public archive and post APIs, paid posts are previews unless a subscriber’s `SUBSTACK_SID` cookie value is supplied
export class Substack extends DataSource {
	static TYPE = "substack";
	static TYPE_FRIENDLY = "Substack";
	static PER_PAGE = 25;
	static SUPPORTS_COMMENTS = true;

	#offset = 0;
	#commentCounts = new Map();

	// Publication URL (custom domains too) or a `*.substack.com` subdomain name
	constructor(url) {
		super();
		this.url = this.isValidHttpUrl(url) ? url : `https://${url}.substack.com/`;
	}

	getType() {
		return "json";
	}

	getSiteUrl() {
		return new URL(this.url).origin;
	}

	getHeaders(url) {
		if(process.env.SUBSTACK_SID && url?.startsWith(this.getSiteUrl())) {
			return {
				Cookie: `substack.sid=${process.env.SUBSTACK_SID}`,
			};
		}

		return {};
	}

	// Paged by offset (pages can be shorter than the requested limit)
	getUrl() {
		return (pageNumber = 1) => {
			if(pageNumber === 1) {
				this.#offset = 0;
			}
			return `${this.getSiteUrl()}/api/v1/archive?sort=new&offset=${this.#offset}&limit=${Substack.PER_PAGE}`;
		};
	}

	getEntriesFromData(data) {
		let posts = Array.isArray(data) ? data : [];
		this.#offset += posts.length;
		return posts;
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${Substack.TYPE}::${entry.id}`;
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.post_date),
			updated: this.toDateObj(rawEntry.updated_at),
		};
	}

	static getAuthors(post) {
		return (post.publishedBylines || []).map(({ name, handle, photo_url }) => {
			let author = { name };
			if(handle) {
				author.url = `https://substack.com/@${handle}`;
			}
			if(photo_url) {
				author.avatarUrl = photo_url;
			}
			return author;
		});
	}

	// Plain text comments in a reply tree, `ancestor_path` is a dot-separated list of comment ids
	static getComments(comments, postUrl) {
		let flattened = [];
		for(let comment of comments || []) {
			if(!comment.deleted && comment.status === "published" && comment.body) {
				flattened.push(DataSource.cleanComment({
					id: comment.id,
					parentId: comment.ancestor_path ? Number(comment.ancestor_path.split(".").pop()) : 0,
					url: `${postUrl}/comment/${comment.id}`,
					author: {
						name: comment.name,
						url: comment.handle ? `https://substack.com/@${comment.handle}` : undefined,
						avatarUrl: comment.photo_url,
					},
					date: new Date(Date.parse(comment.date)),
					content: DataSource.textToHtml(comment.body),
				}));
			}
			flattened.push(...Substack.getComments(comment.children, postUrl));
		}
		return flattened;
	}

	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let id = entry.metadata?.id;
			if(this.#commentCounts.get(id) > 0) {
				let data = await this.getOptionalData(`${this.getSiteUrl()}/api/v1/post/${id}/comments?all_comments=true&sort=oldest_first`, "json", [entry]);
				entry.comments = DataSource.sortComments(Substack.getComments(data?.comments, entry.url));
			}
		}));
	}

	// The archive doesn’t include post content
	async cleanEntry(rawEntry) {
		let post = await this.getData(`${this.getSiteUrl()}/api/v1/posts/${rawEntry.slug}`, "json");
		this.#commentCounts.set(post.id, post.comment_count ?? rawEntry.comment_count ?? 0);

		let { created, updated } = this.getRawEntryDates(post);

		let metadata = {
			id: post.id,
			slug: post.slug,
			postType: post.type,
		};

		if(post.audience && post.audience !== "everyone") {
			metadata.audience = post.audience;
		}

		if(post.cover_image) {
			metadata.media = { featuredImage: post.cover_image };
		}

		let tags = (post.postTags || []).map(tag => tag.name);
		if(tags.length) {
			metadata.tags = tags;
		}

		let content = post.body_html || "";
		if(post.podcast_url) {
			content = MediaRss.appendToContent(content, [{ url: post.podcast_url, medium: "audio" }]);
		}

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(post),
			type: Substack.TYPE,
			title: post.title,
			url: post.canonical_url || `${this.getSiteUrl()}/p/${post.slug}`,
			authors: Substack.getAuthors(post),
			date: created,
			dateUpdated: updated,
			content,
			contentType: "html",
			metadata,
		};

		let description = post.search_engine_description || post.subtitle || post.description;
		if(description) {
			cleanEntry.description = description;
		}

		if(tags.length) {
			cleanEntry.tags = tags;
		}

		return cleanEntry;
	}
}
