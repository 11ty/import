import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { DataSource } from "../DataSource.js";
import { Logger } from "../Logger.js";
import { GitHub } from "./GitHub.js";

const execFileAsync = promisify(execFile);

// Commit history for files in a git repository, one data file per path (no posts)
// Reads a local checkout when there is one (cheaper, and it follows renames), otherwise the GitHub API
export class GitHistory extends DataSource {
	static TYPE = "git";
	static TYPE_FRIENDLY = "Git History";
	static DECODE_HTML = false;
	// Writes data files only (always rewritten), never posts
	static DATA_ONLY = true;
	static PER_PAGE = 100;
	// A long history can be a few megabytes of `git log` output
	static MAX_BUFFER = 1024 * 1024 * 64;
	// ASCII record and unit separators, so subjects can’t break parsing
	static RECORD_SEPARATOR = "\x1e";
	static FIELD_SEPARATOR = "\x1f";

	#paths = [];
	#route;
	#remoteRepository;

	constructor(target) {
		super();
		if(!target) {
			throw new Error("Git history requires an `owner/repo` repository (e.g. 11ty/eleventy) or a local checkout folder.");
		}

		if(GitHistory.isLocalTarget(target)) {
			this.dir = GitHistory.expandHome(target);
			return;
		}

		let { owner, repo } = GitHub.parseTarget(target);
		if(!owner || !repo) {
			throw new Error(`Git history requires an \`owner/repo\` repository or a local checkout folder, received: ${target}`);
		}

		this.owner = owner;
		this.repo = repo;
	}

	// A folder on disk, or an explicitly relative or absolute path
	static isLocalTarget(target) {
		if(target.startsWith("https://") || target.startsWith("http://")) {
			return false;
		}
		if(target.startsWith(".") || target.startsWith("~") || path.isAbsolute(target)) {
			return true;
		}
		return fs.existsSync(target) && fs.statSync(target).isDirectory();
	}

	// Shells expand `~` before Node sees it, quoted paths don’t
	static expandHome(target) {
		if(target === "~" || target.startsWith("~/")) {
			return path.join(os.homedir(), target.slice(1));
		}
		return target;
	}

	// `owner/repo` for GitHub remotes (https, ssh, or scp-like), nothing for other hosts
	static getRemoteRepository(remote = "") {
		remote = remote.trim().replace(/\.git$/, "");
		if(!remote) {
			return;
		}

		// `git@github.com:owner/repo` isn’t a URL
		if(remote.startsWith("git@")) {
			let [hostname, pathname] = remote.slice(4).split(":");
			remote = hostname === "github.com" && pathname ? `https://github.com/${pathname}` : "";
		}

		if(remote && URL.canParse(remote)) {
			let url = new URL(remote);
			if(url.hostname === "github.com") {
				let [owner, repo] = url.pathname.split("/").filter(Boolean);
				if(owner && repo) {
					return `${owner}/${repo}`.toLowerCase();
				}
			}
		}
	}

	// `owner/repo` from the target or the checkout’s `origin` remote, for commit links
	get repository() {
		if(this.owner && this.repo) {
			return `${this.owner}/${this.repo}`;
		}
		return this.#remoteRepository;
	}

	// Comma separated file paths, a trailing `/` imports every tracked file in that folder
	// Relative to the repository root, or to the target folder when one was given
	setPaths(paths) {
		if(typeof paths === "string") {
			paths = paths.split(",");
		}

		this.#paths = Array.from(new Set((paths || []).map(filePath => String(filePath).trim().replace(/^\/+/, "")).filter(Boolean)));
	}

	getPaths() {
		return this.#paths;
	}

	getType() {
		return "json";
	}

	getHeaders(url) {
		return GitHub.getApiHeaders(url);
	}

