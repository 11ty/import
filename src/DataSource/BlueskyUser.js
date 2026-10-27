import path from "node:path";
import * as entities from "entities";

import { DataSource } from "../DataSource.js";
import { MediaRss } from "../MediaRss.js";
import { Rss } from "./Rss.js";

// Public posts via the Bluesky AppView API (https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed)
export class BlueskyUser extends DataSource {
	static TYPE = "bluesky";
	static TYPE_FRIENDLY = "Bluesky";
	static API = "https://public.api.bsky.app/xrpc/";
	static PER_PAGE = 100;
	static THREAD_DEPTH = 100;
	static SUPPORTS_COMMENTS = true;
	static SUPPORTS_COUNTS = true;
	static DECODE_HTML = false;
	// Author setting: “Discourage apps from showing my account to logged-out users”
	static NO_UNAUTHENTICATED_LABEL = "!no-unauthenticated";
	// Paths for linked records that aren’t posts
	static RECORD_PATHS = {
		"app.bsky.feed.generator": "feed",
		"app.bsky.graph.list": "lists",
	};

	#pds = new Map();

	constructor(username) {
		super();
		this.username = BlueskyUser.normalizeUsername(username);
	}

	static normalizeUsername(username) {
		if(username.startsWith("@")) {
			return username.slice(1);
		}
		return username;
	}

	static getFilePath(url) {
		let {pathname} = new URL(url);
		let [empty, profile, username, post, id] = pathname.split("/");
		return path.join(username, id);
	}

	getType() {
		return "json";
	}

	getFeedUrl(cursor) {
		let params = new URLSearchParams({
			actor: this.username,
			// Includes self-replies (threads) but not replies to others
			filter: "posts_and_author_threads",
			limit: BlueskyUser.PER_PAGE,
		});
		if(cursor) {
			params.set("cursor", cursor);
		}
		return `${BlueskyUser.API}app.bsky.feed.getAuthorFeed?${params}`;
	}

	// Paged by cursor, reposts are skipped so a page may have no entries
	async getEntries() {
		let entries = [];
		let cursor;
		do {
			let data = await this.getData(this.getFeedUrl(cursor), this.getType());
			cursor = data?.cursor;
			entries.push(...await this.getCleanedEntries(data));

			let oldest = this.getEntriesFromData(data).at(-1);
			if(oldest && !this.isWithin(oldest)) {
				break;
			}
		} while(cursor && !this.isLimitReached());

		return this.finalizeEntries(entries);
	}

	getEntriesFromData(data) {
		return (data?.feed || []).filter(item => !item.reason).map(item => item.post);
	}

	// Matches the RSS `<guid>` used by earlier versions
	getUniqueIdFromEntry(post) {
		return `${DataSource.UUID_PREFIX}::${Rss.TYPE}::${post.uri}`;
	}

	getRawEntryDates(post) {
		return {
			created: this.toDateObj(post.record?.createdAt || post.indexedAt),
		};
	}

