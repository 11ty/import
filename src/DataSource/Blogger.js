import { DataSource } from "../DataSource.js";

// Public JSON feeds (`?alt=json`) for posts and pages, works with custom domains
export class Blogger extends DataSource {
	static TYPE = "blogger";
	static TYPE_FRIENDLY = "Blogger";
	static DECODE_HTML = false;
	static FEEDS = ["posts", "pages"];
	static PER_PAGE = 150;
	static DEFAULT_AVATAR_HOSTS = ["img1.blogblog.com", "img2.blogblog.com"];
	static SUPPORTS_COMMENTS = true;
	static LINKS_TO_FILES = true;

	#feed = "posts";
	#startIndex = 1;
	#hasNextPage = false;
	#commentFeeds = new Map();

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

	// Blogger uploads
	isLinkedAsset(url) {
		return url.hostname === "blogger.googleusercontent.com" || /^\d\.bp\.blogspot\.com$/.test(url.hostname);
	}

	async getEntries() {
		let entries = [];
		for(let feed of Blogger.FEEDS) {
			this.#feed = feed;
			entries.push(...await super.getEntries());
		}
		return entries;
	}

	getUrl() {
		return (pageNumber = 1) => {
			if(pageNumber === 1) {
				this.#startIndex = 1;
			} else if(!this.#hasNextPage) {
				return false;
			}
			return `${this.getSiteUrl()}/feeds/${this.#feed}/default?alt=json&max-results=${Blogger.PER_PAGE}&start-index=${this.#startIndex}`;
		};
	}

	getEntriesFromData(data) {
		let entries = data?.feed?.entry || [];
		this.#startIndex += entries.length;
		this.#hasNextPage = entries.length > 0 && this.#startIndex <= Number(data.feed.openSearch$totalResults?.$t || 0);
		return entries;
	}

	// `tag:blogger.com,1999:blog-ID.post-ID`
	static getId(rawEntry) {
		return rawEntry.id?.$t?.split(".post-").pop();
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${Blogger.TYPE}::${Blogger.getId(entry)}`;
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.published?.$t),
			updated: this.toDateObj(rawEntry.updated?.$t),
		};
	}

	static getLink(rawEntry, rel, type) {
		return (rawEntry.link || []).find(link => link.rel === rel && (!type || link.type === type))?.href;
	}

	// Skips the default Blogger avatars, image URLs can be protocol-relative
	static getAuthor(rawAuthor) {
		let author = { name: rawAuthor?.name?.$t };
		let url = rawAuthor?.uri?.$t;
		if(url) {
			author.url = url;
		}

		let avatarUrl = rawAuthor?.gd$image?.src;
		if(avatarUrl?.startsWith("//")) {
			avatarUrl = `https:${avatarUrl}`;
		}
		if(avatarUrl && !Blogger.DEFAULT_AVATAR_HOSTS.includes(new URL(avatarUrl).hostname)) {
			author.avatarUrl = avatarUrl;
		}
		return author;
	}

	// Thumbnails are resized (e.g. `/s72-c/`), request the original size instead
	static getFeaturedImage(rawEntry) {
		return rawEntry.media$thumbnail?.url?.replace(/\/s\d+(-c)?\//, "/s1600/").replace(/=s\d+(-c)?$/, "=s1600");
	}

	static cleanComment(rawComment) {
		let related = Blogger.getLink(rawComment, "related");
		return DataSource.cleanComment({
			id: Blogger.getId(rawComment),
			parentId: related?.split("/").pop(),
			url: Blogger.getLink(rawComment, "alternate"),
			author: Blogger.getAuthor(rawComment.author?.[0]),
			date: new Date(Date.parse(rawComment.published?.$t)),
			content: rawComment.content?.$t ?? rawComment.summary?.$t,
		});
	}

	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let url = this.#commentFeeds.get(entry.uuid);
			if(!url) {
				// Nothing to request, existing comments are kept
				this.setCommentsIncomplete([entry]);
				return;
			}

			let comments = [];
			for(let startIndex = 1; ; ) {
				let data = await this.getOptionalData(`${url}?alt=json&max-results=${Blogger.PER_PAGE}&start-index=${startIndex}`, "json", [entry]);
				let page = data?.feed?.entry || [];
				comments.push(...page);
				startIndex += page.length;
				if(page.length === 0 || startIndex > Number(data.feed.openSearch$totalResults?.$t || 0)) {
					break;
				}
			}

			entry.comments = DataSource.sortComments(comments.map(comment => Blogger.cleanComment(comment)));
		}));
	}

	cleanEntry(rawEntry) {
		let uuid = this.getUniqueIdFromEntry(rawEntry);
		let commentCount = Number(rawEntry.thr$total?.$t || 0);
		let commentFeed = Blogger.getLink(rawEntry, "replies", "application/atom+xml");
		if(commentCount > 0 && commentFeed) {
			this.#commentFeeds.set(uuid, commentFeed);
		}

		let { created, updated } = this.getRawEntryDates(rawEntry);

		let metadata = {
			id: Blogger.getId(rawEntry),
			postType: this.#feed === "pages" ? "page" : "post",
		};

		let featuredImage = Blogger.getFeaturedImage(rawEntry);
		if(featuredImage) {
			metadata.media = { featuredImage };
		}

		let tags = (rawEntry.category || []).map(category => category.term);

		let cleanEntry = {
			uuid,
			type: Blogger.TYPE,
			title: rawEntry.title?.$t || this.toReadableDate(created),
			url: Blogger.getLink(rawEntry, "alternate"),
			authors: (rawEntry.author || []).map(author => Blogger.getAuthor(author)),
			date: created,
			dateUpdated: updated,
			content: rawEntry.content?.$t ?? rawEntry.summary?.$t ?? "",
			contentType: "html",
			metadata,
		};

		if(tags.length) {
			metadata.tags = tags;
			cleanEntry.tags = tags;
		}

		return cleanEntry;
	}
}
