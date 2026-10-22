import { DateCompare } from "@11ty/eleventy-utils";
import * as entities from "entities";
import striptags from "striptags";

import { DataSource } from "../DataSource.js";
import { HostedWordPressApi } from "./HostedWordPressApi.js"

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
	static IGNORED_CATEGORIES = ["Uncategorized"];
	static DEFAULT_POST_TYPES = ["posts", "pages"];
	static BUILTIN_REST_BASES = ["posts", "pages"];

	#postTypes = WordPressApi.DEFAULT_POST_TYPES;
	#restBase = "posts";

	constructor(url) {
		if(HostedWordPressApi.isValid(url)) {
			return new HostedWordPressApi(url);
		}

		super();
		this.url = url;
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

	async #getRestBases() {
		let builtins = { post: "posts", page: "pages" };
		let unknown = this.#postTypes.filter(type => !WordPressApi.BUILTIN_REST_BASES.includes(type) && !builtins[type]);

		let types = {};
		if(unknown.length > 0) {
			// Warning: extra API call
			types = await this.getData(this.#getSubtypeUrl("types"), this.getType()) || {};
		}

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

	async getEntries() {
		let entries = [];
		for(let restBase of await this.#getRestBases()) {
			this.#restBase = restBase;
			entries.push(...await super.getEntries());
		}
		return entries;
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

	#getSubtypeUrl(subtype, suffix = "") {
		let {pathname} = new URL(this.url);
		return (new URL(pathname + `wp-json/wp/v2/${subtype}/${suffix}`, this.url)).toString();
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
			if(process.env.WORDPRESS_USERNAME && process.env.WORDPRESS_PASSWORD) {
				// Commas are encoded
				statusStr = `&status=${encodeURIComponent("publish,draft")}`;
			}

			// Embeds featured media so self-hosted sites without Jetpack can return a featured image
			return this.#getSubtypeUrl(this.#restBase, `?page=${pageNumber}&per_page=100&_embed=${encodeURIComponent("wp:featuredmedia")}${statusStr}${withinStr}`);
		};
	}

	getHeaders() {
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
	async #getAuthors(authorId) {
		try {
			// Warning: extra API call
			let authorData = await this.getData(this.#getAuthorUrl(authorId), this.getType());

			return [
				{
					// _wordpress_author_id: entry.author,
					name: authorData.name,
					url: authorData.url || authorData.link,
					avatarUrl: authorData.avatar_urls[Object.keys(authorData.avatar_urls).pop()],
				}
			];
		} catch(e) {
			// Fetch logs the error upstream
			return [];
		}
	}

	async #getTags(ids) {
		return Promise.all(ids.map(tagId => {
			// Warning: extra API call
			return this.getData(this.#getTagsUrl(tagId), this.getType()).then(tagData => {
				return tagData.name;
			});
		}));
	}

	async #getCategories(ids) {
		let categoryNames = await Promise.all(ids.map(categoryId => {
			// Warning: extra API call
			return this.getData(this.#getCategoryUrl(categoryId), this.getType()).then(categoryData => {
				return categoryData.name;
			});
		}));

		return categoryNames.filter(name => {
			return !WordPressApi.IGNORED_CATEGORIES.includes(name);
		});
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
		let html = rawEntry.yoast_head_json?.description || rawEntry.yoast_head_json?.og_description || rawEntry.excerpt?.rendered;
		if(!html) {
			return;
		}

		return entities.decodeHTML(striptags(html)).replace(/\s+/g, " ").trim() || undefined;
	}

	// Supports: Title, Author, Published/Updated Dates
	async cleanEntry(rawEntry, data) {
		let url = this.getUrlFromEntry(rawEntry);
		let status = this.cleanStatus(rawEntry.status)

		let metadata = {};
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
		let categories = await this.#getCategories(rawEntry.categories || []);
		if(categories.length) {
			metadata.categories = categories;
		}

		let tags = await this.#getTags(rawEntry.tags || []);
		if(tags.length) {
			metadata.tags = tags;
		}

		let { created, updated } = this.getRawEntryDates(rawEntry);

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: WordPressApi.TYPE,
			title: rawEntry.title?.rendered,
			url,
			authors: await this.#getAuthors(rawEntry.author),
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
