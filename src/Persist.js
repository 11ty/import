import { Logger } from "./Logger.js";

class Persist {
	static SUPPORTED_TYPES = ["github"];
	static READABLE_TYPES = {
		github: "GitHub"
	};

	static parseTarget(target = "") {
		let [type, remainder] = target.split(":");
		let [username, repository] = remainder.split("/");
		let [repositoryName, repositoryBranch] = repository.split("#");

		return {
			type,
			username,
			repository: repositoryName,
			branch: repositoryBranch || undefined,
		}
	}

	#verboseMode = true;
	#dryRun = false;

	constructor() {
		this.counts = {
			persist: 0
		};
	}

	getCounts() {
		return this.counts;
	}

	setVerbose(isVerbose) {
		this.#verboseMode = Boolean(isVerbose);
	}

	setDryRun(dryRun) {
		this.#dryRun = Boolean(dryRun);
	}

	// has setTarget been successful?
	canPersist() {
		return Boolean(this.type && this.username && this.repository);
	}

	setTarget(target) {
		// Must have a token to use this feature
		if(!process.env.GITHUB_TOKEN) {
			throw new Error("Missing GITHUB_TOKEN environment variable.");
		}

		let { type, username, repository, branch } = Persist.parseTarget(target);
		if(!Persist.SUPPORTED_TYPES.includes(type)) {
			throw new Error("Invalid persist type: " + type);
		}

		this.type = type;
		this.username = username;
		this.repository = repository;
		this.branch = branch;
	}

	getContentsUrl(filePath) {
		if(!this.canPersist()) {
			throw new Error("Missing Persist target. Have you called setTarget()?");
		}

		let path = filePath.split("/").map(segment => encodeURIComponent(segment)).join("/");
		return `https://api.github.com/repos/${this.username}/${this.repository}/contents/${path}`;
	}

	// https://docs.github.com/en/rest/repos/contents
	async githubRequest(filePath, options = {}) {
		let url = new URL(this.getContentsUrl(filePath));
		if(this.branch && !options.method) {
			url.searchParams.set("ref", this.branch);
		}

		return fetch(url, {
			...options,
			headers: {
				authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
				accept: "application/vnd.github+json",
				"user-agent": "@11ty/import",
				...options.headers,
			},
		});
	}

	async getSha(filePath) {
		let res = await this.githubRequest(filePath);
		if(!res.ok) {
			return;
		}

		let { sha } = await res.json();
		return sha;
	}

	async publish(filePath, content, { message, sha, force } = {}) {
		let res = await this.githubRequest(filePath, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				message,
				content: Buffer.from(content).toString("base64"),
				sha,
				branch: this.branch,
			}),
		});

		// 422 when the file already exists and no `sha` was provided
		if(res.status === 422 && force && !sha) {
			let existingSha = await this.getSha(filePath);
			if(existingSha) {
				return this.publish(filePath, content, { message, sha: existingSha });
			}
		}

		if(!res.ok) {
			Logger.error(`GitHub persist error (${res.status}) for ${filePath}:`, await res.text());
			return false;
		}

		let { content: { sha: createdSha } = {} } = await res.json();
		return createdSha;
	}

	persistFile(filePath, content, metadata = {}) {
		// safeMode is handled upstream, otherwise the file will always exist on the file system (because writes happen before persistence)
		if(this.#dryRun) {
			// Skipping, don’t log the skip
			return;
		}

		let options = {
			// Persist should not happen if safe mode is enabled and the file already exists
			force: true,
			message: `@11ty/import ${metadata.url ? `via ${metadata.url}` : ""}`,
			// sha: undefined // required for updating
		}

		this.counts.persist++;

		if(this.#verboseMode) {
			let readableType = Persist.READABLE_TYPES[this.type] || this.type;
			Logger.persisting(`${metadata.type ? `${metadata.type} ` : ""}to ${readableType}`, filePath, metadata.url, {
				size: content.length,
			});
		}

		return this.publish(filePath, content, options);
	}
}

export { Persist };
