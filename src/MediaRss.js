import * as entities from "entities";

// Media RSS (https://www.rssboard.org/media-rss) and enclosure helpers shared by feed data sources
class MediaRss {
	static MEDIUMS = ["image", "video", "audio"];

	static toArray(value) {
		if(!value) {
			return [];
		}
		return Array.isArray(value) ? value : [value];
	}

	static getText(value) {
		return value?.["#text"] ?? (typeof value === "object" ? undefined : value);
	}

	static getMedium({ medium, type }) {
		if(medium) {
			return MediaRss.MEDIUMS.includes(medium) ? medium : undefined;
		}

		let [prefix] = (type || "").split("/");
		return MediaRss.MEDIUMS.includes(prefix) ? prefix : undefined;
	}

	static getThumbnailUrl(container) {
		return MediaRss.toArray(container?.["media:thumbnail"])[0]?.["@_url"];
	}

	static getFeaturedImageUrl(rawEntry) {
		return MediaRss.getThumbnailUrl(rawEntry) || MediaRss.toArray(rawEntry["media:group"]).map(group => MediaRss.getThumbnailUrl(group)).find(Boolean);
	}

	// Returns normalized `{ url, type, medium, description, poster }` media from <media:content> and <media:group>
	static getMediaFromEntry(rawEntry) {
		let media = MediaRss.getMediaFromContainer(rawEntry, MediaRss.getThumbnailUrl(rawEntry));

		for(let group of MediaRss.toArray(rawEntry["media:group"])) {
			// Group items are alternate renditions of the same media, only use one
			let groupMedia = MediaRss.getMediaFromContainer(group, MediaRss.getThumbnailUrl(group) || MediaRss.getThumbnailUrl(rawEntry));
			let preferred = groupMedia.find(entry => entry.isDefault) || groupMedia[0];
			if(preferred) {
				media.push(preferred);
			}
		}

		return media;
	}

	static getMediaFromContainer(container, thumbnailUrl) {
		return MediaRss.toArray(container?.["media:content"]).map(source => {
			let type = source["@_type"];
			// Legacy: media:content without a medium or type is an image
			let medium = (!source["@_medium"] && !type) ? "image" : MediaRss.getMedium({ medium: source["@_medium"], type });

			return {
				url: source["@_url"],
				type,
				medium,
				isDefault: source["@_isDefault"] === "true" || source["@_isDefault"] === true,
				description: MediaRss.getText(source["media:description"]),
				poster: MediaRss.getThumbnailUrl(source) || thumbnailUrl,
			};
		}).filter(entry => entry.url && entry.medium);
	}

	// `{ url, type }` enclosures, only image/video/audio types are supported
	static getMediaFromEnclosures(enclosures) {
		return enclosures.map(({ url, type }) => ({
			url,
			type,
			medium: MediaRss.getMedium({ type }),
		})).filter(entry => entry.url && entry.medium);
	}

	static getHtml(media) {
		return media.map(({ url, medium, description, poster }) => {
			let src = entities.escapeAttribute(url);
			if(medium === "image") {
				return `<img src="${src}" alt="${entities.escapeAttribute(description || "")}">`;
			}
			if(medium === "video") {
				let posterAttr = poster ? ` poster="${entities.escapeAttribute(poster)}"` : "";
				return `<video controls src="${src}"${posterAttr}></video>`;
			}
			if(medium === "audio") {
				return `<audio controls src="${src}"></audio>`;
			}
		}).filter(Boolean).join("\n");
	}

	static appendToContent(content, media) {
		let html = MediaRss.getHtml(media);
		if(!html) {
			return content;
		}
		return content ? `${content}\n${html}` : html;
	}
}

export { MediaRss };
