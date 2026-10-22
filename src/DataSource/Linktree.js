import * as entities from "entities";

import { DataSource } from "../DataSource.js";

// A Linktree profile as one page, from the Next.js `__NEXT_DATA__` JSON embedded in the public profile HTML
export class Linktree extends DataSource {
	static TYPE = "linktree";
	static TYPE_FRIENDLY = "Linktree";
	static ORIGIN = "https://linktr.ee";

	constructor(target) {
		super();
		this.url = Linktree.getProfileUrl(target);
	}

	// Username (with or without `@`) or profile URL
	static getProfileUrl(target) {
		if(target.startsWith("https://") || target.startsWith("http://")) {
			return target;
		}
		return `${Linktree.ORIGIN}/${target.replace(/^@/, "")}`;
	}

	getType() {
		return "text";
	}

	getUrl() {
		return this.url;
	}

	static getNextData(html) {
		let match = html?.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
		if(!match) {
			throw new Error("Could not find Linktree profile data (__NEXT_DATA__) in the page.");
		}
		return JSON.parse(match[1]);
	}

	getEntriesFromData(html) {
		let { account, links } = Linktree.getNextData(html)?.props?.pageProps || {};
		if(!account) {
			return [];
		}
		return [{ account, links: links || [] }];
	}

	getUniqueIdFromEntry({ account }) {
		return `${DataSource.UUID_PREFIX}::${Linktree.TYPE}::${account.id || account.username}`;
	}

	// Timestamps are epoch milliseconds
	static toDate(value) {
		if(value) {
			return new Date(typeof value === "number" ? value : Date.parse(value));
		}
	}

	getRawEntryDates({ account }) {
		return {
			created: Linktree.toDate(account.createdAt),
			updated: Linktree.toDate(account.updatedAt),
		};
	}

	static byPosition(a, b) {
		return (a.position ?? 0) - (b.position ?? 0);
	}

	// Top-level links in order, with `GROUP` children nested (children of a missing group aren’t shown on Linktree either)
	// Widgets without a URL (e.g. mailing list sign ups, shops) and locked links are skipped
	static getSections(links) {
		links = links.map(link => ({ ...link, title: link.title?.trim() }));
		let isVisible = link => !link.locked && (link.url || link.type === "GROUP");
		let children = new Map();
		for(let link of links) {
			if(link.parent && isVisible(link)) {
				let parentId = String(link.parent.id);
				if(!children.has(parentId)) {
					children.set(parentId, []);
				}
				children.get(parentId).push(link);
			}
		}

		let sections = [];
		let ungrouped;
		for(let link of links.filter(link => !link.parent && isVisible(link)).sort(Linktree.byPosition)) {
			if(link.type === "GROUP") {
				ungrouped = undefined;
				sections.push({
					title: link.title,
					links: (children.get(String(link.id)) || []).sort(Linktree.byPosition),
				});
			} else {
				if(!ungrouped) {
					ungrouped = { links: [] };
					sections.push(ungrouped);
				}
				ungrouped.links.push(link);
			}
		}

		return sections.filter(section => section.links.length);
	}

	static getContent(sections) {
		return sections.map(({ title, links }) => {
			let html = [];
			if(title) {
				html.push(`<h2>${entities.escapeUTF8(title)}</h2>`);
			}
			html.push("<ul>");
			for(let link of links) {
				let thumbnail = link.thumbnail ? `<img src="${entities.escapeAttribute(link.thumbnail)}" alt=""> ` : "";
				html.push(`<li>${thumbnail}<a href="${entities.escapeAttribute(link.url)}">${entities.escapeUTF8(link.title || link.url)}</a></li>`);
			}
			html.push("</ul>");
			return html.join("\n");
		}).join("\n");
	}

	cleanEntry(rawEntry) {
		let { account } = rawEntry;
		let { created, updated } = this.getRawEntryDates(rawEntry);
		let sections = Linktree.getSections(rawEntry.links);

		let metadata = {
			id: account.id,
			slug: account.username,
			postType: "page",
			links: sections.flatMap(({ title, links }) => links.map(link => {
				let cleanLink = { id: link.id, type: link.type, title: link.title, url: link.url };
				if(title) {
					cleanLink.group = title;
				}
				return cleanLink;
			})),
		};

		let socialLinks = (account.socialLinks || []).filter(link => link.url).sort(Linktree.byPosition).map(({ type, url }) => ({ type, url }));
		if(socialLinks.length) {
			metadata.socialLinks = socialLinks;
		}

		let name = account.pageTitle?.trim() || account.username;
		let author = { name, url: this.url };
		if(account.profilePictureUrl) {
			author.avatarUrl = account.profilePictureUrl;
			metadata.media = { featuredImage: account.profilePictureUrl };
		}
		let cleanEntry = {
			uuid: this.getUniqueIdFromEntry(rawEntry),
			type: Linktree.TYPE,
			title: name,
			url: this.url,
			authors: [author],
			date: created || updated,
			dateUpdated: updated,
			content: Linktree.getContent(sections),
			contentType: "html",
			metadata,
		};

		if(account.description) {
			cleanEntry.description = account.description;
		}

		return cleanEntry;
	}
}
