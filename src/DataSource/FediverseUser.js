import path from "node:path";
import { DataSource } from "../DataSource.js";
import { Rss } from "./Rss.js";

export class FediverseUser extends Rss {
	static TYPE = "fediverse";
	static TYPE_FRIENDLY = "Fediverse";

	constructor(fullUsername) {
		let { username, hostname } = FediverseUser.parseUsername(fullUsername);
		super(`https://${hostname}/users/${username}.rss`);

		this.username = username;
		this.hostname = hostname;
	}

	static parseUsername(fullUsername) {
		if(fullUsername.startsWith("@")) {
			fullUsername = fullUsername.slice(1);
		}

		let [ username, hostname ]= fullUsername.split("@");

		return {
			username,
			hostname
		}
	}

	static parseFromUrl(url) {
		let { hostname, pathname } = new URL(url);
		let [empty, username, postId] = pathname.split("/");

		return {
			username: username.startsWith("@") ? username.slice(1) : username,
			hostname,
			postId,
		}
	}

	static getFilePath(url) {
		let { hostname, username, postId } = FediverseUser.parseFromUrl(url);
		return path.join(`${username}@${hostname}`, postId);
	}

	cleanEntry(entry, data) {
		let obj = super.cleanEntry(entry, data);
		obj.type = FediverseUser.TYPE;
		obj.contentType = "html";

		return obj;
	}

	// Unlisted replies, content warnings, and authors that opted out of search engines are links only
	static isPrivate(status) {
		return status.visibility === "unlisted" || Boolean(status.sensitive || status.spoiler_text || status.account?.noindex);
	}

	static cleanComment(status, rootId) {
		return DataSource.cleanComment({
			id: status.id,
			parentId: status.in_reply_to_id === rootId ? 0 : status.in_reply_to_id,
			url: status.url,
			author: {
				name: status.account?.display_name || status.account?.acct,
				url: status.account?.url,
				avatarUrl: status.account?.avatar,
			},
			date: new Date(Date.parse(status.created_at)),
			content: status.content,
			isPrivate: FediverseUser.isPrivate(status),
		});
	}

	// Only includes replies known to the user’s server
	async addComments(entries) {
		await Promise.all(entries.map(async entry => {
			let { postId } = FediverseUser.parseFromUrl(entry.url);
			if(!postId) {
				return;
			}

			let data = await this.getOptionalData(`https://${this.hostname}/api/v1/statuses/${postId}/context`, "json");
			entry.comments = DataSource.sortComments((data?.descendants || []).map(status => FediverseUser.cleanComment(status, postId)));
		}));
	}
}
