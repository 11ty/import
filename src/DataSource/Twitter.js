import path from "node:path";
import * as entities from "entities";

import { DataSource } from "../DataSource.js";
import { Archive } from "../Archive.js";

// Twitter/X data archive (Settings → Your account → Download an archive of your data), as a `.zip` file or an extracted folder
export class Twitter extends DataSource {
	static TYPE = "twitter";
	static TYPE_FRIENDLY = "Twitter";
	static DECODE_HTML = false;
	static TWEETS_FILE = /^data\/tweets?(?:-part\d+)?\.js$/;
	static MEDIA_FOLDER = /^data\/(?:tweets?|profile)_media\/\d+-(.+)$/;
	static ENTITY_PATTERN = /https:\/\/t\.co\/\w+|@\w{1,15}/g;
	// Your own replies in a thread are comments on the first tweet
	static SUPPORTS_COMMENTS = true;
	// Counts are frozen when the archive was downloaded
	static SUPPORTS_COUNTS = true;
	static COMMENT_ASSETS = true;

	#archive;
	#account = {};
	#avatarUrl;
	// Archive media files by remote filename (`data/tweets_media/{tweetId}-{filename}`)
	#media = new Map();
	#threadReplies = new Map();

	constructor(path) {
		super();
		this.path = path;
	}

	// `window.YTD.tweets.part0 = [ … ]`
	static parseArchiveJs(content) {
		return JSON.parse(content.toString("utf8").replace(/^[^=]*=\s*/, ""));
	}

	async #readArchiveJs(filePath) {
		return Twitter.parseArchiveJs(await this.#archive.read(filePath));
	}

	async getData() {
		this.#archive = await Archive.open(this.path);

		let files = await this.#archive.list();
		for(let file of files) {
			let match = file.match(Twitter.MEDIA_FOLDER);
			if(match) {
				this.#media.set(match[1], file);
			}
		}

		if(files.includes("data/account.js")) {
			let [item] = await this.#readArchiveJs("data/account.js");
			this.#account = item?.account || {};
		}

		if(files.includes("data/profile.js")) {
			let [item] = await this.#readArchiveJs("data/profile.js");
			this.#avatarUrl = item?.profile?.avatarMediaUrl;
		}

		let tweetFiles = files.filter(file => Twitter.TWEETS_FILE.test(file)).sort();
		if(!tweetFiles.length) {
			throw new Error(`No tweets found in Twitter archive: ${this.path}`);
		}

		let tweets = [];
		for(let file of tweetFiles) {
			for(let item of await this.#readArchiveJs(file)) {
				tweets.push(item.tweet || item);
			}
		}
		return tweets;
	}

