import path from "node:path";
import PQueue from "p-queue";

import { Logger } from "./Logger.js";

class Persist {
	static SUPPORTED_TYPES = ["github"];
	static READABLE_TYPES = {
		github: "GitHub"
	};

	// `batch` writes one commit per run (split by the limits below), `file` writes one commit per file
	static MODES = ["batch", "file"];

	static DEFAULT_LIMITS = {
		maxFilesPerCommit: 500,
		maxBytesPerCommit: 50 * 1024 * 1024,
		blobConcurrency: 5,
		refRetries: 3,
		// URLs are listed in the commit message body up to this count
		maxUrlsInMessage: 20,
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

	// Git tree paths are relative to the repository root without `./` or `/` prefixes
	static normalizePath(filePath) {
		let normalized = path.posix.normalize(String(filePath).split(path.sep).join("/")).replace(/^(\.?\/)+/, "");
		if(!normalized || normalized === "." || normalized.startsWith("../")) {
			throw new Error(`Invalid persist path: ${filePath}`);
		}
		return normalized;
	}

	static chunk(files, { maxFilesPerCommit, maxBytesPerCommit }) {
		let chunks = [];
		let current = [];
		let currentBytes = 0;
		for(let file of files) {
			if(current.length && (current.length >= maxFilesPerCommit || currentBytes + file.size > maxBytesPerCommit)) {
				chunks.push(current);
				current = [];
				currentBytes = 0;
			}
			current.push(file);
			currentBytes += file.size;
		}
		if(current.length) {
			chunks.push(current);
		}
		return chunks;
	}

	#verboseMode = true;
	#dryRun = false;
	#mode = "batch";
	#queue = new Map();
	#pending = [];

	constructor() {
		this.counts = {
			persist: 0
		};
		this.limits = { ...Persist.DEFAULT_LIMITS };
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

	setMode(mode = "batch") {
		if(!Persist.MODES.includes(mode)) {
			throw new Error(`Invalid persist mode: ${mode} (expected ${Persist.MODES.join(" or ")})`);
		}
		this.#mode = mode;
	}

	setLimits(limits = {}) {
		Object.assign(this.limits, limits);
	}

	getQueue() {
		return Array.from(this.#queue.values());
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

	getReadableTarget() {
		return `${Persist.READABLE_TYPES[this.type] || this.type} ${this.username}/${this.repository}${this.branch ? `#${this.branch}` : ""}`;
	}

	getRepoUrl(pathname = "") {
		if(!this.canPersist()) {
			throw new Error("Missing Persist target. Have you called setTarget()?");
		}

		return `https://api.github.com/repos/${this.username}/${this.repository}${pathname}`;
	}

	getContentsUrl(filePath) {
		let path = filePath.split("/").map(segment => encodeURIComponent(segment)).join("/");
		return this.getRepoUrl(`/contents/${path}`);
	}

	async request(url, options = {}) {
		return fetch(url, {
			...options,
			headers: {
				authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
				accept: "application/vnd.github+json",
				"user-agent": "@11ty/import",
				...(options.body ? { "content-type": "application/json" } : {}),
				...options.headers,
			},
		});
	}

	// Throws on non-2xx responses (unless `allowStatus` includes the status)
	async api(pathname, { method = "GET", body, allowStatus = [] } = {}) {
		let res = await this.request(this.getRepoUrl(pathname), {
			method,
			body: body ? JSON.stringify(body) : undefined,
		});

		if(!res.ok && !allowStatus.includes(res.status)) {
			let error = new Error(`GitHub API ${method} ${pathname} failed (${res.status}): ${await res.text()}`);
			error.status = res.status;
			throw error;
		}

		return { status: res.status, data: res.ok ? await res.json() : undefined };
	}

	// https://docs.github.com/en/rest/repos/contents
	async githubRequest(filePath, options = {}) {
		let url = new URL(this.getContentsUrl(filePath));
		if(this.branch && !options.method) {
			url.searchParams.set("ref", this.branch);
		}

		return this.request(url, options);
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

		this.counts.persist++;

		if(this.#verboseMode) {
			let readableType = Persist.READABLE_TYPES[this.type] || this.type;
			Logger.persisting(`${metadata.type ? `${metadata.type} ` : ""}to ${readableType}`, filePath, metadata.url, {
				size: content.length,
			});
		}

		if(this.#mode === "file") {
			let promise = this.publish(filePath, content, {
				// Persist should not happen if safe mode is enabled and the file already exists
				force: true,
				message: `@11ty/import ${metadata.url ? `via ${metadata.url}` : ""}`,
			}).then(sha => ({ path: filePath, sha }), error => ({ path: filePath, error }));
			this.#pending.push(promise);
			return promise;
		}

		// Later writes to the same path replace earlier ones
		this.#queue.set(filePath, {
			path: filePath,
			content,
			size: content.length,
			metadata,
		});
	}

	static getCommitMessage(files, { part, total, maxUrlsInMessage } = {}) {
		let types = {};
		let sources = {};
		let urls = new Set();
		for(let { metadata } of files) {
			let type = metadata.type || "file";
			types[type] = (types[type] || 0) + 1;
			if(metadata.source) {
				sources[metadata.source] = (sources[metadata.source] || 0) + 1;
			}
			if(metadata.url) {
				urls.add(metadata.url);
			}
		}

		let typeSummary = Object.entries(types).map(([type, count]) => `${count} ${type === "comments" ? type : Logger.plural(count, type)}`).join(", ");
		let lines = [`@11ty/import: ${files.length} ${Logger.plural(files.length, "file")} (${typeSummary})${total > 1 ? ` [${part}/${total}]` : ""}`];

		let sourceLines = Object.entries(sources).map(([source, count]) => `- ${source}: ${count} ${Logger.plural(count, "file")}`);
		if(sourceLines.length) {
			lines.push("", "Sources:", ...sourceLines);
		}

		if(urls.size && urls.size <= maxUrlsInMessage) {
			lines.push("", "Imported from:", ...Array.from(urls, url => `- ${url}`));
		}

		return lines.join("\n");
	}

	async #getBranch() {
		if(!this.branch) {
			let { data } = await this.api("");
			this.branch = data.default_branch;
		}
		return this.branch;
	}

	async #getHead(refPath) {
		let { data: ref } = await this.api(`/git/ref/${refPath}`);
		let { data: commit } = await this.api(`/git/commits/${ref.object.sha}`);
		return { sha: commit.sha, tree: commit.tree.sha };
	}

