import MarkdownIt from "markdown-it";
import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";

import { DataSource } from "../DataSource.js";

// Packages maintained by an npm user or organization, one entry per package with its README
export class Npm extends DataSource {
	static TYPE = "npm";
	static TYPE_FRIENDLY = "npm";
	static REGISTRY = "https://registry.npmjs.org";
	static WEBSITE = "https://www.npmjs.com";
	static MISSING_README = "ERROR: No README data found!";
	static ASSET_TAGS = ["img", "video", "audio", "source"];

	#markdown = new MarkdownIt({ html: true, linkify: true });

	constructor(target) {
		super();
		if(!target) {
			throw new Error("npm requires a username or `@scope`.");
		}
		Object.assign(this, Npm.parseTarget(target));
	}

	// Username, `~username`, `@scope`, or profile URL (`/~username` or `/org/scope`)
	static parseTarget(target) {
		if(target.startsWith("https://") || target.startsWith("http://")) {
			let [first, second] = new URL(target).pathname.split("/").filter(Boolean);
			if(first === "org" && second) {
				return { name: second, isOrg: true };
			}
			target = first || "";
		}
		if(target.startsWith("@")) {
			return { name: target.slice(1).toLowerCase(), isOrg: true };
		}
		return { name: target.replace(/^~/, "").toLowerCase(), isOrg: false };
	}

	getType() {
		return "json";
	}

	getProfileUrl() {
		return this.isOrg ? `${Npm.WEBSITE}/org/${this.name}` : `${Npm.WEBSITE}/~${this.name}`;
	}

	// Maps package names to access levels
	getUrl() {
		return `${Npm.REGISTRY}/-/${this.isOrg ? "org" : "user"}/${encodeURIComponent(this.name)}/package`;
	}

	static getPackumentUrl(name) {
		return `${Npm.REGISTRY}/${name.replace("/", "%2f")}`;
	}

	async getEntries() {
		let names = Object.keys(await this.getData(this.getUrl(), this.getType()) || {}).sort();
		let packuments = await Promise.all(names.map(name => this.getData(Npm.getPackumentUrl(name), this.getType())));
		// Unpublished packages have no versions
		packuments = packuments.filter(packument => packument?.["dist-tags"]?.latest && !packument.time?.unpublished);

		return this.finalizeEntries(await this.getCleanedEntries(packuments));
	}

	getUniqueIdFromEntry(packument) {
		return `${DataSource.UUID_PREFIX}::${Npm.TYPE}::${packument.name}`;
	}

	// First publish and latest version publish
	getRawEntryDates(packument) {
		return {
			created: this.toDateObj(packument.time?.created),
			updated: this.toDateObj(packument.time?.[packument["dist-tags"]?.latest] || packument.time?.modified),
		};
	}

	// `@scope/name` or `name`
	static getFilePath(url) {
		return decodeURIComponent(new URL(url).pathname.replace(/^\/package\//, ""));
	}

	// GitHub repository URL from a `repository` field (`git+https://…`, `git@github.com:…`, `github:owner/repo`, or `owner/repo`)
	static getRepositoryUrl(repository) {
		let url = typeof repository === "string" ? repository : repository?.url;
		if(!url) {
			return;
		}

		let [, owner, repo] = url.match(/^(?:github:)?([\w.-]+)\/([\w.-]+)$/) || url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/) || [];
		if(owner && repo) {
			return `https://github.com/${owner}/${repo}`;
		}
		return url.replace(/^git\+/, "").replace(/\.git$/, "");
	}

	// Relative README URLs resolve to the repository (as on npmjs.com), GitHub only
	static async resolveRelativeUrls(html, repositoryUrl, directory = "") {
		if(!repositoryUrl?.startsWith("https://github.com/")) {
			return html;
		}

		let path = directory ? `${directory.replace(/^\/|\/$/g, "")}/` : "";
		let linkBase = `${repositoryUrl}/blob/HEAD/${path}`;
		let assetBase = `${repositoryUrl.replace("https://github.com/", "https://raw.githubusercontent.com/")}/HEAD/${path}`;

		let result = await posthtml().use(urls({
			eachURL: (url, attr, tagName) => {
				if(!url || url.startsWith("#") || /^[a-z][a-z\d+.-]*:|^\/\//i.test(url)) {
					return url;
				}
				return new URL(url, Npm.ASSET_TAGS.includes(tagName) ? assetBase : linkBase).toString();
			},
		})).process(html);

		return result.html;
	}

	// `Name <email> (url)` or `{ name, email, url }`, emails are left out
	static getAuthor(author) {
		if(typeof author === "string") {
			let [, name, url] = author.match(/^([^<(]*)(?:<[^>]*>)?\s*(?:\(([^)]*)\))?/) || [];
			author = { name: name?.trim(), url: url?.trim() };
		}
		if(!author?.name) {
			return;
		}

		let cleaned = { name: author.name };
		if(author.url) {
			cleaned.url = author.url;
		}
		return cleaned;
	}

	async getContent(packument, latest, repositoryUrl) {
		let readme = [packument.readme, latest.readme].find(readme => readme && readme !== Npm.MISSING_README);
		if(!readme) {
			return DataSource.textToParagraphs(packument.description);
		}

		return Npm.resolveRelativeUrls(this.#markdown.render(readme), repositoryUrl, packument.repository?.directory || latest.repository?.directory);
	}

	async cleanEntry(packument) {
		let version = packument["dist-tags"].latest;
		let latest = packument.versions?.[version] || {};
		let { created, updated } = this.getRawEntryDates(packument);
		let repositoryUrl = Npm.getRepositoryUrl(packument.repository || latest.repository);

		let metadata = {
			name: packument.name,
			version,
		};
		if(packument.license || latest.license) {
			metadata.license = packument.license || latest.license;
		}
		if(packument.homepage || latest.homepage) {
			metadata.homepage = packument.homepage || latest.homepage;
		}
		if(repositoryUrl) {
			metadata.repository = repositoryUrl;
		}
		if(latest.deprecated) {
			metadata.deprecated = latest.deprecated;
		}

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(packument),
			type: Npm.TYPE,
			title: packument.name,
			url: `${Npm.WEBSITE}/package/${packument.name}`,
			authors: [Npm.getAuthor(packument.author || latest.author) || { name: this.name, url: this.getProfileUrl() }],
			date: created,
			dateUpdated: updated,
			content: await this.getContent(packument, latest, repositoryUrl),
			contentType: "html",
			metadata,
		};

		if(packument.description) {
			cleanEntry.description = packument.description;
		}

		let tags = Array.isArray(latest.keywords) ? latest.keywords.filter(Boolean) : [];
		if(tags.length) {
			metadata.tags = tags;
			cleanEntry.tags = tags;
		}

		return cleanEntry;
	}
}
