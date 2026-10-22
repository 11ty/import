import { DataSource } from "../DataSource.js";

export class HostedWordPressApi extends DataSource {
	static TYPE = "wordpressapi-hosted";
	static TYPE_FRIENDLY = "WordPress.com";
	static DEFAULT_POST_TYPES = ["posts", "pages"];

	#postTypes = HostedWordPressApi.DEFAULT_POST_TYPES;
	#postType = "post";

	static #getHostname(url) {
		try {
			let u = new URL(url);
			return u.hostname;
		} catch(e) {}
		return "";
	}

	static isValid(url) {
		let hostname = this.#getHostname(url);
		return hostname.endsWith(".wordpress.com");
	}

	constructor(url) {
		super();
		this.url = url;

		// Custom domains are supported when using this class (or the `wordpress-hosted` type) directly
		this.hostname = HostedWordPressApi.#getHostname(url);
		if(!this.hostname) {
			throw new Error(`HostedWordPressApi expects a URL, received: ${url}`);
		}
	}

	// Accepts post type slugs (`page`, `product`) or the built-in REST bases (`posts`, `pages`)
	setPostTypes(types) {
		if(typeof types === "string") {
			types = types.split(",");
		}

		types = (types || []).map(type => type.trim()).filter(Boolean);
		this.#postTypes = types.length ? types : HostedWordPressApi.DEFAULT_POST_TYPES;
	}

	getPostTypes() {
		return this.#postTypes;
	}

	#getPostTypeSlugs() {
		let builtins = { posts: "post", pages: "page" };
		return Array.from(new Set(this.#postTypes.map(type => builtins[type] || type)));
	}

	async getEntries() {
		let entries = [];
		for(let postType of this.#getPostTypeSlugs()) {
			this.#postType = postType;
			entries.push(...await super.getEntries());
		}
		return entries;
	}

	getType() {
		return "json";
	}

	getUrl() {
		// return function for paging
		return (pageNumber = 1) => {
			// DRAFTS NOT SUPPORTED
			return `https://public-api.wordpress.com/rest/v1.1/sites/${this.hostname}/posts/?type=${encodeURIComponent(this.#postType)}&page=${pageNumber}&number=100`;
		};
	}

	getEntriesFromData(data) {
		return data.posts || [];
	}

	getUrlFromEntry(entry) {
		return entry.URL;
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${HostedWordPressApi.TYPE}::${entry.guid}`;
	}

	// stock WordPress is single-author
	#getAuthorData(author) {
		let authorData = {
			name: author.name,
			url: author.profile_URL,
			avatarUrl: author.avatar_URL,
		};

		if(author.nice_name) {
			authorData.slug = author.nice_name;
		}

		return [authorData];
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.date),
			updated: this.toDateObj(rawEntry.modified),
		};
	}

	async cleanEntry(rawEntry, data) {
		let metadata = {
			// Pages and custom post types may not support categories or tags
			categories: Object.keys(rawEntry.categories || {}),
			tags: Object.keys(rawEntry.tags || {}),
		};

		if(rawEntry.ID) {
			metadata.id = rawEntry.ID;
		}
		if(rawEntry.slug) {
			metadata.slug = rawEntry.slug;
		}

		if(rawEntry.type) {
			metadata.postType = rawEntry.type;
		}

		if(rawEntry.featured_image) {
			metadata.media = {
				featuredImage: rawEntry.featured_image,
			};

			// backwards compatibility (not downloaded or optimized)
			metadata.featuredImage = rawEntry.featured_image;
		}

		let { created, updated } = this.getRawEntryDates(rawEntry);

		return {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: HostedWordPressApi.TYPE,
			title: rawEntry.title,
			url: this.getUrlFromEntry(rawEntry),
			authors: this.#getAuthorData(rawEntry.author),
			date: created,
			dateUpdated: updated,
			content: rawEntry.content,
			contentType: "html",
			status: this.cleanStatus(rawEntry.status),
			metadata,
		}
	}
}