	async #createBlobs(files) {
		let queue = new PQueue({ concurrency: this.limits.blobConcurrency });
		let failures = [];
		let blobs = [];
		await queue.addAll(files.map(file => async () => {
			try {
				let isBinary = typeof file.content !== "string";
				let { data } = await this.api("/git/blobs", {
					method: "POST",
					body: {
						content: isBinary ? Buffer.from(file.content).toString("base64") : file.content,
						encoding: isBinary ? "base64" : "utf-8",
					},
				});
				blobs.push({ file, sha: data.sha });
			} catch(error) {
				failures.push({ path: file.path, error });
			}
		}));

		// Stable tree order regardless of request timing
		blobs.sort((a, b) => Persist.normalizePath(a.file.path).localeCompare(Persist.normalizePath(b.file.path)));
		return { blobs, failures };
	}

	async #commitChunk(refPath, blobs, message) {
		let tree = blobs.map(({ file, sha }) => ({
			path: Persist.normalizePath(file.path),
			mode: "100644",
			type: "blob",
			sha,
		}));

		for(let attempt = 0; ; attempt++) {
			let head = await this.#getHead(refPath);
			let { data: newTree } = await this.api("/git/trees", {
				method: "POST",
				body: { base_tree: head.tree, tree },
			});
			let { data: commit } = await this.api("/git/commits", {
				method: "POST",
				body: { message, tree: newTree.sha, parents: [head.sha] },
			});

			// 422 when the update is not a fast-forward (the branch moved since we read it)
			let { status } = await this.api(`/git/refs/${refPath}`, {
				method: "PATCH",
				body: { sha: commit.sha, force: false },
				allowStatus: attempt < this.limits.refRetries ? [422] : [],
			});

			if(status !== 422) {
				return commit.sha;
			}

			if(this.#verboseMode) {
				Logger.warning(`${this.getReadableTarget()} moved during persist, retrying from the new head`);
			}
		}
	}

	async #flushBatch() {
		let files = this.getQueue();
		let result = { commits: [], files: 0, failures: [] };

		let valid = [];
		for(let file of files) {
			try {
				Persist.normalizePath(file.path);
				valid.push(file);
			} catch(error) {
				result.failures.push({ path: file.path, error });
			}
		}

		let branch = await this.#getBranch();
		let refPath = `heads/${branch.split("/").map(segment => encodeURIComponent(segment)).join("/")}`;
		let chunks = Persist.chunk(valid, this.limits);

		for(let j = 0; j < chunks.length; j++) {
			let { blobs, failures } = await this.#createBlobs(chunks[j]);
			result.failures.push(...failures);

			if(!blobs.length) {
				continue;
			}

			// Summarize in queue order
			let committed = new Set(blobs.map(({ file }) => file));
			let message = Persist.getCommitMessage(chunks[j].filter(file => committed.has(file)), {
				part: j + 1,
				total: chunks.length,
				maxUrlsInMessage: this.limits.maxUrlsInMessage,
			});

			try {
				let sha = await this.#commitChunk(refPath, blobs, message);
				result.commits.push(sha);
				result.files += blobs.length;
			} catch(error) {
				// Later chunks would build on a branch missing this one, so stop here
				for(let chunk of chunks.slice(j)) {
					let failed = chunk === chunks[j] ? blobs.map(({ file }) => file) : chunk;
					result.failures.push(...failed.map(file => ({ path: file.path, error })));
				}
				break;
			}
		}

		return result;
	}

	async #flushFiles() {
		let results = await Promise.all(this.#pending);
		let result = { commits: [], files: 0, failures: [] };
		for(let { path, sha, error } of results) {
			if(sha) {
				result.commits.push(sha);
				result.files++;
			} else {
				result.failures.push({ path, error: error || new Error("GitHub persist error") });
			}
		}
		return result;
	}

	// Writes queued files, returns `{ commits, files, failures }`
	async flush() {
		let result = { commits: [], files: 0, failures: [] };
		if(this.#dryRun || !this.canPersist() || (!this.#queue.size && !this.#pending.length)) {
			return result;
		}

		try {
			result = this.#mode === "file" ? await this.#flushFiles() : await this.#flushBatch();
		} catch(error) {
			result.failures.push(...this.getQueue().map(file => ({ path: file.path, error })));
		}

		this.#queue.clear();
		this.#pending = [];

		this.logResult(result);
		return result;
	}

	logResult({ commits, files, failures }) {
		let target = this.getReadableTarget();
		if(files) {
			let shas = this.#mode === "file" ? "" : `: ${commits.map(sha => sha.slice(0, 7)).join(", ")}`;
			Logger.log(`Persisted ${files} ${Logger.plural(files, "file")} to ${target} in ${commits.length} ${Logger.plural(commits.length, "commit")}${shas}`);
		}

		if(failures.length) {
			Logger.error(`Failed to persist ${failures.length} ${Logger.plural(failures.length, "file")} to ${target}:`);
			let errors = new Set();
			for(let { path, error } of failures) {
				Logger.error(`- ${path}`);
				errors.add(error?.message);
			}
			for(let message of errors) {
				if(message) {
					Logger.error(message);
				}
			}
		}
	}
}

export { Persist };