	// Overridden in tests
	async runGit(args, cwd = this.dir) {
		let { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
			maxBuffer: GitHistory.MAX_BUFFER,
			windowsHide: true,
		});
		return stdout;
	}

	// The repository root, or nothing when the folder isn’t a git checkout
	async getRepositoryRoot(dir) {
		try {
			return (await this.runGit(["rev-parse", "--show-toplevel"], dir)).trim() || undefined;
		} catch(e) {}
	}

	async getOriginRepository(dir) {
		try {
			return GitHistory.getRemoteRepository(await this.runGit(["remote", "get-url", "origin"], dir));
		} catch(e) {}
	}

	// `local` or `api`: a local checkout avoids the API’s rate limit and follows renames, so it wins when there is one
	async getRoute() {
		if(this.#route) {
			return this.#route;
		}

		if(this.dir) {
			let root = await this.getRepositoryRoot(this.dir);
			if(!root) {
				throw new Error(`Git history requires a git repository, ${this.dir} is not one.`);
			}
			this.#remoteRepository = await this.getOriginRepository(this.dir);
			return this.#route = "local";
		}

		// A checkout of the same repository in the current folder is cheaper than the API
		let root = await this.getRepositoryRoot(".");
		if(root && await this.getOriginRepository(root) === this.repository) {
			this.dir = root;
			this.#remoteRepository = this.repository;
			if(this.isVerbose) {
				Logger.log(`Reading ${this.repository} git history from the local checkout at ${root}`);
			}
			return this.#route = "local";
		}

		return this.#route = "api";
	}

	getCommitsUrl(filePath, pageNumber = 1) {
		let url = new URL(`${GitHub.API}/repos/${this.repository}/commits`);
		url.searchParams.set("path", filePath);
		url.searchParams.set("per_page", GitHistory.PER_PAGE);
		url.searchParams.set("page", pageNumber);
		return url.toString();
	}

	static getLogFormat() {
		return ["%H", "%an", "%aI", "%s"].join(GitHistory.FIELD_SEPARATOR) + GitHistory.RECORD_SEPARATOR;
	}

	// `git log` records in the GitHub API’s shape, so both routes clean the same way
	static parseLog(stdout = "") {
		return stdout.split(GitHistory.RECORD_SEPARATOR).map(record => record.trim()).filter(Boolean).map(record => {
			let [sha, name, date, message = ""] = record.split(GitHistory.FIELD_SEPARATOR);
			return { sha, commit: { message, author: { name, date } } };
		});
	}

	// Tracked files under each folder path
	async #resolvePaths() {
		let folders = this.#paths.filter(filePath => filePath.endsWith("/"));
		if(!folders.length) {
			return this.#paths;
		}

		let tracked;
		if(await this.getRoute() === "local") {
			tracked = (await this.runGit(["ls-files", "-z", "--", ...folders])).split("\0").filter(Boolean);
		} else {
			// `HEAD` is the repository’s default branch
			let data = await this.getData(`${GitHub.API}/repos/${this.repository}/git/trees/HEAD?recursive=1`, "json", true);
			if(data?.truncated && this.isVerbose) {
				Logger.warning(`GitHub truncated the file list for ${this.repository}, some files in the requested folders are missing.`);
			}
			tracked = (data?.tree || []).filter(node => node.type === "blob").map(node => node.path);
		}

		return Array.from(new Set(this.#paths.flatMap(filePath => {
			return filePath.endsWith("/") ? tracked.filter(file => file.startsWith(filePath)) : [filePath];
		})));
	}

	// `--follow` continues the history through renames (one path at a time only)
	async #getLocalCommits(filePath) {
		return GitHistory.parseLog(await this.runGit(["log", "--follow", `--format=${GitHistory.getLogFormat()}`, "--", filePath]));
	}

	async #getApiCommits(filePath) {
		let commits = [];
		for(let pageNumber = 1; ; pageNumber++) {
			let results = await this.getData(this.getCommitsUrl(filePath, pageNumber), "json", false);
			if(!Array.isArray(results) || results.length === 0) {
				break;
			}

			commits.push(...results);

			if(results.length < GitHistory.PER_PAGE) {
				break;
			}
		}
		return commits;
	}

	// Newest first, `undefined` when the request or command failed (the existing data file is left alone)
	async #getCommits(filePath) {
		let isLocal = await this.getRoute() === "local";
		try {
			return isLocal ? await this.#getLocalCommits(filePath) : await this.#getApiCommits(filePath);
		} catch(e) {
			// Other paths are kept and merge into (instead of replacing) their data files
			this.getFailedPageUrls().add(isLocal ? path.join(this.dir, filePath) : this.getCommitsUrl(filePath));
			if(this.isVerbose) {
				Logger.error(`Error reading commits for ${filePath} in ${this.repository || this.dir}: ${e.message}`);
			}
		}
	}

	static getCommitDate(commit) {
		return commit?.commit?.author?.date || commit?.commit?.committer?.date;
	}

	// Only the subject line, author emails are left out
	cleanCommit(commit) {
		let cleaned = { id: commit.sha };

		// Local commits only have a link when the checkout has a GitHub `origin`
		let url = commit.html_url || (this.repository ? `${GitHub.WEBSITE}/${this.repository}/commit/${commit.sha}` : undefined);
		if(url) {
			cleaned.url = url;
		}

		let author = GitHub.getAuthor(commit.author);
		if(!author && commit.commit?.author?.name) {
			author = { name: commit.commit.author.name };
		}
		if(author) {
			cleaned.author = author;
		}

		cleaned.date = this.toDateObj(GitHistory.getCommitDate(commit));

		let subject = (commit.commit?.message || "").split(/\r?\n/)[0].trim();
		if(subject) {
			cleaned.message = subject;
		}

		return cleaned;
	}

	getUniqueIdFromEntry({ path: filePath }) {
		return `${DataSource.UUID_PREFIX}::${GitHistory.TYPE}::${this.repository || path.basename(path.resolve(this.dir))}::${filePath}`;
	}

	// Earliest and latest commit dates, so `within` keeps (and rewrites) a path’s full history
	getRawEntryDates({ commits }) {
		let times = (commits || []).map(commit => Date.parse(GitHistory.getCommitDate(commit))).filter(time => !isNaN(time));
		if(!times.length) {
			return {};
		}
		return {
			created: new Date(Math.min(...times)),
			updated: new Date(Math.max(...times)),
		};
	}

	cleanEntry({ path: filePath, commits }) {
		// `until` limits the history to the commits at that point in time
		let cleaned = commits.map(commit => this.cleanCommit(commit)).filter(commit => !this.isAfterUntil(commit.date)).sort((a, b) => a.date - b.date);
		if(!cleaned.length) {
			return;
		}

		let entry = {
			uuid: this.getUniqueIdFromEntry({ path: filePath }),
			type: GitHistory.TYPE,
			// Data file sits where the file lives in the repository (e.g. `src/posts/one.md` → `src/posts/one.json`)
			filePathSlug: filePath.replace(/\.[^./]+$/, ""),
			date: cleaned.at(-1).date,
			content: "",
			commits: cleaned,
		};

		if(this.repository) {
			entry.url = `${GitHub.WEBSITE}/${this.repository}/blob/HEAD/${filePath.split("/").map(encodeURIComponent).join("/")}`;
		}

		return entry;
	}

	async getEntries() {
		if(!this.#paths.length) {
			throw new Error("Git history requires at least one file path (the `path` option, `--path` on the command line).");
		}

		let entries = [];
		for(let filePath of await this.#resolvePaths()) {
			let commits = await this.#getCommits(filePath);
			if(!commits?.length) {
				continue;
			}

			let rawEntry = { path: filePath, commits };
			if(!this.isWithin(rawEntry)) {
				continue;
			}

			let entry = this.cleanEntry(rawEntry);
			if(entry) {
				entries.push(entry);
			}
		}

		return this.finalizeEntries(entries);
	}
}
