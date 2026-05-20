import path from "node:path";
import { Rss } from "./Rss.js";

export class BlueskyUser extends Rss {
	static TYPE = "bluesky";
	static TYPE_FRIENDLY = "Bluesky";

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
}
