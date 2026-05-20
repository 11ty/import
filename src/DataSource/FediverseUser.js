import path from "node:path";
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
}
