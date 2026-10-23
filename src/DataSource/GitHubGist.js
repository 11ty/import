import MarkdownIt from "markdown-it";
import * as entities from "entities";

import { DataSource } from "../DataSource.js";
import { GitHub } from "./GitHub.js";

// Public gists for a GitHub user
export class GitHubGist extends DataSource {
	static TYPE = "github-gist";
	static TYPE_FRIENDLY = "GitHub Gist";
	static DECODE_HTML = false;
	static PER_PAGE = 100;

	#markdown = new MarkdownIt({ html: true, linkify: true });

	constructor(target) {
		super();
		if(!target) {
			throw new Error("GitHub Gist requires a username.");
		}
		this.username = GitHubGist.getUsername(target);
	}

	// Username, `@username`, or a profile or gist URL
	static getUsername(target) {
		if(target.startsWith("https://") || target.startsWith("http://")) {
			target = new URL(target).pathname.split("/")[1];
		}
		return target.replace(/^@/, "").toLowerCase();
	}

	getType() {
		return "json";
	}

	getHeaders(url) {
		return GitHub.getApiHeaders(url);
	}

	getUrl() {
		return pageNumber => `${GitHub.API}/users/${this.username}/gists?per_page=${GitHubGist.PER_PAGE}&page=${pageNumber}`;
	}

	getUniqueIdFromEntry(gist) {
		return `${DataSource.UUID_PREFIX}::${GitHubGist.TYPE}::${gist.id}`;
	}

	getRawEntryDates(gist) {
		return {
			created: this.toDateObj(gist.created_at),
			updated: this.toDateObj(gist.updated_at),
		};
	}

	// Gist ID
	static getFilePath(url) {
		return new URL(url).pathname.split("/").filter(Boolean).pop();
	}

	// Markdown files are rendered, others are code blocks, files over 1MB are links
	getContent(gist) {
		let files = Object.values(gist.files || {});
		return files.map(file => {
			let html = [];
			if(files.length > 1) {
				html.push(`<h2>${entities.escapeUTF8(file.filename)}</h2>`);
			}

			if(file.truncated || typeof file.content !== "string") {
				html.push(`<p><a href="${entities.escapeAttribute(file.raw_url)}">${entities.escapeUTF8(file.filename)}</a></p>`);
			} else if(file.language === "Markdown") {
				html.push(this.#markdown.render(file.content));
			} else {
				let className = file.language ? ` class="language-${entities.escapeAttribute(file.language.toLowerCase().replace(/\s+/g, "-"))}"` : "";
				html.push(`<pre${className}><code${className}>${entities.escapeUTF8(file.content)}</code></pre>`);
			}
			return html.join("\n");
		}).join("\n");
	}

	// The gist list doesn’t include file contents
	async cleanEntry(listedGist) {
		let gist = this.shouldIncludeContent() ? await this.getData(`${GitHub.API}/gists/${listedGist.id}`, this.getType()) : listedGist;
		let { created, updated } = this.getRawEntryDates(gist);
		let filenames = Object.keys(gist.files || {});

		let entry = {
			uuid: this.getUniqueIdFromEntry(gist),
			type: GitHubGist.TYPE,
			title: gist.description || filenames[0],
			url: gist.html_url,
			authors: [GitHub.getAuthor(gist.owner)].filter(Boolean),
			date: created,
			content: this.shouldIncludeContent() ? this.getContent(gist) : "",
			contentType: "html",
			metadata: {
				id: gist.id,
				files: filenames,
			},
		};

		if(updated && updated.getTime() !== created?.getTime()) {
			entry.dateUpdated = updated;
		}

		return entry;
	}
}
