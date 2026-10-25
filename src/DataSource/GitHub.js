import MarkdownIt from "markdown-it";

import { DataSource } from "../DataSource.js";
import { Logger } from "../Logger.js";
import { Npm } from "./Npm.js";

// Releases for a repository (`owner/repo`) or repositories for a user or organization (`owner`)
export class GitHub extends DataSource {
	static TYPE = "github";
	static TYPE_FRIENDLY = "GitHub";
	static DECODE_HTML = false;
	static API = "https://api.github.com";
	static WEBSITE = "https://github.com";
	static PER_PAGE = 100;
	// Repository lists have no real watcher count (`watchers_count` is stars)
	static SUPPORTS_COUNTS = true;

	#markdown = new MarkdownIt({ html: true, linkify: true });
	// Issue and pull request totals for each page of repositories
	#issueCounts = new WeakMap();

	constructor(target) {
		super();
		if(!target) {
			throw new Error("GitHub requires an `owner/repo` repository (releases) or an `owner` user or organization (repositories).");
		}
		Object.assign(this, GitHub.parseTarget(target));
	}

	// `owner/repo` or a repository URL for releases, `owner`, `@owner`, or a profile URL for repositories
	static parseTarget(target) {
		if(target.startsWith("https://") || target.startsWith("http://")) {
			target = new URL(target).pathname;
		}

		let [owner, repo] = target.replace(/^\/|^@/g, "").split("/");
		return { owner: owner.toLowerCase(), repo: repo?.replace(/\.git$/, "").toLowerCase() || undefined };
	}

	// Optional `GITHUB_TOKEN` raises the rate limit from 60 to 5,000 requests per hour
	static getApiHeaders(url, accept = "application/vnd.github+json") {
		if(!url?.startsWith(GitHub.API)) {
			return {};
		}

		let headers = {
			Accept: accept,
			"X-GitHub-Api-Version": "2022-11-28",
		};
		if(process.env.GITHUB_TOKEN) {
			headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
		}
		return headers;
	}

	static getAuthor(user) {
		if(!user?.login) {
			return;
		}

		let author = {
			name: user.login,
			url: user.html_url,
		};
		if(user.avatar_url) {
			author.avatarUrl = user.avatar_url;
		}
		return author;
	}

	isReleases() {
		return Boolean(this.repo);
	}

	getType() {
		return "json";
	}

	// Release bodies as rendered HTML (`body_html`), READMEs as Markdown
	getHeaders(url) {
		if(url?.endsWith("/readme")) {
			return GitHub.getApiHeaders(url, "application/vnd.github.raw+json");
		}
		return GitHub.getApiHeaders(url, this.isReleases() ? "application/vnd.github.html+json" : undefined);
	}

	// Repositories are newest first, forks are skipped
	getUrl() {
		if(this.isReleases()) {
			return pageNumber => `${GitHub.API}/repos/${this.owner}/${this.repo}/releases?per_page=${GitHub.PER_PAGE}&page=${pageNumber}`;
		}
		return pageNumber => `${GitHub.API}/users/${this.owner}/repos?type=owner&sort=created&direction=desc&per_page=${GitHub.PER_PAGE}&page=${pageNumber}`;
	}

	getUniqueIdFromEntry(item) {
		if(this.isReleases()) {
			return `${DataSource.UUID_PREFIX}::${GitHub.TYPE}::${this.owner}/${this.repo}::${item.id}`;
		}
		return `${DataSource.UUID_PREFIX}::${GitHub.TYPE}::${item.full_name.toLowerCase()}`;
	}

	// Draft releases have no `published_at`, repositories use the last push
	getRawEntryDates(item) {
		return {
			created: this.toDateObj(item.published_at || item.created_at),
			updated: this.toDateObj(item.pushed_at || item.updated_at),
		};
	}

