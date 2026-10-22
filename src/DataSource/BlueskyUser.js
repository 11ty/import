import path from "node:path";
import { DataSource } from "../DataSource.js";
import { Rss } from "./Rss.js";

export class BlueskyUser extends Rss {
	static TYPE = "bluesky";
	static TYPE_FRIENDLY = "Bluesky";
	static API = "https://public.api.bsky.app/xrpc/";
	static THREAD_DEPTH = 100;
	// Author setting: “Discourage apps from showing my account to logged-out users”
	static NO_UNAUTHENTICATED_LABEL = "!no-unauthenticated";

	static normalizeUsername(username) {
		if(username.startsWith("@")) {
			return username.slice(1);
		}
		return username;
	}

	constructor(username) {
		super(`https://bsky.app/profile/${BlueskyUser.normalizeUsername(username)}/rss`);
	}

	static getFilePath(url) {
		let {pathname} = new URL(url);
		let [empty, profile, username, post, id] = pathname.split("/");
		return path.join(username, id);
	}

	cleanEntry(entry, data) {
		let obj = super.cleanEntry(entry, data);
		obj.type = BlueskyUser.TYPE;
		obj.contentType = "text";

		return obj;
	}

	// e.g. at://did:plc:…/app.bsky.feed.post/3lckusgtkuk2r
	static getAtUri(entry) {
		let id = entry.uuid.split("::").slice(2).join("::");
		if(id.startsWith("at://")) {
			return id;
		}
	}

	static getPostUrl(post) {
		let rkey = post.uri.split("/").pop();
		return `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;
	}

	// Post labels are content warnings (e.g. `nudity`, `graphic-media`)
	static isPrivate(post) {
		return post.labels?.length > 0 || (post.author?.labels || []).some(label => label.val === BlueskyUser.NO_UNAUTHENTICATED_LABEL);
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
					url: `https://bsky.app/profile/${post.author.handle}`,
					avatarUrl: post.author.avatar,
				},
				date: new Date(Date.parse(post.record?.createdAt || post.indexedAt)),
				content: DataSource.textToHtml(post.record?.text),
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
				return;
			}

			let data = await this.getOptionalData(`${BlueskyUser.API}app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=${BlueskyUser.THREAD_DEPTH}&parentHeight=0`, "json");
			entry.comments = DataSource.sortComments(BlueskyUser.getReplies(data?.thread, uri));
		}));
	}
}
