import kleur from 'kleur';
import * as entities from "entities";
import striptags from "striptags";
import { DateCompare } from "@11ty/eleventy-utils";

import { Logger } from "./Logger.js";

class DataSource {
	static UUID_PREFIX = "11ty/import";
	// Sources set `entry.comments` in `cleanEntry` or fetch them in `addComments(entries)`
	static SUPPORTS_COMMENTS = false;
	// Downloads assets in comment content and avatars (e.g. your own media in a thread)
	static COMMENT_ASSETS = false;

	// Entries with unknown or partial comments (failed requests or nothing to request)
	static #incompleteComments = new WeakSet();

	#fetcher;
	#includeComments = true;
	// Failed comment requests without entries affect all of them
	#hasUnattributedCommentErrors = false;
	#includeContent = true;
	#fetchDataOverrides = {};
	#outputFolder = ".";

	constructor() {
		this.isVerbose = true;
		this.within = "";
	}

	setWithin(within) {
		this.within = within;
	}

	setVerbose(isVerbose) {
		this.isVerbose = isVerbose;
	}

	setFetcher(fetcher) {
		this.#fetcher = fetcher;
	}

	get fetcher() {
		if(!this.#fetcher) {
			throw new Error("Missing Fetcher instance.");
		}
		return this.#fetcher;
	}

	// For testing
	setDataOverride(url, data) {
		this.#fetchDataOverrides[url] = data;
	}

	setComments(includeComments) {
		this.#includeComments = Boolean(includeComments);
	}

	shouldIncludeComments() {
		return this.constructor.SUPPORTS_COMMENTS && this.#includeComments && this.#includeContent;
	}

	// Front matter only, no content or comments (e.g. for cross links)
	setContent(includeContent) {
		this.#includeContent = Boolean(includeContent);
	}

	shouldIncludeContent() {
		return this.#includeContent;
	}

	// Existing comments are kept (not replaced) for these entries
	setCommentsIncomplete(entries) {
		for(let entry of entries) {
			DataSource.#incompleteComments.add(entry);
		}
	}

	static hasIncompleteComments(entry) {
		return DataSource.#incompleteComments.has(entry);
	}

	resetCommentErrors() {
		this.#hasUnattributedCommentErrors = false;
	}

	hasUnattributedCommentErrors() {
		return this.#hasUnattributedCommentErrors;
	}

	// Comments are optional, so failed requests are logged and skipped
	// `entries` are the entries the request is for (their comments are incomplete if it fails)
	async getOptionalData(url, type = this.getType?.(), entries) {
		try {
			return await this.getData(url, type, false);
		} catch(e) {
			// Paging errors that just mean there are no more pages don’t count
			if(await this.isErrorWorthWorryingAbout(e)) {
				if(entries) {
					this.setCommentsIncomplete(entries);
				} else {
					this.#hasUnattributedCommentErrors = true;
				}
				if(this.isVerbose) {
					Logger.error(`Error fetching comments from ${this.getLogUrl(url)}: ${e.message}`);
				}
			}
			this.#fetcher?.clearError(url);
		}
	}

	// Shared comment shape: `parentId` is 0 for top-level comments and `content` is HTML
	// Private comments (the author opted out of wider distribution or added a content warning) are links only
	static cleanComment({ id, parentId, url, author = {}, date, content, isPrivate = false }) {
		let comment = {
			id,
			parentId: parentId || 0,
		};
		if(url) {
			comment.url = url;
		}

		if(isPrivate) {
			comment.private = true;
			comment.date = date;
			return comment;
		}

		comment.author = Object.fromEntries(Object.entries(author).filter(([key, value]) => value));
		comment.date = date;
		comment.content = content || "";
		return comment;
	}

	static sortComments(comments) {
		return comments.sort((a, b) => a.date - b.date);
	}

	// HTML from plain text comments
	static textToHtml(text) {
		return DataSource.nl2br(entities.escapeUTF8(text || ""));
	}