	// `releases/{tag}` or `{repo}`
	static getFilePath(url) {
		let [, repo, ...rest] = new URL(url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
		if(rest[0] === "releases" && rest[1] === "tag") {
			return ["releases", ...rest.slice(2)].join("/");
		}
		return repo;
	}

	cleanRelease(release) {
		let { created, updated } = this.getRawEntryDates(release);

		let metadata = {
			id: release.id,
			tag: release.tag_name,
		};
		if(release.prerelease) {
			metadata.prerelease = true;
		}

		let entry = {
			uuid: this.getUniqueIdFromEntry(release),
			type: GitHub.TYPE,
			title: release.name || release.tag_name,
			url: release.html_url,
			authors: [GitHub.getAuthor(release.author)].filter(Boolean),
			date: created,
			content: release.body_html || "",
			contentType: "html",
			metadata,
		};

		if(updated && updated.getTime() !== created?.getTime()) {
			entry.dateUpdated = updated;
		}
		if(release.draft) {
			entry.status = "draft";
		}

		return entry;
	}

	// Repositories without a README fall back to the description
	async getReadme(repo) {
		let url = `${GitHub.API}/repos/${repo.full_name}/readme`;
		try {
			let readme = await this.getData(url, "text", false);
			return Npm.resolveRelativeUrls(this.#markdown.render(readme), repo.html_url);
		} catch(e) {
			this.fetcher?.clearError(url);
			return DataSource.textToParagraphs(repo.description);
		}
	}

	// All-time issue and pull request totals for a page of repositories in one GraphQL request (requires `GITHUB_TOKEN`)
	async #fetchIssueCounts(repos) {
		if(!process.env.GITHUB_TOKEN || !repos.length) {
			return {};
		}

		let fields = repos.map((repo, index) => {
			let [owner, name] = repo.full_name.split("/");
			return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { issues { totalCount } pullRequests { totalCount } }`;
		});

		let url = `${GitHub.API}/graphql`;
		try {
			let { data } = await this.getData(url, "json", false, {
				method: "POST",
				body: JSON.stringify({ query: `{ ${fields.join(" ")} }` }),
			});
			return Object.fromEntries(repos.map((repo, index) => [repo.full_name, data?.[`r${index}`]]).filter(([name, counts]) => counts));
		} catch(e) {
			this.fetcher?.clearError(url);
			if(this.isVerbose) {
				Logger.error(`Error fetching issue and pull request counts from ${this.getLogUrl(url)}: ${e.message}`);
			}
			return {};
		}
	}

	// Requested once per page of repositories
	async getIssueCounts(repo, data = [repo]) {
		if(!this.#issueCounts.has(data)) {
			this.#issueCounts.set(data, this.#fetchIssueCounts(this.getEntriesFromData(data)));
		}
		return (await this.#issueCounts.get(data))[repo.full_name];
	}

	async cleanRepository(repo, data) {
		let { created, updated } = this.getRawEntryDates(repo);

		let metadata = {
			name: repo.full_name,
		};
		if(repo.language) {
			metadata.language = repo.language;
		}
		if(repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION") {
			metadata.license = repo.license.spdx_id;
		}
		if(repo.homepage) {
			metadata.homepage = repo.homepage;
		}
		if(repo.archived) {
			metadata.archived = true;
		}

		let entry = {
			uuid: this.getUniqueIdFromEntry(repo),
			type: GitHub.TYPE,
			title: repo.name,
			url: repo.html_url,
			authors: [GitHub.getAuthor(repo.owner)].filter(Boolean),
			date: created,
			dateUpdated: updated,
			content: this.shouldIncludeContent() ? await this.getReadme(repo) : "",
			contentType: "html",
			metadata,
		};

		if(repo.description) {
			entry.description = repo.description;
		}

		let issueCounts = await this.getIssueCounts(repo, data);
		let counts = DataSource.cleanCounts({
			stars: repo.stargazers_count,
			forks: repo.forks_count,
			issues: issueCounts?.issues?.totalCount,
			pullRequests: issueCounts?.pullRequests?.totalCount,
		});
		if(counts) {
			entry.counts = counts;
		}

		let tags = repo.topics || [];
		if(tags.length) {
			metadata.tags = tags;
			entry.tags = tags;
		}

		return entry;
	}

	getEntriesFromData(data) {
		return this.isReleases() ? data : data.filter(repo => !repo.fork);
	}

	async cleanEntry(item, data) {
		if(this.isReleases()) {
			return this.cleanRelease(item);
		}
		return this.cleanRepository(item, data);
	}
}
