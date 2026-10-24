import * as entities from "entities";
import { DataSource } from "../DataSource.js";

// Public photos for a user (https://www.flickr.com/services/api/flickr.people.getPublicPhotos.html)
export class Flickr extends DataSource {
	static TYPE = "flickr";
	static TYPE_FRIENDLY = "Flickr";
	static DECODE_HTML = false;
	static API = "https://api.flickr.com/services/rest/";
	static PER_PAGE = 500;
	static SUPPORTS_COUNTS = true;
	static EXTRAS = ["description", "date_upload", "date_taken", "last_update", "tags", "geo", "media", "path_alias", "owner_name", "url_o", "url_k", "url_h", "url_l", "url_c", "url_z", "views", "count_faves", "count_comments"];
	// Largest available size first (originals can be private)
	static SIZES = ["o", "k", "h", "l", "c", "z"];

	#userId;
	#pages;

	constructor(user) {
		super();
		// Fails early, before any other source is fetched
		Flickr.getApiKey();
		this.user = Flickr.normalizeUser(user);
	}

	// Only read from the environment (at request time) so it isn’t written into code or kept on the instance
	static getApiKey() {
		let key = process.env.FLICKR_API_KEY;
		if(!key) {
			throw new Error("Flickr requires an API key (FLICKR_API_KEY environment variable).");
		}
		return key;
	}

	// Username, path alias, NSID (e.g. `12345678@N00`), or profile URL
	static normalizeUser(user = "") {
		if(user.startsWith("https://") || user.startsWith("http://")) {
			let [, photos, name] = new URL(user).pathname.split("/");
			if((photos === "photos" || photos === "people") && name) {
				return name;
			}
		}
		return user.replace(/^@/, "");
	}

	static isUserId(user) {
		return /^\d+@N\d+$/.test(user);
	}

	static redact(str = "") {
		return str.replace(/([?&]api_key=)[^&\s)]+/g, "$1…");
	}

	getLogUrl(url) {
		return Flickr.redact(url);
	}

	getType() {
		return "json";
	}

	getApiUrl(method, params = {}) {
		let url = new URL(Flickr.API);
		url.searchParams.set("method", method);
		for(let [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
		url.searchParams.set("format", "json");
		url.searchParams.set("nojsoncallback", "1");
		url.searchParams.set("api_key", Flickr.getApiKey());
		return url.toString();
	}

	// API errors are returned with a 200 status
	static assertOk(data) {
		if(data?.stat === "fail") {
			throw new Error(`Flickr API error ${data.code}: ${data.message}`);
		}
		return data;
	}

	async getUserId() {
		if(Flickr.isUserId(this.user)) {
			return this.user;
		}

		let data = Flickr.assertOk(await this.getData(this.getApiUrl("flickr.urls.lookupUser", {
			url: `https://www.flickr.com/photos/${this.user}/`,
		}), "json"));

		return data.user.id;
	}

	async getEntries() {
		this.#userId = await this.getUserId();
		return super.getEntries();
	}

	getUrl() {
		return (pageNumber = 1) => {
			if(this.#pages !== undefined && pageNumber > this.#pages) {
				return;
			}

			return this.getApiUrl("flickr.people.getPublicPhotos", {
				user_id: this.#userId,
				extras: Flickr.EXTRAS.join(","),
				per_page: Flickr.PER_PAGE,
				page: pageNumber,
			});
		};
	}

	getEntriesFromData(data) {
		let { photos } = Flickr.assertOk(data);
		this.#pages = Number(photos?.pages) || 0;
		return photos?.photo || [];
	}

	getUniqueIdFromEntry(entry) {
		return `${DataSource.UUID_PREFIX}::${Flickr.TYPE}::${entry.id}`;
	}

	static fromUnixTime(seconds) {
		if(seconds) {
			return new Date(Number(seconds) * 1000);
		}
	}

	getRawEntryDates(rawEntry) {
		return {
			created: Flickr.fromUnixTime(rawEntry.dateupload),
			updated: Flickr.fromUnixTime(rawEntry.lastupdate),
		};
	}

	static getImageUrl(photo) {
		for(let size of Flickr.SIZES) {
			if(photo[`url_${size}`]) {
				return photo[`url_${size}`];
			}
		}
	}

	static getPhotoUrl(photo) {
		return `https://www.flickr.com/photos/${photo.pathalias || photo.owner}/${photo.id}/`;
	}

	cleanEntry(photo) {
		let { created, updated } = this.getRawEntryDates(photo);
		let url = Flickr.getPhotoUrl(photo);
		let imageUrl = Flickr.getImageUrl(photo);
		let description = photo.description?._content || "";

		let content = [];
		if(imageUrl) {
			let img = `<img src="${entities.escapeAttribute(String(imageUrl))}" alt="${entities.escapeAttribute(String(photo.title ?? ""))}">`;
			// Videos link to the photo page (only a still image is available)
			content.push(photo.media === "video" ? `<p><a href="${url}">${img}</a></p>` : `<p>${img}</p>`);
		}
		if(description) {
			// Descriptions are HTML with plain newlines
			content.push(`<p>${DataSource.nl2br(description)}</p>`);
		}

		let metadata = {
			id: photo.id,
			slug: photo.id,
		};

		if(imageUrl) {
			metadata.media = { featuredImage: imageUrl };
		}

		if(photo.datetaken) {
			metadata.dateTaken = photo.datetaken;
		}

		if(photo.media === "video") {
			metadata.postType = "video";
		}

		// Photos without a location have `0` coordinates
		if(Number(photo.latitude) || Number(photo.longitude)) {
			metadata.geo = {
				latitude: Number(photo.latitude),
				longitude: Number(photo.longitude),
			};
		}

		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(photo),
			type: Flickr.TYPE,
			title: photo.title || this.toReadableDate(created),
			url,
			authors: [
				{
					name: photo.ownername,
					url: `https://www.flickr.com/photos/${photo.pathalias || photo.owner}/`,
				}
			],
			date: created,
			dateUpdated: updated,
			content: content.join("\n"),
			contentType: "html",
			metadata,
		};

		let tags = (photo.tags || "").split(" ").filter(Boolean);
		if(tags.length) {
			metadata.tags = tags;
			cleanEntry.tags = tags;
		}

		let counts = DataSource.cleanCounts({
			likes: photo.count_faves,
			comments: photo.count_comments,
			views: photo.views,
		});
		if(counts) {
			cleanEntry.counts = counts;
		}

		return cleanEntry;
	}
}