	// Escaped HTML from plain text with bare URLs turned into links
	static linkify(text) {
		return (text || "").split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]}'])/).map((part, index) => {
			let escaped = entities.escapeUTF8(part);
			return index % 2 ? `<a href="${escaped}">${escaped}</a>` : escaped;
		}).join("");
	}

	// HTML paragraphs from plain text (e.g. a video description)
	static textToParagraphs(text) {
		return (text || "").split(/(?:\r?\n){2,}/).map(paragraph => paragraph.trim()).filter(Boolean).map(paragraph => {
			return `<p>${DataSource.nl2br(DataSource.linkify(paragraph))}</p>`;
		}).join("\n");
	}

	setLabel(label) {
		this.label = label;
	}

	setFilepathFormatFunction(format) {
		if(typeof format !== "function") {
			throw new Error("filepathFormat option expected to be a function.");
		}
		this.filepathFormat = format;
	}

	getFilepathFormatFunction() {
		return this.filepathFormat;
	}

	isValidHttpUrl(url) {
		try {
			new URL(url);
			return url.startsWith("https://") || url.startsWith("http://");
		} catch(e) {
			// invalid url OR local path
			return false;
		}
	}

	setOutputFolder(dir) {
		this.#outputFolder = dir;
	}

	get outputFolder() {
		return this.#outputFolder;
	}

	toIsoDate(dateStr) {
		return (new Date(Date.parse(dateStr))).toISOString();
	}

	toReadableDate(dateStr, locale = 'en-US', options = {}) {
		options = Object.assign({
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
			timeZoneName: "short",
		}, options);

		let date = (new Date(Date.parse(dateStr)));
		return new Intl.DateTimeFormat(locale, options).format(date)
	}

	// Request URL as shown in logs (e.g. without secrets)
	getLogUrl(url) {
		return url;
	}

	// Receives the request URL
	getHeaders(url) {
		return {};
	}

	getUniqueIdFromEntry() {
		return "";
	}

	// Thanks to https://stackoverflow.com/questions/7467840/nl2br-equivalent-in-javascript/7467863#7467863
	static nl2br(str) {
		if (typeof str === 'undefined' || str === null) {
			return "";
		}
		return (str + '').replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1<br>$2');
	}

	// Plain text (e.g. for a description) from an HTML snippet
	static htmlToPlainText(html) {
		if(!html) {
			return;
		}

		return entities.decodeHTML(striptags(html)).replace(/\s+/g, " ").trim() || undefined;
	}

	async getData(url, type, showErrors = true) {
		if(!this.isValidHttpUrl(url)) {
			throw new Error("Invalid url: " + url);
		}

		// For testing, all urls must be stubbed
		if(Object.keys(this.#fetchDataOverrides).length > 0) {
			let override = this.#fetchDataOverrides[url];
			if(override) {
				if(override instanceof Error) {
					throw override;
				}

				return override;
			}

			throw new Error("Testing error, missing data override url: " + url);
		}

		return this.fetcher.fetch(url, {
			type,
			fetchOptions: {
				headers: this.getHeaders(url),
			},
		}, {
			verbose: true,
			showErrors,
			logUrl: this.getLogUrl(url),
		});
	}

	async getCleanedEntries(data) {
		// data should be iterable
		let dataEntries = data;
		if(typeof this.getEntriesFromData === "function") {
			dataEntries = this.getEntriesFromData(data) || [];
		}

		let entries = [];
		for(let rawEntry of dataEntries) {
			if(this.isWithin(rawEntry)) {
				if(typeof this.cleanEntry === "function") {
					let cleaned = await this.cleanEntry(rawEntry, data);
					entries.push(cleaned);
				} else {
					entries.push(rawEntry);
				}
			}
		}

		return entries;
	}

	toDateObj(dateVal) {
		if(dateVal instanceof Date) {
			return dateVal;
		}
		if(dateVal) {
			return new Date(Date.parse(dateVal));
		}
	}

	async getEntries() {
		let entries = [];
		if(typeof this.getUrl === "function") {
			let url = this.getUrl();
			if(typeof url === "function") {
				let pageNumber = 1;
				let pagedUrl;

				try {
					while(pagedUrl = url(pageNumber)) {
						let found = 0;
						let data = await this.getData(pagedUrl, this.getType(), false);
						let cleanedData = await this.getCleanedEntries(data);

						for(let entry of cleanedData) {
							entries.push(entry);

							// careful here, if an entry was updated out of your `within` window, it will be ignored
							found++;
						}

						if(found === 0) {
							break;
						}

						pageNumber++;
					}
				} catch(e) {
					let shouldWorry = await this.isErrorWorthWorryingAbout(e);
					if(shouldWorry) {
						Logger.error(kleur.red(`Error: ${e.message}`), e);
						throw e;
					}

					this.#fetcher?.clearError(pagedUrl);
				}
			} else if(typeof url === "string" || url instanceof URL) {
				let data = await this.getData(url, this.getType(), true);
				for(let entry of await this.getCleanedEntries(data) || []) {
					entries.push(entry);
				}
			}
		} else if(typeof this.getData === "function") {
			let data = await this.getData() || {};
			for(let entry of await this.getCleanedEntries(data) || []) {
				entries.push(entry);
			}
		}

		return this.finalizeEntries(entries);
	}

	// Shared post-processing for cleaned entries (for sources that override `getEntries`)
	finalizeEntries(entries) {
		// Feeds can list the same entry more than once (e.g. a Bluesky self-repost), keep the first
		let seen = new Set();
		entries = entries.filter(entry => {
			let key = entry.uuid || entry.url;
			if(!key) {
				return true;
			}
			if(seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});

		return entries.map(entry => {
			if(this.label) {
				entry.sourceLabel = this.label;
			}

			// create Date objects
			if(entry.date && !(entry.date instanceof Date)) {
				entry.date = this.toDateObj(entry.date);
			}

			if(entry.dateUpdated && !(entry.dateUpdated instanceof Date)) {
				entry.dateUpdated = this.toDateObj(entry.dateUpdated);
			}

			// Titles are plain text but feeds and the WordPress API encode them (e.g. `&#8217;`)
			if(typeof entry.title === "string") {
				entry.title = entities.decodeHTML(entry.title);
			}

			Object.defineProperty(entry, "source", {
				enumerable: false,
				value: this,
			});

			return entry;
		});
	}

	// Site root for whole-site imports, enables rewriting links to the site as root-relative
	getSiteUrl() {}

	// Asset contents from a local export (e.g. a `.zip` file) instead of fetching the URL: `{ body, contentType }`
	async getLocalAsset(url) {}

	// Linked files (not just embedded assets) to download, receives a URL object
	isLinkedAsset(url) {
		return false;
	}

	// Override to ignore paging errors that just mean there are no more pages
	async isErrorWorthWorryingAbout(e) {
		return true;
	}

	cleanStatus(status) {
		// WordPress has draft/publish
		// For future use
		return status;
	}

	isWithin(rawEntry) {
		if(!this.within || typeof this.getRawEntryDates !== "function") {
			return true;
		}

		let dates = this.getRawEntryDates(rawEntry);

		if(dates.created) {
			if(DateCompare.isTimestampWithinDuration(dates.created.getTime(), this.within)) {
				return true;
			}
		}

		if(dates.updated) {
			if(DateCompare.isTimestampWithinDuration(dates.updated.getTime(), this.within)) {
				return true;
			}
		}

		return false;
	}
}

export { DataSource };
