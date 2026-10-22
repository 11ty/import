import fs from "node:fs";
import * as entities from "entities";

import { DataSource } from "../DataSource.js";
import { Fetcher } from "../Fetcher.js";
import { MediaRss } from "../MediaRss.js";
import { WordPressApi } from "./WordPressApi.js";

// WordPress eXtended RSS (WXR) export file from Tools → Export
export class WordPressXml extends DataSource {
	static TYPE = "wordpressxml";
	static TYPE_FRIENDLY = "WordPress XML";
	static DEFAULT_POST_TYPES = ["post", "page"];
	static STATUSES = ["publish", "draft"];
	static EMPTY_DATE = "0000-00-00 00:00:00";

	#postTypes = WordPressXml.DEFAULT_POST_TYPES;
	#siteUrl;
	#authors = new Map();
	#attachments = new Map();

	constructor(path) {
		super();
		this.path = path;
	}

	// Accepts post type slugs (`page`) or REST bases (`pages`) for parity with `wordpress`
	setPostTypes(types) {
		if(typeof types === "string") {
			types = types.split(",");
		}

		let builtins = { posts: "post", pages: "page" };
		types = (types || []).map(type => type.trim()).filter(Boolean).map(type => builtins[type] || type);
		this.#postTypes = types.length ? types : WordPressXml.DEFAULT_POST_TYPES;
	}

	getPostTypes() {
		return this.#postTypes;
	}

	// Local file path or URL
	async getData() {
		if(this.isValidHttpUrl(this.path)) {
			return super.getData(this.path, "xml");
		}

		return Fetcher.parseXml(await fs.promises.readFile(this.path, "utf8"));
	}

	getSiteUrl() {
		return this.#siteUrl;
	}

	isLinkedAsset(url) {
		return url.pathname.includes("/wp-content/uploads/") || url.hostname.endsWith(".files.wordpress.com");
	}

	static toString(value) {
		return value === undefined || value === null ? "" : String(value);
	}

	getEntriesFromData(data) {
		let channel = data.rss?.channel || {};
		this.#siteUrl = channel["wp:base_blog_url"] || channel.link;

		for(let author of MediaRss.toArray(channel["wp:author"])) {
			this.#authors.set(WordPressXml.toString(author["wp:author_login"]), author);
		}

		let items = MediaRss.toArray(channel.item);
		for(let item of items) {
			if(item["wp:post_type"] === "attachment" && item["wp:attachment_url"]) {
				this.#attachments.set(WordPressXml.toString(item["wp:post_id"]), item["wp:attachment_url"]);
			}
		}

		return items.filter(item => {
			return this.#postTypes.includes(item["wp:post_type"]) && WordPressXml.STATUSES.includes(item["wp:status"]);
		});
	}

	getUniqueIdFromEntry(entry) {
		// Matches the `wordpress` (API) source so either can update the same content
		let guid = entry.guid?.["#text"] ?? entry.guid;
		return `${DataSource.UUID_PREFIX}::${WordPressApi.TYPE}::${guid}`;
	}

	static getMeta(rawEntry) {
		let meta = {};
		for(let entry of MediaRss.toArray(rawEntry["wp:postmeta"])) {
			meta[entry["wp:meta_key"]] = entry["wp:meta_value"];
		}
		return meta;
	}

	// Export dates are `YYYY-MM-DD HH:MM:SS`, drafts may not have a GMT date
	static toDate(gmt, local) {
		let date = gmt && gmt !== WordPressXml.EMPTY_DATE ? gmt : local;
		if(date && date !== WordPressXml.EMPTY_DATE) {
			return new Date(`${date.replace(" ", "T")}Z`);
		}
	}

	getRawEntryDates(rawEntry) {
		return {
			created: WordPressXml.toDate(rawEntry["wp:post_date_gmt"], rawEntry["wp:post_date"]),
			updated: WordPressXml.toDate(rawEntry["wp:post_modified_gmt"], rawEntry["wp:post_modified"]),
		};
	}

	#getAuthors(rawEntry) {
		let login = WordPressXml.toString(rawEntry["dc:creator"]);
		if(!login) {
			return [];
		}

		let author = this.#authors.get(login);
		return [{
			name: WordPressXml.toString(author?.["wp:author_display_name"]) || login,
			slug: login,
		}];
	}

	static getTerms(rawEntry, domain) {
		return MediaRss.toArray(rawEntry.category).filter(term => term["@_domain"] === domain).map(term => {
			return entities.decodeHTML(WordPressXml.toString(term["#text"]));
		});
	}

	// Exports have raw post content, so remove block editor delimiters and add paragraphs to classic editor content (a simplified `wpautop`)
	static cleanContent(content) {
		content = WordPressXml.toString(content);
		let hasBlocks = content.includes("<!-- wp:");
		content = content.replace(/<!-- \/?wp:[\s\S]*?-->/g, "");

		if(!hasBlocks && !/<p[\s>]/i.test(content)) {
			content = content.split(/\n\s*\n/).map(chunk => chunk.trim()).filter(Boolean).map(chunk => {
				if(/^<(?:h[1-6]|ul|ol|li|blockquote|pre|table|div|figure|hr|iframe)[\s>\/]/i.test(chunk)) {
					return chunk;
				}
				return `<p>${chunk.replace(/\n/g, "<br>\n")}</p>`;
			}).join("\n");
		}

		return content.trim();
	}

	cleanEntry(rawEntry) {
		let meta = WordPressXml.getMeta(rawEntry);

		let metadata = {};
		if(rawEntry["wp:post_id"]) {
			metadata.id = rawEntry["wp:post_id"];
		}
		let slug = WordPressXml.toString(rawEntry["wp:post_name"]);
		if(slug) {
			metadata.slug = slug;
		}

		let media = {};
		let featuredImage = this.#attachments.get(WordPressXml.toString(meta._thumbnail_id));
		if(featuredImage) {
			media.featuredImage = featuredImage;
		}

		let opengraphImage = meta["_yoast_wpseo_opengraph-image"];
		if(opengraphImage && opengraphImage !== featuredImage) {
			media.opengraphImage = opengraphImage;
		}

		if(Object.keys(media).length > 0) {
			metadata.media = media;
		}

		metadata.postType = rawEntry["wp:post_type"];

		let categories = WordPressXml.getTerms(rawEntry, "category").filter(name => !WordPressApi.IGNORED_CATEGORIES.includes(name));
		if(categories.length) {
			metadata.categories = categories;
		}

		let tags = WordPressXml.getTerms(rawEntry, "post_tag");
		if(tags.length) {
			metadata.tags = tags;
		}

		let { created, updated } = this.getRawEntryDates(rawEntry);

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: WordPressXml.TYPE,
			title: WordPressXml.toString(rawEntry.title),
			url: rawEntry.link,
			authors: this.#getAuthors(rawEntry),
			date: created,
			dateUpdated: updated,
			content: WordPressXml.cleanContent(rawEntry["content:encoded"]),
			contentType: "html",
			status: this.cleanStatus(rawEntry["wp:status"]),
			metadata,
		};

		let description = DataSource.htmlToPlainText(meta._yoast_wpseo_metadesc || WordPressXml.toString(rawEntry["excerpt:encoded"]));
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
