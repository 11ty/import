import * as entities from "entities";

import { DataSource } from "../DataSource.js";
import { MediaRss } from "../MediaRss.js";

// Public posts via the Tumblr API (https://www.tumblr.com/docs/en/api/v2#posts), legacy post format
export class Tumblr extends DataSource {
	static TYPE = "tumblr";
	static TYPE_FRIENDLY = "Tumblr";
	static DECODE_HTML = false;
	static API = "https://api.tumblr.com/v2/blog/";
	static PER_PAGE = 20;
	static SUPPORTS_COUNTS = true;
	static POST_TYPES = ["text", "photo", "quote", "link", "chat", "audio", "video", "answer"];

	#postTypes = [undefined];
	#postType;
	#offset = 0;
	#hasNextPage = false;

	constructor(blog) {
		super();
		// Fails early, before any other source is fetched
		Tumblr.getApiKey();
		this.hostname = Tumblr.normalizeBlog(blog);
	}

	// Only read from the environment (at request time) so it isn’t written into code or kept on the instance
	static getApiKey() {
		let key = process.env.TUMBLR_API_KEY;
		if(!key) {
			throw new Error("Tumblr requires an API key (TUMBLR_API_KEY environment variable).");
		}
		return key;
	}

	// Blog name, `*.tumblr.com` or custom domain, or blog URL (including `tumblr.com/name`)
	static normalizeBlog(blog = "") {
		blog = blog.replace(/^@/, "");
		if(blog.startsWith("https://") || blog.startsWith("http://")) {
			let url = new URL(blog);
			if(url.hostname === "tumblr.com" || url.hostname === "www.tumblr.com") {
				blog = url.pathname.split("/").filter(Boolean)[0] || "";
			} else {
				return url.hostname;
			}
		}
		return blog.includes(".") ? blog.toLowerCase() : `${blog.toLowerCase()}.tumblr.com`;
	}