	static #getFilename(url) {
		try {
			return path.posix.basename(new URL(url).pathname);
		} catch(e) {}
	}

	async getLocalAsset(url) {
		let file = this.#media.get(Twitter.#getFilename(url));
		if(file) {
			return {
				body: await this.#archive.read(file),
			};
		}
	}

	static getFilePath(url) {
		let [, username, , id] = new URL(url).pathname.split("/");
		return path.join(username, id);
	}

	#getUsername() {
		return this.#account.username || "i";
	}

	#getTweetUrl(id) {
		return `https://x.com/${this.#getUsername()}/status/${id}`;
	}

	// Retweets and replies to other accounts are skipped (replies to yourself are threads)
	getEntriesFromData(tweets) {
		tweets = tweets.filter(tweet => {
			if((tweet.full_text || tweet.text || "").startsWith("RT @")) {
				return false;
			}

			return !tweet.in_reply_to_user_id_str || tweet.in_reply_to_user_id_str === this.#account.accountId;
		});

		if(!this.shouldIncludeComments()) {
			return tweets;
		}

		// Thread root is the first tweet in the archive (a reply to a deleted tweet starts its own thread)
		let byId = new Map(tweets.map(tweet => [tweet.id_str, tweet]));
		let getRoot = tweet => {
			let seen = new Set();
			while(byId.has(tweet.in_reply_to_status_id_str) && !seen.has(tweet.id_str)) {
				seen.add(tweet.id_str);
				tweet = byId.get(tweet.in_reply_to_status_id_str);
			}
			return tweet;
		};

		this.#threadReplies.clear();
		return tweets.filter(tweet => {
			let root = getRoot(tweet);
			if(root === tweet) {
				return true;
			}

			if(!this.#threadReplies.has(root.id_str)) {
				this.#threadReplies.set(root.id_str, []);
			}
			this.#threadReplies.get(root.id_str).push(tweet);
			return false;
		});
	}

	getUniqueIdFromEntry(tweet) {
		return `${DataSource.UUID_PREFIX}::${Twitter.TYPE}::${tweet.id_str}`;
	}

	getRawEntryDates(tweet) {
		return {
			created: new Date(Date.parse(tweet.created_at)),
		};
	}

	// Archived videos are one of the variants, otherwise the highest bitrate mp4
	#getVideoUrl(media) {
		let variants = (media.video_info?.variants || []).filter(variant => variant.content_type === "video/mp4");
		let local = variants.find(variant => this.#media.has(Twitter.#getFilename(variant.url)));
		if(local) {
			return local.url;
		}

		return variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url;
	}

	#getMediaHtml(media) {
		let alt = entities.escapeAttribute(media.ext_alt_text || "");
		let poster = entities.escapeAttribute(media.media_url_https || media.media_url || "");
		let videoUrl = media.type !== "photo" && this.#getVideoUrl(media);
		if(!videoUrl) {
			return `<img src="${poster}" alt="${alt}">`;
		}

		let attrs = media.type === "animated_gif" ? "autoplay loop muted playsinline" : "controls";
		if(alt) {
			attrs += ` aria-label="${alt}"`;
		}
		return `<video ${attrs} src="${entities.escapeAttribute(videoUrl)}" poster="${poster}"></video>`;
	}

	// Archive text is already HTML escaped, t.co links are expanded and media links are replaced with the media
	getContent(tweet) {
		let urls = new Map();
		for(let url of tweet.entities?.urls || []) {
			let display = entities.escapeUTF8(url.display_url || url.expanded_url);
			urls.set(url.url, `<a href="${entities.escapeAttribute(url.expanded_url)}">${display}</a>`);
		}

		let media = tweet.extended_entities?.media || tweet.entities?.media || [];
		for(let item of media) {
			urls.set(item.url, "");
		}

		let mentions = new Set((tweet.entities?.user_mentions || []).map(mention => mention.screen_name.toLowerCase()));

		let text = tweet.full_text || tweet.text || "";
		if(tweet.in_reply_to_status_id_str) {
			text = text.replace(/^(?:@\w+\s+)+/, "");
		}

		text = text.replace(Twitter.ENTITY_PATTERN, (match, offset, str) => {
			if(urls.has(match)) {
				return urls.get(match);
			}

			let username = match.slice(1);
			if(match.startsWith("@") && mentions.has(username.toLowerCase()) && !/\w/.test(str[offset - 1] || "")) {
				return `<a href="https://x.com/${username}">${match}</a>`;
			}

			return match;
		}).trim();

		let html = [];
		if(text) {
			html.push(`<p>${DataSource.nl2br(text)}</p>`);
		}
		for(let item of media) {
			html.push(`<p>${this.#getMediaHtml(item)}</p>`);
		}

		return html.join("\n");
	}

	#getAuthor() {
		let author = {
			name: this.#account.accountDisplayName || this.#account.username,
			url: `https://x.com/${this.#getUsername()}`,
		};
		if(this.#avatarUrl) {
			author.avatarUrl = this.#avatarUrl;
		}
		return author;
	}

	#getComments(root) {
		return DataSource.sortComments((this.#threadReplies.get(root.id_str) || []).map(tweet => {
			let parentId = tweet.in_reply_to_status_id_str;
			return DataSource.cleanComment({
				id: tweet.id_str,
				parentId: parentId === root.id_str ? 0 : parentId,
				url: this.#getTweetUrl(tweet.id_str),
				author: this.#getAuthor(),
				date: this.getRawEntryDates(tweet).created,
				content: this.getContent(tweet),
			});
		}));
	}

	cleanEntry(tweet) {
		let author = this.#getAuthor();

		let metadata = {
			id: tweet.id_str,
			slug: tweet.id_str,
		};
		if(tweet.in_reply_to_status_id_str) {
			metadata.inReplyTo = this.#getTweetUrl(tweet.in_reply_to_status_id_str);
		}

		let { created } = this.getRawEntryDates(tweet);

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(tweet),
			type: Twitter.TYPE,
			title: this.toReadableDate(created),
			url: this.#getTweetUrl(tweet.id_str),
			authors: author.name ? [author] : [],
			date: created,
			content: this.getContent(tweet),
			contentType: "html",
			metadata,
		};

		let counts = DataSource.cleanCounts({
			likes: tweet.favorite_count,
			reposts: tweet.retweet_count,
		});
		if(counts) {
			cleanEntry.counts = counts;
		}

		if(this.shouldIncludeComments()) {
			let comments = this.#getComments(tweet);
			if(comments.length) {
				cleanEntry.comments = comments;
			}
		}

		return cleanEntry;
	}
}
