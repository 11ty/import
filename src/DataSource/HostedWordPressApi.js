import { DataSource } from "../DataSource.js";

export class HostedWordPressApi extends DataSource {
	static TYPE = "wordpressapi-hosted";
	static TYPE_FRIENDLY = "WordPress.com";

	static #getHostname(url) {
		try {
			let u = new URL(url);
			return u.hostname;
		} catch(e) {}
		return "";
	}

	static isValid(url) {
		let hostname = this.#getHostname(url);
		return hostname.endsWith(".wordpress.com");
	}

	constructor(url) {
		super();
		this.url = url;

		if(!HostedWordPressApi.isValid(url)) {
			throw new Error("HostedWordPressApi expects a .wordpress.com URL, if you’re looking to use a self-hosted WordPress API please use the `wordpress` type (`WordPressApi` class).");
		}

		this.hostname = HostedWordPressApi.#getHostname(url);
	}

	getType() {
		return "json";
	}

	getUrl() {
		// return function for paging
		return (pageNumber = 1) => {
			// DRAFTS NOT SUPPORTED
			return `https://public-api.wordpress.com/rest/v1.1/sites/${this.hostname}/posts/?page=${pageNumber}&per_page=100`;
		};
	}

	getEntriesFromData(data) {
		return data.posts || [];
	}

	getUrlFromEntry(entry) {
		return entry.URL;
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${HostedWordPressApi.TYPE}::${entry.guid}`;
	}

	// stock WordPress is single-author
	#getAuthorData(author) {
		return [
			{
				name: author.name,
				url: author.profile_URL,
				avatarUrl: author.avatar_URL,
			}
		];
	}

	getRawEntryDates(rawEntry) {
		return {
			created: this.toDateObj(rawEntry.date),
			updated: this.toDateObj(rawEntry.modified),
		};
	}

	async cleanEntry(rawEntry, data) {
		let metadata = {
			categories: Object.keys(rawEntry.categories),
			tags: Object.keys(rawEntry.tags),
		};

		if(rawEntry.featured_image) {
			metadata.media = {
				featuredImage: rawEntry.featured_image,
			};

			// backwards compatibility (not downloaded or optimized)
			metadata.featuredImage = rawEntry.featured_image;
		}

		let { created, updated } = this.getRawEntryDates(rawEntry);

		return {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: HostedWordPressApi.TYPE,
			title: rawEntry.title,
			url: this.getUrlFromEntry(rawEntry),
			authors: this.#getAuthorData(rawEntry.author),
			date: created,
			dateUpdated: updated,
			content: rawEntry.content,
			contentType: "html",
			status: this.cleanStatus(rawEntry.status),
			metadata,
		}
	}
}
