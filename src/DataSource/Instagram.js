import * as entities from "entities";

import { DataSource } from "../DataSource.js";

// Posts and reels from the Instagram API with Instagram Login (business and creator accounts only)
export class Instagram extends DataSource {
	static TYPE = "instagram";
	static TYPE_FRIENDLY = "Instagram";
	static DECODE_HTML = false;
	static API = "https://graph.instagram.com/v23.0";
	static PER_PAGE = 100;
	// Counts are in the same request (`like_count` is missing when likes are hidden)
	static SUPPORTS_COUNTS = true;
	static MEDIA_FIELDS = "id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count,children{id,media_type,media_url,thumbnail_url}";
	static CAPTION_PATTERN = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]}']|(?<![\w@])@[\w.]*\w|(?<![\p{L}\p{N}_&#])#[\p{L}\p{N}_]+/gu;

	#profile = {};
	#nextUrl;

	constructor(target) {
		super();
		if(!target) {
			throw new Error("Instagram requires a username.");
		}
		// Fails early, before any other source is fetched
		Instagram.getToken();
		this.username = Instagram.getUsername(target);
	}

	// Only read from the environment (at request time) so it isn’t written into code or kept on the instance
	static getToken() {
		let token = process.env.INSTAGRAM_ACCESS_TOKEN;
		if(!token) {
			throw new Error("Instagram requires an access token for a business or creator account (INSTAGRAM_ACCESS_TOKEN environment variable).");
		}
		return token;
	}

	// Username, `@username`, or profile URL
	static getUsername(target) {
		if(target.startsWith("https://") || target.startsWith("http://")) {
			target = new URL(target).pathname.split("/")[1];
		}
		return target.replace(/^@/, "").toLowerCase();
	}

	static redact(str = "") {
		return str.replace(/([?&]access_token=)[^&\s)]+/g, "$1…");
	}

	getLogUrl(url) {
		return Instagram.redact(url);
	}

	getApiUrl(path, params) {
		let url = new URL(`${Instagram.API}${path}`);
		for(let [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
		url.searchParams.set("access_token", Instagram.getToken());
		return url.toString();
	}

	getType() {
		return "json";
	}

	// Pages are cursor based, `paging.next` includes the token
	getUrl() {
		return pageNumber => {
			if(pageNumber === 1) {
				return this.getApiUrl("/me/media", { fields: Instagram.MEDIA_FIELDS, limit: Instagram.PER_PAGE });
			}
			return this.#nextUrl;
		};
	}

	async getEntries() {
		this.#profile = await this.getData(this.getApiUrl("/me", { fields: "username,name,profile_picture_url" }), "json");
		if(this.#profile.username?.toLowerCase() !== this.username) {
			throw new Error(`The INSTAGRAM_ACCESS_TOKEN is for @${this.#profile.username}, not @${this.username}.`);
		}

		return super.getEntries();
	}

	getEntriesFromData(data) {
		this.#nextUrl = data?.paging?.next;
		return data?.data || [];
	}

	getUniqueIdFromEntry(media) {
		return `${DataSource.UUID_PREFIX}::${Instagram.TYPE}::${media.id}`;
	}

	// e.g. `2023-01-01T12:00:00+0000`
	getRawEntryDates(media) {
		return {
			created: new Date(Date.parse(media.timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))),
		};
	}

	// `p/{shortcode}` or `reel/{shortcode}`
	static getFilePath(url) {
		return new URL(url).pathname.replace(/^\/|\/$/g, "");
	}

	static linkCaption(text) {
		let html = "";
		let index = 0;
		for(let match of text.matchAll(Instagram.CAPTION_PATTERN)) {
			let [value] = match;
			let href;
			if(value.startsWith("@")) {
				href = `https://www.instagram.com/${value.slice(1)}/`;
			} else if(value.startsWith("#")) {
				href = `https://www.instagram.com/explore/tags/${encodeURIComponent(value.slice(1))}/`;
			} else {
				href = value;
			}

			html += entities.escapeUTF8(text.slice(index, match.index));
			html += `<a href="${entities.escapeAttribute(href)}">${entities.escapeUTF8(value)}</a>`;
			index = match.index + value.length;
		}
		return html + entities.escapeUTF8(text.slice(index));
	}

	// Videos without a `media_url` (e.g. flagged for copyrighted audio) are skipped
	static getMediaHtml(media) {
		if(media.media_type === "VIDEO") {
			if(!media.media_url) {
				return;
			}
			let poster = media.thumbnail_url ? ` poster="${entities.escapeAttribute(media.thumbnail_url)}"` : "";
			return `<video controls src="${entities.escapeAttribute(media.media_url)}"${poster}></video>`;
		}

		// The API doesn’t include alt text
		return `<img src="${entities.escapeAttribute(media.media_url)}" alt="">`;
	}

	getContent(media) {
		let html = (media.caption || "").split(/(?:\r?\n){2,}/).map(paragraph => paragraph.trim()).filter(Boolean).map(paragraph => {
			return `<p>${DataSource.nl2br(Instagram.linkCaption(paragraph))}</p>`;
		});

		let items = media.media_type === "CAROUSEL_ALBUM" ? media.children?.data || [] : [media];
		for(let item of items) {
			let mediaHtml = Instagram.getMediaHtml(item);
			if(mediaHtml) {
				html.push(`<p>${mediaHtml}</p>`);
			}
		}

		return html.join("\n");
	}

	#getAuthor() {
		let author = {
			name: this.#profile.name || this.#profile.username,
			url: `https://www.instagram.com/${this.#profile.username}/`,
		};
		if(this.#profile.profile_picture_url) {
			author.avatarUrl = this.#profile.profile_picture_url;
		}
		return author;
	}

	cleanEntry(media) {
		let { created } = this.getRawEntryDates(media);
		let shortcode = Instagram.getFilePath(media.permalink).split("/").pop();
		let counts = DataSource.cleanCounts({
			likes: media.like_count,
			comments: media.comments_count,
		});

		return {
			uuid: this.getUniqueIdFromEntry(media),
			type: Instagram.TYPE,
			title: this.toReadableDate(created),
			url: media.permalink,
			authors: [this.#getAuthor()],
			date: created,
			content: this.getContent(media),
			contentType: "html",
			metadata: {
				id: media.id,
				slug: shortcode,
				postType: media.media_product_type === "REELS" ? "reel" : "post",
			},
			...(counts ? { counts } : {}),
		};
	}
}