	static redact(str = "") {
		return str.replace(/([?&]api_key=)[^&\s)]+/g, "$1…");
	}

	getLogUrl(url) {
		return Tumblr.redact(url);
	}

	getType() {
		return "json";
	}

	getSiteUrl() {
		return `https://${this.hostname}`;
	}

	setPostTypes(postTypes) {
		let types = (Array.isArray(postTypes) ? postTypes : String(postTypes).split(",")).map(type => type.trim().toLowerCase()).filter(Boolean);
		let unknown = types.filter(type => !Tumblr.POST_TYPES.includes(type));
		if(unknown.length) {
			throw new Error(`Unsupported Tumblr post types: ${unknown.join(", ")} (expected ${Tumblr.POST_TYPES.join(", ")})`);
		}
		this.#postTypes = types.length ? types : [undefined];
	}

	// The API filters by one post type at a time
	async getEntries() {
		let entries = [];
		for(let type of this.#postTypes) {
			this.#postType = type;
			entries.push(...await super.getEntries());
		}
		return entries;
	}

	getUrl() {
		return (pageNumber = 1) => {
			if(pageNumber === 1) {
				this.#offset = 0;
			} else if(!this.#hasNextPage) {
				return false;
			}

			let url = new URL(`${Tumblr.API}${this.hostname}/posts`);
			if(this.#postType) {
				url.pathname += `/${this.#postType}`;
			}
			url.searchParams.set("limit", Tumblr.PER_PAGE);
			url.searchParams.set("offset", this.#offset);
			url.searchParams.set("reblog_info", "true");
			url.searchParams.set("api_key", Tumblr.getApiKey());
			return url.toString();
		};
	}

	getEntriesFromData(data) {
		let posts = data?.response?.posts || [];
		this.#offset += posts.length;
		this.#hasNextPage = posts.length > 0 && this.#offset < Number(data.response.total_posts || 0);
		return posts;
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${Tumblr.TYPE}::${entry.id_string || entry.id}`;
	}

	getRawEntryDates(rawEntry) {
		return {
			created: rawEntry.timestamp ? new Date(rawEntry.timestamp * 1000) : this.toDateObj(rawEntry.date),
		};
	}

	static escape(text) {
		return entities.escapeUTF8(text || "");
	}

	// Largest embed (`player` is an array of sizes for video, a string for audio)
	static getEmbed(player) {
		if(Array.isArray(player)) {
			return [...player].sort((a, b) => (b.width || 0) - (a.width || 0)).find(entry => entry.embed_code)?.embed_code;
		}
		return player || undefined;
	}

	static getContent(post) {
		let parts = [];
		if(post.type === "text") {
			parts.push(post.body);
		} else if(post.type === "photo") {
			parts.push(MediaRss.getHtml((post.photos || []).map(photo => ({
				url: photo.original_size?.url,
				medium: "image",
				description: photo.caption,
			})).filter(photo => photo.url)));
			parts.push(post.caption);
		} else if(post.type === "quote") {
			parts.push(`<blockquote>${post.text || ""}</blockquote>`);
			if(post.source) {
				parts.push(`<p>— ${post.source}</p>`);
			}
		} else if(post.type === "link") {
			let href = entities.escapeAttribute(post.url || "");
			parts.push(`<p><a href="${href}">${Tumblr.escape(post.title || post.url)}</a></p>`);
			if(post.excerpt) {
				parts.push(`<blockquote>${DataSource.textToHtml(post.excerpt)}</blockquote>`);
			}
			parts.push(post.description);
		} else if(post.type === "chat") {
			parts.push((post.dialogue || []).map(({ label, name, phrase }) => {
				return `<p><strong>${Tumblr.escape(label || `${name}:`)}</strong> ${Tumblr.escape(phrase)}</p>`;
			}).join("\n"));
		} else if(post.type === "audio") {
			if(post.audio_type === "tumblr" && post.audio_url) {
				parts.push(MediaRss.getHtml([{ url: post.audio_url, medium: "audio" }]));
			} else {
				parts.push(Tumblr.getEmbed(post.player));
			}
			parts.push(post.caption);
		} else if(post.type === "video") {
			if(post.video_type === "tumblr" && post.video_url) {
				parts.push(MediaRss.getHtml([{ url: post.video_url, medium: "video", poster: post.thumbnail_url }]));
			} else {
				parts.push(Tumblr.getEmbed(post.player));
			}
			parts.push(post.caption);
		} else if(post.type === "answer") {
			let asker = post.asking_url ? `<a href="${entities.escapeAttribute(post.asking_url)}">${Tumblr.escape(post.asking_name)}</a>` : Tumblr.escape(post.asking_name || "Anonymous");
			parts.push(`<blockquote><p>${asker} asked: ${DataSource.textToHtml(post.question)}</p></blockquote>`);
			parts.push(post.answer);
		}

		return parts.filter(Boolean).join("\n");
	}

	static getFeaturedImage(post) {
		if(post.type === "photo") {
			return post.photos?.[0]?.original_size?.url;
		}
		if(post.type === "link") {
			return post.link_image;
		}
		if(post.type === "video") {
			return post.thumbnail_url;
		}
	}

	cleanEntry(rawEntry) {
		let { created } = this.getRawEntryDates(rawEntry);

		let metadata = {
			id: rawEntry.id_string || String(rawEntry.id),
			postType: rawEntry.type,
		};

		if(rawEntry.slug) {
			metadata.slug = rawEntry.slug;
		}

		let featuredImage = Tumblr.getFeaturedImage(rawEntry);
		if(featuredImage) {
			metadata.media = { featuredImage };
		}

		if(rawEntry.reblogged_from_url) {
			metadata.rebloggedFrom = rawEntry.reblogged_from_url;
		}

		let blog = rawEntry.blog || {};
		let author = { name: blog.title || rawEntry.blog_name };
		if(blog.url) {
			author.url = blog.url;
		}

		let title = rawEntry.title || (rawEntry.type === "audio" ? rawEntry.track_name : undefined);

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: Tumblr.TYPE,
			title: title || this.toReadableDate(created),
			url: rawEntry.post_url,
			authors: [author],
			date: created,
			content: Tumblr.getContent(rawEntry),
			contentType: "html",
			metadata,
		};

		let tags = rawEntry.tags || [];
		if(tags.length) {
			metadata.tags = tags;
			cleanEntry.tags = tags;
		}

		// Notes are likes, reblogs, and replies combined
		let counts = DataSource.cleanCounts({ notes: rawEntry.note_count });
		if(counts) {
			cleanEntry.counts = counts;
		}

		return cleanEntry;
	}
}
