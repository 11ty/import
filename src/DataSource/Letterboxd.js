import * as entities from "entities";
import { DataSource } from "../DataSource.js";
import { Rss } from "./Rss.js";

// Recent diary entries, reviews, and lists from a user’s public RSS feed
export class Letterboxd extends Rss {
	static TYPE = "letterboxd";
	static TYPE_FRIENDLY = "Letterboxd";
	static SUPPORTS_COMMENTS = false;

	// Poster image, first paragraph of the description
	static POSTER_REGEX = /^\s*<p>\s*<img [^>]*src="([^"]+)"[^>]*\/?>\s*<\/p>\s*/;

	constructor(username) {
		super(`https://letterboxd.com/${encodeURIComponent(username.replace(/^@/, ""))}/rss/`);
	}

	// e.g. `letterboxd-review-1528245338`
	static getEntryKind(rawEntry) {
		let guid = String(rawEntry.guid?.["#text"] ?? rawEntry.guid ?? "");
		return guid.match(/^letterboxd-([a-z]+)-/)?.[1];
	}

	static toBoolean(value) {
		if(value === undefined) {
			return;
		}
		return value === "Yes";
	}

	getUniqueIdFromEntry(entry) {
		let id = entry.guid?.["#text"] ?? entry.guid ?? entry.link;
		return `${DataSource.UUID_PREFIX}::${Letterboxd.TYPE}::${id}`;
	}

	cleanEntry(rawEntry, data) {
		let obj = super.cleanEntry(rawEntry, data);
		obj.type = Letterboxd.TYPE;
		obj.contentType = "html";
		obj.authors = obj.authors.map(author => ({ url: data.rss?.channel?.link, ...author }));

		let content = String(obj.content ?? "");
		let poster = content.match(Letterboxd.POSTER_REGEX)?.[1];
		obj.content = content.replace(Letterboxd.POSTER_REGEX, "").trim();

		let metadata = {
			...obj.metadata,
			letterboxdType: Letterboxd.getEntryKind(rawEntry),
		};

		if(poster) {
			metadata.media = { ...metadata.media, featuredImage: entities.decodeHTML(poster) };
		}

		if(rawEntry["letterboxd:filmTitle"] !== undefined) {
			metadata.film = {
				title: entities.decodeHTML(String(rawEntry["letterboxd:filmTitle"])),
				year: rawEntry["letterboxd:filmYear"],
				tmdbId: rawEntry["tmdb:movieId"],
			};
		}

		if(rawEntry["letterboxd:memberRating"] !== undefined) {
			metadata.rating = Number(rawEntry["letterboxd:memberRating"]);
		}

		let liked = Letterboxd.toBoolean(rawEntry["letterboxd:memberLike"]);
		if(liked !== undefined) {
			metadata.liked = liked;
		}

		let rewatch = Letterboxd.toBoolean(rawEntry["letterboxd:rewatch"]);
		if(rewatch !== undefined) {
			metadata.rewatch = rewatch;
		}

		if(rawEntry["letterboxd:watchedDate"]) {
			metadata.watchedDate = String(rawEntry["letterboxd:watchedDate"]);
		}

		obj.metadata = metadata;

		return obj;
	}
}
