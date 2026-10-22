import fs from "node:fs";
import path from "node:path";
import * as entities from "entities";

import { DataSource } from "../DataSource.js";

// Posts and drafts from an unzipped Medium export (Settings → Security and apps → Download your information)
export class MediumExport extends DataSource {
	static TYPE = "medium";
	static TYPE_FRIENDLY = "Medium";
	static DRAFT_PREFIX = "draft_";

	constructor(dir) {
		super();
		this.dir = dir;
	}

	// Export folder or its `posts` folder
	async getData() {
		let dir = this.dir;
		if(fs.existsSync(path.join(dir, "posts"))) {
			dir = path.join(dir, "posts");
		}

		let filenames = (await fs.promises.readdir(dir)).filter(filename => filename.endsWith(".html")).sort();
		return Promise.all(filenames.map(async filename => ({
			filename,
			html: await fs.promises.readFile(path.join(dir, filename), "utf8"),
		})));
	}

	// Filenames end with the post id: `2024-01-01_Post-Title-0123456789ab.html` or `draft_Post-Title-0123456789ab.html`
	static getId(filename) {
		return path.basename(filename, ".html").split("-").pop();
	}

	static isDraft(filename) {
		return filename.startsWith(MediumExport.DRAFT_PREFIX);
	}

	static match(html, regex) {
		let value = html.match(regex)?.[1];
		return value === undefined ? undefined : entities.decodeHTML(value).trim();
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${MediumExport.TYPE}::${MediumExport.getId(entry.filename)}`;
	}

	getRawEntryDates({ html }) {
		return {
			created: this.toDateObj(MediumExport.match(html, /<time class="dt-published" datetime="([^"]+)"/)),
		};
	}

	// Removes the title and subtitle repeated at the top of the body
	static getContent(html) {
		let body = html.match(/<section data-field="body" class="e-content">([\s\S]*)<\/section>\s*<footer>/)?.[1] || "";
		return body
			.replace(/<h3\b[^>]*\bgraf--title\b[^>]*>[\s\S]*?<\/h3>/, "")
			.replace(/<h4\b[^>]*\bgraf--subtitle\b[^>]*>[\s\S]*?<\/h4>/, "")
			.trim();
	}

	cleanEntry(rawEntry) {
		let { filename, html } = rawEntry;
		let id = MediumExport.getId(filename);
		let { created } = this.getRawEntryDates(rawEntry);

		let author = { name: MediumExport.match(html, /class="p-author h-card"[^>]*>([^<]*)</) };
		let authorUrl = MediumExport.match(html, /<a href="([^"]+)" class="p-author h-card"/);
		if(authorUrl) {
			author.url = authorUrl;
		}

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: MediumExport.TYPE,
			// Titles are decoded later
			title: (html.match(/<h1 class="p-name">([\s\S]*?)<\/h1>/) || html.match(/<title>([\s\S]*?)<\/title>/))?.[1].trim(),
			// Drafts don’t have a canonical URL
			url: MediumExport.match(html, /<a href="([^"]+)" class="p-canonical"/) || `https://medium.com/p/${id}`,
			authors: author.name ? [author] : [],
			date: created,
			content: MediumExport.getContent(html),
			contentType: "html",
			status: MediumExport.isDraft(filename) ? "draft" : "publish",
			metadata: { id, slug: id },
		};

		let description = DataSource.htmlToPlainText(MediumExport.match(html, /<section data-field="subtitle" class="p-summary">([\s\S]*?)<\/section>/));
		if(description) {
			cleanEntry.description = description;
		}

		return cleanEntry;
	}
}