	// e.g. at://did:plc:…/app.bsky.feed.post/3lckusgtkuk2r
	static parseAtUri(uri) {
		let [did, collection, rkey] = (uri || "").replace(/^at:\/\//, "").split("/");
		return { did, collection, rkey };
	}

	static getAtUri(entry) {
		let id = entry.uuid.split("::").slice(2).join("::");
		if(id.startsWith("at://")) {
			return id;
		}
	}

	static getProfileUrl(author) {
		return `https://bsky.app/profile/${author?.handle || author?.did}`;
	}

	// Falls back to the DID when there’s no author (e.g. blocked or deleted posts)
	static getPostUrl(post) {
		let { did, rkey } = BlueskyUser.parseAtUri(post.uri);
		return `https://bsky.app/profile/${post.author?.handle || did}/post/${rkey}`;
	}

	static getRecordUrl(uri) {
		let { did, collection, rkey } = BlueskyUser.parseAtUri(uri);
		if(collection === "app.bsky.feed.post") {
			return BlueskyUser.getPostUrl({ uri });
		}
		if(collection === "app.bsky.graph.starterpack") {
			return `https://bsky.app/starter-pack/${did}/${rkey}`;
		}
		if(BlueskyUser.RECORD_PATHS[collection]) {
			return `https://bsky.app/profile/${did}/${BlueskyUser.RECORD_PATHS[collection]}/${rkey}`;
		}
		return `https://bsky.app/profile/${did}`;
	}

	// Post labels are content warnings (e.g. `nudity`, `graphic-media`)
	static isPrivate(post) {
		return post.labels?.length > 0 || (post.author?.labels || []).some(label => label.val === BlueskyUser.NO_UNAUTHENTICATED_LABEL);
	}

	// Link cards are skipped when the post text already links to the same URL
	static hasLinkFacet(record, uri) {
		let normalize = url => {
			try {
				return new URL(url).href;
			} catch(e) {
				return url;
			}
		};
		let target = normalize(uri);
		return (record?.facets || []).some(({ features = [] }) => features.some(feature => {
			return feature.$type === "app.bsky.richtext.facet#link" && normalize(feature.uri) === target;
		}));
	}

	static getLink(url, text) {
		return `<a href="${entities.escapeAttribute(url)}">${entities.escapeText(text || url)}</a>`;
	}

	// Facets use UTF-8 byte offsets (https://docs.bsky.app/docs/advanced-guides/post-richtext)
	static getRichTextHtml(text = "", facets = []) {
		let bytes = Buffer.from(text, "utf8");
		let html = "";
		let index = 0;
		let sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);
		for(let { index: { byteStart, byteEnd }, features = [] } of sorted) {
			if(byteStart < index || byteEnd <= byteStart) {
				continue;
			}

			let feature = features[0] || {};
			let href;
			if(feature.$type === "app.bsky.richtext.facet#link") {
				href = feature.uri;
			} else if(feature.$type === "app.bsky.richtext.facet#mention") {
				href = `https://bsky.app/profile/${feature.did}`;
			} else if(feature.$type === "app.bsky.richtext.facet#tag") {
				href = `https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}`;
			}
			if(!href) {
				continue;
			}

			html += entities.escapeText(bytes.subarray(index, byteStart).toString("utf8"));
			html += BlueskyUser.getLink(href, bytes.subarray(byteStart, byteEnd).toString("utf8"));
			index = byteEnd;
		}
		html += entities.escapeText(bytes.subarray(index).toString("utf8"));

		return html.split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(Boolean).map(paragraph => `<p>${DataSource.nl2br(paragraph)}</p>`).join("\n");
	}

