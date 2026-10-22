import { DateCompare } from "@11ty/eleventy-utils";

import { DataSource } from "../DataSource.js";

// Load WORDPRESS_USERNAME and WORDPRESS_PASSWORD from an optional .env file
try {
	process.loadEnvFile();
} catch(e) {
	if(e.code !== "ENOENT") {
		throw e;
	}
}

export class WordPressApi extends DataSource {
	static TYPE = "wordpress";
	static TYPE_FRIENDLY = "WordPress";
	// Fallback when the default category isn’t available from settings (requires auth)
	static IGNORED_CATEGORIES = ["Uncategorized"];
	static DEFAULT_CATEGORY_ID = 1;
	static DEFAULT_POST_TYPES = ["posts", "pages"];
	static BUILTIN_REST_BASES = ["posts", "pages"];
	static WORDPRESSDOTCOM_API = "https://public-api.wordpress.com/wp/v2/sites/";
	static PER_PAGE = 100;
	static SUPPORTS_COMMENTS = true;

	#postTypes = WordPressApi.DEFAULT_POST_TYPES;
	#restBase = "posts";
	#apiRoot;
	#types;
	#defaultCategoryId;

	constructor(url) {
		super();
		this.url = url;
	}

	static #getRouteUrl(apiRoot, route, query = "") {
		return `${apiRoot.prefix}${route}${query ? `${apiRoot.separator}${query}` : ""}`;
	}

	#getApiRootCandidates() {
		let { origin, pathname, hostname } = new URL(this.url);
		if(!pathname.endsWith("/")) {
			pathname += "/";
		}

		let site = [
			{ prefix: `${origin}${pathname}wp-json/wp/v2/`, separator: "?" },
			// Sites without pretty permalinks
			{ prefix: `${origin}${pathname}?rest_route=/wp/v2/`, separator: "&" },
		];

		// Also serves WordPress.com sites (custom domains too) and Jetpack-connected sites
		let wordpressDotCom = { prefix: `${WordPressApi.WORDPRESSDOTCOM_API}${hostname}/`, separator: "?", isWordPressDotCom: true };

		// WordPress.com drafts require the WordPress.com API
		if(process.env.WORDPRESSDOTCOM_TOKEN) {
			return [wordpressDotCom, ...site];
		}

		return [...site, wordpressDotCom];
	}

	// Uses the first API that returns post types
	async #discoverApiRoot() {
		if(this.#apiRoot) {
			return;
		}

		for(let candidate of this.#getApiRootCandidates()) {
			// getHeaders() depends on the candidate
			this.#apiRoot = candidate;

			let url = WordPressApi.#getRouteUrl(candidate, "types/");
			try {
				let types = await this.getData(url, this.getType(), false);
				if(types?.post) {
					this.#types = types;
					return;
				}
			} catch(e) {
				// Expected while discovering
				this.fetcher.clearError(url);
			}
		}

		this.#apiRoot = undefined;
		throw new Error(`Could not find a WordPress REST API for ${this.url}`);
	}

	#hasCredentials() {
		if(this.#apiRoot?.isWordPressDotCom) {
			return Boolean(process.env.WORDPRESSDOTCOM_TOKEN);
		}

		return Boolean(process.env.WORDPRESS_USERNAME && process.env.WORDPRESS_PASSWORD);
	}

	// Accepts post type slugs (`page`, `product`) or REST bases (`pages`, `products`)
	setPostTypes(types) {
		if(typeof types === "string") {
			types = types.split(",");
		}

		types = (types || []).map(type => type.trim()).filter(Boolean);
		this.#postTypes = types.length ? types : WordPressApi.DEFAULT_POST_TYPES;
	}

	getPostTypes() {
		return this.#postTypes;
	}

	#getRestBases() {
		let builtins = { post: "posts", page: "pages" };
		let types = this.#types || {};

		let restBases = this.#postTypes.map(type => {
			if(builtins[type]) {
				return builtins[type];
			}

			for(let [slug, typeData] of Object.entries(types)) {
				if(slug === type || typeData?.rest_base === type) {
					return typeData.rest_base || slug;
				}
			}

			return type;
		});

		return Array.from(new Set(restBases));
	}

	// Posts without a category are assigned the default (e.g. “Uncategorized”)
	async #fetchDefaultCategoryId() {
		this.#defaultCategoryId = WordPressApi.DEFAULT_CATEGORY_ID;
		if(!this.#hasCredentials()) {
			return;
		}

		let url = this.#getSubtypeUrl("settings");
		try {
			let settings = await this.getData(url, this.getType(), false);
			if(settings?.default_category) {
				this.#defaultCategoryId = settings.default_category;
			}
		} catch(e) {
			// Requires a user that can manage options
			this.fetcher.clearError(url);
		}
	}

	async getEntries() {
		await this.#discoverApiRoot();
		await this.#fetchDefaultCategoryId();

		let entries = [];
		for(let restBase of this.#getRestBases()) {
			this.#restBase = restBase;
			entries.push(...await super.getEntries());
		}

		return entries;
	}

	#getCommentsUrl(postIds, pageNumber) {
		return this.#getSubtypeUrl("comments", "", `post=${encodeURIComponent(postIds.join(","))}&page=${pageNumber}&per_page=${WordPressApi.PER_PAGE}&order=asc`);
	}

	static cleanComment(rawComment) {
		let avatarUrls = rawComment.author_avatar_urls || {};

		return DataSource.cleanComment({
			id: rawComment.id,
			parentId: rawComment.parent,
			url: rawComment.link,
			author: {
				name: rawComment.author_name,
				url: rawComment.author_url,
				avatarUrl: avatarUrls[Object.keys(avatarUrls).pop()],
			},
			date: new Date(Date.parse(`${rawComment.date_gmt}Z`)),
			content: rawComment.content?.rendered,
		});
	}

	// Approved comments (the API default) are requested in bulk for up to 100 posts at a time
	async addComments(entries) {
		let entriesById = new Map(entries.filter(entry => entry.metadata?.id).map(entry => [entry.metadata.id, entry]));
		let ids = Array.from(entriesById.keys());

		// Nothing to request, existing comments are kept
		this.setCommentsIncomplete(entries.filter(entry => !entry.metadata?.id));

		for(let i = 0; i < ids.length; i += WordPressApi.PER_PAGE) {
			let postIds = ids.slice(i, i + WordPressApi.PER_PAGE);
			// A failed batch only affects its own entries
			let batchEntries = postIds.map(id => entriesById.get(id));

			for(let pageNumber = 1; ; pageNumber++) {
				let comments = await this.getOptionalData(this.#getCommentsUrl(postIds, pageNumber), this.getType(), batchEntries);
				if(!Array.isArray(comments)) {
					break;
				}

				for(let rawComment of comments) {
					let entry = entriesById.get(rawComment.post);
					if(entry) {
						entry.comments ??= [];
						entry.comments.push(WordPressApi.cleanComment(rawComment));
					}
				}

				if(comments.length < WordPressApi.PER_PAGE) {
					break;
				}
			}
		}
	}

	// some pagination errors just mean there are no more pages
	async isErrorWorthWorryingAbout(e) {
		let responseText;
		if(e?.cause instanceof Response) {
			responseText = (await e.cause.text() || "").trim();
		}

		// Upstream out of band request is returning HTML!
		if(responseText) {
			if(e.cause?.status === 400) {
				if(responseText.startsWith("<!DOCTYPE ")) {
					return false;
				}
			}

			if(responseText.startsWith("[") || responseText.startsWith("{")) {
				try {
					let errorData = JSON.parse(responseText);
					if(errorData?.code === "rest_post_invalid_page_number") {
						return false;
					}
				} catch(e) {
					// do nothing here: error is worth worrying about
				}
			}
		}

		return true;
	}

	getType() {
		return "json";
	}

	getSiteUrl() {
		return this.url;
	}

	isLinkedAsset(url) {
		return url.pathname.includes("/wp-content/uploads/") || url.hostname.endsWith(".files.wordpress.com");
	}

	#getSubtypeUrl(subtype, suffix = "", query = "") {
		return WordPressApi.#getRouteUrl(this.#apiRoot, `${subtype}/${suffix}`, query);
	}

	#getAuthorUrl(id) {
		return this.#getSubtypeUrl("users", id);
	}

	#getCategoryUrl(id) {
		return this.#getSubtypeUrl("categories", id);
	}

	#getTagsUrl(id) {
		return this.#getSubtypeUrl("tags", id);
	}

	getUrl() {
		// return function for paging
		return (pageNumber = 1) => {
			// status=publish,future,draft,pending,private
			// status=any

			let withinStr = "";
			if(this.within) {
				let ms = DateCompare.getDurationMs(this.within);
				let d = this.toIsoDate(new Date(Date.now() - ms));
				withinStr = `&after=${d}&modified_after=${d}`
			}

			let statusStr = "";
			// Only request Drafts if auth’d
			if(this.#hasCredentials()) {
				// Commas are encoded
				statusStr = `&status=${encodeURIComponent("publish,draft")}`;
			}

			// Embeds featured media (for sites without Jetpack), authors (the WordPress.com users endpoint requires auth), and terms (avoids a request per term)
			return this.#getSubtypeUrl(this.#restBase, "", `page=${pageNumber}&per_page=100&_embed=${encodeURIComponent("author,wp:featuredmedia,wp:term")}${statusStr}${withinStr}`);
		};
	}

	getHeaders() {
		if(this.#apiRoot?.isWordPressDotCom) {
			if(process.env.WORDPRESSDOTCOM_TOKEN) {
				// OAuth2 access token, see https://developer.wordpress.com/docs/oauth2/
				return {
					"Authorization": `Bearer ${process.env.WORDPRESSDOTCOM_TOKEN}`,
				};
			}

			return {};
		}

		if(process.env.WORDPRESS_USERNAME && process.env.WORDPRESS_PASSWORD) {
			return {
				"Content-Type": "application/json",
				"Authorization": "Basic " + btoa(`${process.env.WORDPRESS_USERNAME}:${process.env.WORDPRESS_PASSWORD}`),
			}
		}

		return {};
	}

	getEntriesFromData(data) {
		if(Array.isArray(data)) {
			return data;
		}

		return [];
	}

	getUrlFromEntry(entry) {
		return entry.link;
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${WordPressApi.TYPE}::${entry.guid.rendered}`;
	}

	// stock WordPress is single-author
	async #getAuthors(rawEntry) {
		let [embeddedAuthor] = rawEntry._embedded?.author || [];
		// An embedded error (e.g. a private user) would fail the same way when fetched
		if(embeddedAuthor && !embeddedAuthor.name || !embeddedAuthor && !rawEntry.author) {
			return [];
		}

		try {
			// Warning: extra API call when not embedded
			let authorData = embeddedAuthor || await this.getData(this.#getAuthorUrl(rawEntry.author), this.getType());

			let author = {
				// _wordpress_author_id: entry.author,
				name: authorData.name,
				url: authorData.url || authorData.link,
				avatarUrl: authorData.avatar_urls[Object.keys(authorData.avatar_urls).pop()],
			};

			if(authorData.slug) {
				author.slug = authorData.slug;
			}

			return [author];
		} catch(e) {
			// Fetch logs the error upstream
			return [];
		}
	}

	// Uses embedded terms when available
	async #getTerms(rawEntry, taxonomy, ids = [], getUrl) {
		let embeddedTerms = rawEntry._embedded?.["wp:term"];
		if(Array.isArray(embeddedTerms)) {
			return embeddedTerms.flat().filter(term => term?.taxonomy === taxonomy && ids.includes(term.id));
		}

		return Promise.all(ids.map(id => {
			// Warning: extra API call
			return this.getData(getUrl(id), this.getType());
		}));
	}

	async #getTags(rawEntry) {
		let tags = await this.#getTerms(rawEntry, "post_tag", rawEntry.tags, id => this.#getTagsUrl(id));
		return tags.map(tag => tag.name);
	}

	async #getCategories(rawEntry) {
		let categories = await this.#getTerms(rawEntry, "category", rawEntry.categories, id => this.#getCategoryUrl(id));

		return categories.filter(category => {
			return category.id !== this.#defaultCategoryId && !WordPressApi.IGNORED_CATEGORIES.includes(category.name);
		}).map(category => category.name);
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.date_gmt),
			updated: this.toDateObj(rawEntry.modified_gmt),
		};
	}

	static getFeaturedImageUrl(rawEntry) {
		let [embeddedMedia] = rawEntry._embedded?.["wp:featuredmedia"] || [];
		return embeddedMedia?.source_url || rawEntry.jetpack_featured_media_url || rawEntry.yoast_head_json?.og_image?.[0]?.url;
	}

	// Prefers a Yoast meta description over the (often auto-generated) excerpt
	static getDescription(rawEntry) {
		return DataSource.htmlToPlainText(rawEntry.yoast_head_json?.description || rawEntry.yoast_head_json?.og_description || rawEntry.excerpt?.rendered);
	}

	// Supports: Title, Author, Published/Updated Dates
	async cleanEntry(rawEntry, data) {
		let url = this.getUrlFromEntry(rawEntry);
		let status = this.cleanStatus(rawEntry.status)

		let metadata = {};
		if(rawEntry.id) {
			metadata.id = rawEntry.id;
		}
		if(rawEntry.slug) {
			metadata.slug = rawEntry.slug;
		}

		let media = {};
		let featuredImage = WordPressApi.getFeaturedImageUrl(rawEntry);
		if(featuredImage) {
			media.featuredImage = featuredImage;

			// backwards compatibility (not downloaded or optimized)
			metadata.featuredImage = featuredImage;
		}

		let opengraphImage = rawEntry.yoast_head_json?.og_image?.[0]?.url || rawEntry.og_image?.url;
		if(opengraphImage && opengraphImage !== featuredImage) {
			media.opengraphImage = opengraphImage;
		}

		if(Object.keys(media).length > 0) {
			metadata.media = media;
		}

		if(rawEntry.type) {
			metadata.postType = rawEntry.type;
		}

		// Pages and custom post types may not support categories or tags
		let categories = await this.#getCategories(rawEntry);
		if(categories.length) {
			metadata.categories = categories;
		}

		let tags = await this.#getTags(rawEntry);
		if(tags.length) {
			metadata.tags = tags;
		}

		let { created, updated } = this.getRawEntryDates(rawEntry);

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: WordPressApi.TYPE,
			title: rawEntry.title?.rendered,
			url,
			authors: await this.#getAuthors(rawEntry),
			date: created,
			dateUpdated: updated,
			content: rawEntry.content?.rendered || "",
			contentType: "html",
			status,
			metadata,
		};

		let description = WordPressApi.getDescription(rawEntry);
		if(description) {
			cleanEntry.description = description;
		}

		if(metadata.categories) {
			// map WordPress categories for use in Eleventy tags (not WordPress metadata tags, which are different)
			cleanEntry.tags = metadata.categories;
		}

		return cleanEntry;
	}
}
