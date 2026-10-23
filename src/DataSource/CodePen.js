import * as entities from "entities";

import { DataSource } from "../DataSource.js";

// Public pens for the owner of a CodePen API key, from the REST API v2 (https://blog.codepen.io/docs/api/api-v2/rest-api-v2/)
export class CodePen extends DataSource {
	static TYPE = "codepen";
	static TYPE_FRIENDLY = "CodePen";
	static DECODE_HTML = false;
	static API = "https://api.codepen.io/v2";
	static ORIGIN = "https://codepen.io";
	static PER_PAGE = 100;

	constructor(target) {
		super();
		if(!target) {
			throw new Error("CodePen requires a username.");
		}
		// Fails early, before any other source is fetched
		CodePen.getToken();
		this.username = CodePen.getUsername(target);
	}

	// Only read from the environment (at request time) so it isn’t written into code or kept on the instance
	static getToken() {
		let token = process.env.CODEPEN_API_KEY;
		if(!token) {
			throw new Error("CodePen requires an API key from https://codepen.io/settings/api (CODEPEN_API_KEY environment variable).");
		}
		return token;
	}

	// Username, `@username`, or a profile or pen URL
	static getUsername(target) {
		if(target.startsWith("https://") || target.startsWith("http://")) {
			target = new URL(target).pathname.split("/")[1];
		}
		return target.replace(/^@/, "");
	}

	getType() {
		return "json";
	}

	getHeaders(url) {
		if(url?.startsWith(CodePen.API)) {
			return { Authorization: `Bearer ${CodePen.getToken()}` };
		}
		return {};
	}

	// The API only lists the key owner’s pens (including private ones), so only public pens are imported
	getUrl() {
		return pageNumber => `${CodePen.API}/pens?access=Public&per_page=${CodePen.PER_PAGE}&page=${pageNumber}`;
	}

	getUniqueIdFromEntry(pen) {
		return `${DataSource.UUID_PREFIX}::${CodePen.TYPE}::${pen.id}`;
	}

	getRawEntryDates(pen) {
		return {
			created: this.toDateObj(pen.created_at),
			updated: this.toDateObj(pen.updated_at),
		};
	}

	// Pen id
	static getFilePath(url) {
		return new URL(url).pathname.split("/").filter(Boolean).pop();
	}

	getPenUrl(pen) {
		return `${CodePen.ORIGIN}/${this.username}/pen/${pen.id}`;
	}

	// Classic pens have one file per panel named by preprocessor (e.g. `/index.html`, `/style.scss`, `/script.js`)
	async getFiles(pen) {
		let data = await this.getOptionalData(`${CodePen.API}/pens/${pen.id}/files`, this.getType());
		let files = Array.isArray(data) ? data : data?.files;
		return (files || []).filter(file => file.is_binary || file.content?.trim());
	}

	// Binary files are links, others are code blocks
	static getContent({ description, files }) {
		let html = [];
		if(description) {
			html.push(DataSource.textToParagraphs(description));
		}
		for(let file of files) {
			let name = (file.path || file.name).replace(/^\//, "");
			html.push(`<h2>${entities.escapeUTF8(name)}</h2>`);
			if(file.is_binary || typeof file.content !== "string") {
				if(file.url) {
					html.push(`<p><a href="${entities.escapeAttribute(file.url)}">${entities.escapeUTF8(name)}</a></p>`);
				}
			} else {
				let extension = name.split(".").pop().toLowerCase();
				let className = name.includes(".") ? ` class="language-${entities.escapeAttribute(extension)}"` : "";
				html.push(`<pre${className}><code${className}>${entities.escapeUTF8(file.content.trim())}</code></pre>`);
			}
		}
		return html.join("\n");
	}

	async cleanEntry(pen) {
		let { created, updated } = this.getRawEntryDates(pen);
		let files = this.shouldIncludeContent() ? await this.getFiles(pen) : [];

		let metadata = {
			id: pen.id,
			editor: pen.editor,
			files: files.map(file => file.path),
		};
		if(pen.screenshot_urls?.large) {
			metadata.media = { featuredImage: pen.screenshot_urls.large };
		}

		let entry = {
			uuid: this.getUniqueIdFromEntry(pen),
			type: CodePen.TYPE,
			title: pen.title || "Untitled",
			url: this.getPenUrl(pen),
			authors: [{ name: this.username, url: `${CodePen.ORIGIN}/${this.username}` }],
			date: created,
			content: this.shouldIncludeContent() ? CodePen.getContent({ description: pen.description, files }) : "",
			contentType: "html",
			metadata,
		};

		if(pen.description) {
			entry.description = pen.description;
		}
		if(pen.tags?.length) {
			metadata.tags = pen.tags;
			entry.tags = pen.tags;
		}
		if(updated && updated.getTime() !== created?.getTime()) {
			entry.dateUpdated = updated;
		}

		return entry;
	}
}