	// Personal Data Server for a DID, to download original video files
	async getPds(did) {
		if(!this.#pds.has(did)) {
			let url = did.startsWith("did:web:") ? `https://${did.slice("did:web:".length)}/.well-known/did.json` : `https://plc.directory/${did}`;
			this.#pds.set(did, this.getData(url, "json", false).then(doc => {
				return doc?.service?.find(service => service.id === "#atproto_pds" || service.id === `${did}#atproto_pds`)?.serviceEndpoint;
			}, () => {}));
		}
		return this.#pds.get(did);
	}

	async getVideoHtml(video, post, isOwn) {
		let did = BlueskyUser.parseAtUri(post.uri).did;
		let pds = isOwn ? await this.getPds(did) : undefined;
		if(pds && video.cid) {
			let src = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(video.cid)}`;
			return MediaRss.getHtml([{ url: src, medium: "video", poster: video.thumbnail }]);
		}

		// Videos by others (or without a known PDS) link to the post
		let poster = video.thumbnail ? `<img src="${entities.escapeAttribute(video.thumbnail)}" alt="${entities.escapeAttribute(video.alt || "")}">` : "Video";
		return `<p><a href="${entities.escapeAttribute(BlueskyUser.getPostUrl(post))}">${poster}</a></p>`;
	}

	// Embedded views (https://docs.bsky.app/docs/advanced-guides/posts#embeds), quotes inside quotes are links
	async getEmbedHtml(embed, post, { isOwn = false, isQuoted = false } = {}) {
		let type = embed?.$type;
		if(type === "app.bsky.embed.images#view") {
			return MediaRss.getHtml(embed.images.map(image => ({ url: image.fullsize, medium: "image", description: image.alt })));
		}
		if(type === "app.bsky.embed.video#view") {
			return this.getVideoHtml(embed, post, isOwn);
		}
		if(type === "app.bsky.embed.external#view") {
			let { uri, title, description } = embed.external || {};
			if(BlueskyUser.hasLinkFacet(post.record || post.value, uri)) {
				return "";
			}
			let descriptionHtml = description ? `<br>\n${entities.escapeText(description)}` : "";
			return `<p>${BlueskyUser.getLink(uri, title)}${descriptionHtml}</p>`;
		}
		if(type === "app.bsky.embed.recordWithMedia#view") {
			return [
				await this.getEmbedHtml(embed.media, post, { isOwn, isQuoted }),
				await this.getEmbedHtml({ $type: "app.bsky.embed.record#view", record: embed.record?.record }, post, { isOwn, isQuoted }),
			].filter(Boolean).join("\n");
		}
		if(type === "app.bsky.embed.record#view") {
			return this.getRecordHtml(embed.record, isQuoted);
		}
		return "";
	}

	async getRecordHtml(record, isQuoted) {
		let url = BlueskyUser.getRecordUrl(record?.uri);
		if(record?.$type !== "app.bsky.embed.record#viewRecord") {
			// Feeds, lists, starter packs, and blocked, deleted, or detached posts
			let name = record?.displayName || record?.name || record?.record?.name;
			return `<p>${BlueskyUser.getLink(url, name || (record?.$type?.startsWith("app.bsky.embed.record#view") ? "Quoted post (unavailable)" : url))}</p>`;
		}

		url = BlueskyUser.getPostUrl(record);
		if(BlueskyUser.isPrivate(record)) {
			return `<p>${BlueskyUser.getLink(url, "Quoted post (visible to signed-in users only)")}</p>`;
		}
		if(isQuoted) {
			return `<p>${BlueskyUser.getLink(url, "Quoted post")}</p>`;
		}

		let author = record.author || {};
		let html = [BlueskyUser.getRichTextHtml(record.value?.text, record.value?.facets)];
		for(let embed of record.embeds || []) {
			html.push(await this.getEmbedHtml(embed, record, { isQuoted: true }));
		}
		html.push(`<p>— ${BlueskyUser.getLink(BlueskyUser.getProfileUrl(author), author.displayName || author.handle)} (${BlueskyUser.getLink(url, this.toReadableDate(record.value?.createdAt || record.indexedAt))})</p>`);

		return `<blockquote cite="${entities.escapeAttribute(url)}">\n${html.filter(Boolean).join("\n")}\n</blockquote>`;
	}

	async cleanEntry(post) {
		let { created } = this.getRawEntryDates(post);
		let url = BlueskyUser.getPostUrl(post);
		let counts = DataSource.cleanCounts({
			likes: post.likeCount,
			reposts: post.repostCount,
			comments: post.replyCount,
			quotes: post.quoteCount,
		});
		let content = "";
		if(this.shouldIncludeContent()) {
			content = [
				BlueskyUser.getRichTextHtml(post.record?.text, post.record?.facets),
				await this.getEmbedHtml(post.embed, post, { isOwn: true }),
			].filter(Boolean).join("\n");
		}

		return {
			uuid: this.getUniqueIdFromEntry(post),
			type: BlueskyUser.TYPE,
			title: this.toReadableDate(created),
			url,
			authors: [{
				name: post.author?.displayName || post.author?.handle,
				url: BlueskyUser.getProfileUrl(post.author),
			}],
			date: created,
			content,
			contentType: "html",
			metadata: {
				slug: path.basename(BlueskyUser.getFilePath(url)),
			},
			...(counts ? { counts } : {}),
		};
	}

	// Flattens the reply tree (blocked or deleted replies don’t have a `post`)
	static getReplies(thread, rootUri, comments = []) {
		for(let reply of thread?.replies || []) {
			let post = reply?.post;
			if(!post) {
				continue;
			}

			let parentUri = post.record?.reply?.parent?.uri;
			comments.push(DataSource.cleanComment({
				id: post.uri,
				parentId: parentUri === rootUri ? 0 : parentUri,
				url: BlueskyUser.getPostUrl(post),
				author: {
					name: post.author.displayName || post.author.handle,
					url: BlueskyUser.getProfileUrl(post.author),
					avatarUrl: post.author.avatar,
				},
				date: new Date(Date.parse(post.record?.createdAt || post.indexedAt)),
				content: BlueskyUser.getRichTextHtml(post.record?.text, post.record?.facets),
				isPrivate: BlueskyUser.isPrivate(post),
			}));

			BlueskyUser.getReplies(reply, rootUri, comments);
		}

		return comments;
	}

	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let uri = BlueskyUser.getAtUri(entry);
			if(!uri) {
				// Nothing to request, existing comments are kept
				this.setCommentsIncomplete([entry]);
				return;
			}

			let data = await this.getOptionalData(`${BlueskyUser.API}app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=${BlueskyUser.THREAD_DEPTH}&parentHeight=0`, "json", [entry]);
			entry.comments = DataSource.sortComments(BlueskyUser.getReplies(data?.thread, uri));
		}));
	}
}
