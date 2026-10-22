import { DataSource } from "../DataSource.js";

// webmention.io (https://github.com/aaronpk/webmention.io) mentions of a domain, one data file per target URL (no posts)
export class Webmentions extends DataSource {
	static TYPE = "webmention";
	static TYPE_FRIENDLY = "Webmentions";
	static API = "https://webmention.io/api/mentions.jf2";
	static PER_PAGE = 100;
	// Writes data files only (always rewritten), never posts
	static DATA_ONLY = true;
	// Downloads comment and reaction avatars (but not comment content)
	static COMMENT_AVATARS = true;

	static COMMENT_TYPES = {
		"in-reply-to": "reply",
		"mention-of": "mention",
	};
	static REACTION_KEYS = {
		"like-of": "likes",
		"repost-of": "reposts",
		"bookmark-of": "bookmarks",
		"rsvp": "rsvps",
	};

	constructor(target) {
		super();
		if(!target) {
			throw new Error("Webmentions require a domain.");
		}
		// Fails early, before any other source is fetched
		Webmentions.getToken();
		this.domain = Webmentions.getDomain(target);
	}

	// Only read from the environment (at request time) so it isn’t written into code or kept on the instance
	static getToken() {
		let token = process.env.WEBMENTION_IO_TOKEN;
		if(!token) {
			throw new Error("Webmentions require a webmention.io API token (WEBMENTION_IO_TOKEN environment variable).");
		}
		return token;
	}

	// Hostname or URL
	static getDomain(target) {
		if(target.startsWith("https://") || target.startsWith("http://")) {
			return new URL(target).hostname;
		}
		return target.replace(/\/.*$/, "");
	}

	static redact(str = "") {
		return str.replace(/([?&]token=)[^&\s)]+/g, "$1…");
	}

	getLogUrl(url) {
		return Webmentions.redact(url);
	}

	getSiteUrl() {
		return `https://${this.domain}/`;
	}

	// `page` starts at 0
	getApiUrl(page) {
		let url = new URL(Webmentions.API);
		url.searchParams.set("domain", this.domain);
		url.searchParams.set("per-page", Webmentions.PER_PAGE);
		url.searchParams.set("page", page);
		url.searchParams.set("token", Webmentions.getToken());
		return url.toString();
	}

	async getMentions() {
		let mentions = [];
		let seen = new Set();
		for(let page = 0; ; page++) {
			let children = (await this.getData(this.getApiUrl(page), "json"))?.children || [];
			let added = 0;
			for(let mention of children) {
				if(!seen.has(mention["wm-id"])) {
					seen.add(mention["wm-id"]);
					mentions.push(mention);
					added++;
				}
			}
			if(added === 0 || children.length < Webmentions.PER_PAGE) {
				break;
			}
		}
		return mentions;
	}

	// Matching key: protocol, `www.`, hash, `utm_*` params, `index.html`, and trailing slash are ignored
	static normalizeUrl(url) {
		try {
			let u = new URL(url);
			for(let key of Array.from(u.searchParams.keys())) {
				if(key.startsWith("utm_")) {
					u.searchParams.delete(key);
				}
			}
			let pathname = u.pathname.replace(/\/index\.html?$/, "/").replace(/\/+$/, "");
			return `${u.hostname.replace(/^www\./, "").toLowerCase()}${pathname}${u.search}`;
		} catch(e) {
			return url;
		}
	}

	// Target URL without the hash, `utm_*` params, or `index.html` (matches the post’s file path)
	static cleanTarget(url) {
		let u = new URL(url);
		u.hash = "";
		u.pathname = u.pathname.replace(/\/index\.html?$/, "/");
		for(let key of Array.from(u.searchParams.keys())) {
			if(key.startsWith("utm_")) {
				u.searchParams.delete(key);
			}
		}
		return u.toString();
	}

	static getAuthor(mention) {
		let { name, url, photo } = mention.author || {};
		return Object.fromEntries(Object.entries({ name, url, avatarUrl: photo }).filter(([key, value]) => value));
	}

	static getDate(mention) {
		let date = mention.published || mention["wm-received"];
		if(date) {
			return new Date(Date.parse(date));
		}
	}

	static cleanComment(mention) {
		let comment = DataSource.cleanComment({
			id: mention["wm-id"],
			url: mention.url || mention["wm-source"],
			author: Webmentions.getAuthor(mention),
			date: Webmentions.getDate(mention),
			content: mention.content?.html || DataSource.textToHtml(mention.content?.text),
			isPrivate: mention["wm-private"] === true,
		});
		comment.type = Webmentions.COMMENT_TYPES[mention["wm-property"]];
		return comment;
	}

	static cleanReaction(mention) {
		let reaction = {
			id: mention["wm-id"],
			url: mention.url || mention["wm-source"],
			date: Webmentions.getDate(mention),
		};
		if(mention["wm-private"] !== true) {
			reaction.author = Webmentions.getAuthor(mention);
		}
		if(mention.rsvp) {
			reaction.rsvp = mention.rsvp;
		}
		return reaction;
	}

	// Earliest and latest received dates, so `within` keeps (and rewrites) a target’s full list
	getRawEntryDates({ mentions }) {
		let times = mentions.map(mention => Date.parse(mention["wm-received"] || mention.published)).filter(time => !isNaN(time));
		if(!times.length) {
			return {};
		}
		return {
			created: new Date(Math.min(...times)),
			updated: new Date(Math.max(...times)),
		};
	}

	cleanEntry(group) {
		let { created, updated } = this.getRawEntryDates(group);
		let entry = {
			uuid: `${DataSource.UUID_PREFIX}::${Webmentions.TYPE}::${group.key}`,
			type: Webmentions.TYPE,
			url: group.url,
			date: updated || created,
			content: "",
		};

		for(let mention of group.mentions) {
			let property = mention["wm-property"];
			let key = Webmentions.COMMENT_TYPES[property] ? "comments" : Webmentions.REACTION_KEYS[property];
			if(key) {
				entry[key] ??= [];
				entry[key].push(key === "comments" ? Webmentions.cleanComment(mention) : Webmentions.cleanReaction(mention));
			}
		}

		return entry;
	}

	async getEntries() {
		let mentions;
		try {
			mentions = await this.getMentions();
		} catch(e) {
			// Request errors include the URL
			throw new Error(Webmentions.redact(e.message));
		}

		let groups = new Map();
		for(let mention of mentions) {
			let key = Webmentions.normalizeUrl(mention["wm-target"]);
			if(!groups.has(key)) {
				groups.set(key, { key, url: Webmentions.cleanTarget(mention["wm-target"]), mentions: [] });
			}
			groups.get(key).mentions.push(mention);
		}

		let entries = Array.from(groups.values()).filter(group => this.isWithin(group)).map(group => this.cleanEntry(group));
		return this.finalizeEntries(entries);
	}
}
