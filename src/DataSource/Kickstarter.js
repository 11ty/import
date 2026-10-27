import { DataSource } from "../DataSource.js";
import { Atom } from "./Atom.js";

// The 10 most recent public updates for a project, from its Atom feed (Kickstarter has no public API)
export class Kickstarter extends Atom {
	static TYPE = "kickstarter";
	static TYPE_FRIENDLY = "Kickstarter";
	static SUPPORTS_COMMENTS = false;
	static ORIGIN = "https://www.kickstarter.com";

	constructor(target) {
		let { creator, project } = Kickstarter.getProject(target);
		super(`${Kickstarter.ORIGIN}/projects/${creator}/${project}/posts.atom`);
		this.creator = creator;
	}

	// Project URL (any subpage) or `creator/project`
	static getProject(target = "") {
		let path = /^https?:\/\//.test(target) ? new URL(target).pathname : target;
		let [creator, project] = path.replace(/^\/?projects\//, "").split("/").filter(Boolean);
		if(!creator || !project) {
			throw new Error("Kickstarter requires a project URL (e.g. https://www.kickstarter.com/projects/elanlee/exploding-kittens).");
		}
		return { creator: encodeURIComponent(creator), project: encodeURIComponent(project) };
	}

	// Post id from `/posts/…`
	static getFilePath(url) {
		return new URL(url).pathname.split("/").filter(Boolean).pop();
	}

	// e.g. `tag:www.kickstarter.com,2008-10-09:FreeformPost/4124702`
	static getPostId(entry) {
		return String(entry.id).split("/").pop();
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${Kickstarter.TYPE}::${Kickstarter.getPostId(entry)}`;
	}

	cleanEntry(rawEntry, data) {
		let obj = super.cleanEntry(rawEntry, data);
		obj.type = Kickstarter.TYPE;
		// Updates have no author, the project creator posts them
		obj.authors = [{ name: decodeURIComponent(this.creator), url: `${Kickstarter.ORIGIN}/profile/${this.creator}` }];
		obj.metadata = {
			...obj.metadata,
			id: Kickstarter.getPostId(rawEntry),
			project: {
				title: String(data.feed?.title ?? "").replace(/^Kickstarter:\s*/, "") || undefined,
				url: this.url.replace(/\/posts\.atom$/, ""),
			},
		};
		return obj;
	}
}
