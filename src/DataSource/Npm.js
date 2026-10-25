import MarkdownIt from "markdown-it";
import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";

import { DataSource } from "../DataSource.js";

// Releases (one entry per published version) a user published, or of an organization’s packages
export class Npm extends DataSource {
	static TYPE = "npm";
	static TYPE_FRIENDLY = "npm";
	static DECODE_HTML = false;
	static REGISTRY = "https://registry.npmjs.org";
	static WEBSITE = "https://www.npmjs.com";
	static MISSING_README = "ERROR: No README data found!";
	static ASSET_TAGS = ["img", "video", "audio", "source"];
	static IGNORED_VERSION_PREFIXES = ["0.0.0-stage"];

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

	// Maps package names to access levels
	getUrl() {
		return `${Npm.REGISTRY}/-/${this.isOrg ? "org" : "user"}/${encodeURIComponent(this.name)}/package`;
	}

	static getPackumentUrl(name) {
		return `${Npm.REGISTRY}/${name.replace("/", "%2f")}`;
	}

	// Newest first without `0.0.0-stage` versions, unpublished packages have no versions
	async getEntries() {
		let names = Object.keys(await this.getData(this.getUrl(), this.getType()) || {}).sort();
		let packuments = await Promise.all(names.map(name => this.getData(Npm.getPackumentUrl(name), this.getType())));

		let releases = packuments
			.filter(packument => packument?.versions && !packument.time?.unpublished)
			.flatMap(packument => Object.keys(packument.versions).filter(version => packument.time?.[version] && !Npm.IGNORED_VERSION_PREFIXES.some(prefix => version.startsWith(prefix)) && this.isPublishedByUser(packument, version)).map(version => ({ packument, version })))
			.sort((a, b) => Date.parse(b.packument.time[b.version]) - Date.parse(a.packument.time[a.version]));

		return this.finalizeEntries(await this.getCleanedEntries(releases));
	}

	// Approver of a staged trusted publish, or the user who published
	static getPublisherName(release) {
		let user = release?._npmUser;
		return user?.trustedPublisher ? user.approver?.name : user?.name;
	}

	static isTrustedPublish(release) {
		return Boolean(release?._npmUser?.trustedPublisher);
	}

	// Unapproved trusted publishes count when the user published or approved another version of the package
	isPublishedByUser(packument, version) {
		if(this.isOrg) {
			return true;
		}

		let isUser = release => Npm.getPublisherName(release)?.toLowerCase() === this.name;
		let release = packument.versions[version];
		if(Npm.getPublisherName(release)) {
			return isUser(release);
		}
		return Npm.isTrustedPublish(release) && Object.values(packument.versions).some(isUser);
	}

	getUniqueIdFromEntry({ packument, version }) {
		return `${DataSource.UUID_PREFIX}::${Npm.TYPE}::${packument.name}::${version}`;
	}

	getRawEntryDates({ packument, version }) {
		let date = this.toDateObj(packument.time?.[version]);
		return { created: date, updated: date };
	}

	// `@scope/name/{version}` or `name/{version}`
	static getFilePath(url) {
		return decodeURIComponent(new URL(url).pathname.replace(/^\/package\//, "").replace("/v/", "/"));
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

	// Publisher (or approver) of the version, falls back to its author
	async cleanEntry({ packument, version }) {
		let release = packument.versions[version] || {};
		let { created } = this.getRawEntryDates({ packument, version });
		let publisher = Npm.getPublisherName(release) || (!this.isOrg && Npm.isTrustedPublish(release) ? this.name : undefined);
		let repositoryUrl = Npm.getRepositoryUrl(release.repository || packument.repository);

		let metadata = {
			name: packument.name,
			version,
		};
		if(version.includes("-")) {
			metadata.prerelease = true;
		}
		let distTags = Object.keys(packument["dist-tags"] || {}).filter(tag => packument["dist-tags"][tag] === version);
		if(distTags.length) {
			metadata.distTags = distTags;
		}
		if(release.license) {
			metadata.license = release.license;
		}
		if(repositoryUrl) {
			metadata.repository = repositoryUrl;
		}
		if(release.deprecated) {
			metadata.deprecated = release.deprecated;
		}

		let readme = release.readme && release.readme !== Npm.MISSING_README ? release.readme : "";

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry({ packument, version }),
			type: Npm.TYPE,
			title: `${packument.name}@${version}`,
			url: `${Npm.WEBSITE}/package/${packument.name}/v/${version}`,
			authors: [publisher ? { name: publisher, url: `${Npm.WEBSITE}/~${publisher}` } : Npm.getAuthor(release.author || packument.author)].filter(Boolean),
			date: created,
			content: readme ? await Npm.resolveRelativeUrls(this.#markdown.render(readme), repositoryUrl, release.repository?.directory) : "",
			contentType: "html",
			metadata,
		};

		let description = release.description || packument.description;
		if(description) {
			cleanEntry.description = description;
		}

		let tags = Array.isArray(release.keywords) ? release.keywords.filter(Boolean) : [];
		if(tags.length) {
			metadata.tags = tags;
			cleanEntry.tags = tags;
		}

		return cleanEntry;
	}
}
