import posthtml from "posthtml";

import { DataSource } from "../DataSource.js";
import { WaybackMachine } from "./WaybackMachine.js";

// Hobix blogs (e.g. _why’s RedHanded) from the Wayback Machine, using Hobix’s default template markup
export class Hobix extends WaybackMachine {
	static TYPE = "hobix";
	static TYPE_FRIENDLY = "Hobix";
	static SUPPORTS_COMMENTS = true;

	// Entries (`/section/slug.html`), skips daily archives (`/2005/01/28.html`), section indexes, and other pages
	isPage(urlkey) {
		return /\)\/(?!\d{4}\/)[^?]+\/(?!index\.html$)[^/]+\.html$/i.test(urlkey);
	}

	static findClass(nodes, name) {
		return WaybackMachine.find(nodes, node => WaybackMachine.hasClass(node, name));
	}

	static getText(node) {
		return WaybackMachine.getText(node).replace(/\s+/g, " ").trim();
	}

	// Times are written by a script (`new Date(1111682784000)`), with a `<noscript>` fallback
	static getDate(node) {
		let script = WaybackMachine.find(node?.content, child => child.tag === "script");
		let milliseconds = WaybackMachine.getText(script).match(/new Date\((\d+)\)/)?.[1];
		if(milliseconds) {
			return new Date(Number(milliseconds));
		}

		let text = Hobix.getText(WaybackMachine.find(node?.content, child => child.tag === "noscript"));
		let [, day, time] = text.match(/(\d{1,2} [A-Z][a-z]{2} \d{4}) at (\d{1,2}:\d{2})/) || [];
		if(day) {
			return new Date(Date.parse(`${day} ${time} UTC`));
		}
	}

	// The first entry is the post, entries in `#comments` are comments, pages without entries are skipped
	constructor(target) {
		super(target);
		this.setContentSelector(".entryContent");
	}

	async getComments(tree, baseUrl, timestamp) {
		let container = WaybackMachine.find(tree, node => node.attrs?.id === "comments");
		let comments = [];
		for(let node of WaybackMachine.findAll(container?.content, node => WaybackMachine.hasClass(node, "entry"))) {
			let name = Hobix.getText(Hobix.findClass(node.content, "entryAuthor"));
			let date = Hobix.getDate(Hobix.findClass(node.content, "entryTime"));
			let contentNode = Hobix.findClass(node.content, "entryContent");
			// Comment form and preview
			if(!name || !date || !contentNode) {
				continue;
			}

			let content = WaybackMachine.removeNodes(contentNode.content);
			this.resolveUrls(content, baseUrl, timestamp);

			comments.push(DataSource.cleanComment({
				id: String(date.getTime()),
				parentId: 0,
				author: { name },
				date,
				content: (await posthtml().process(content, { skipParse: true })).html.trim(),
			}));
		}
		return DataSource.sortComments(comments);
	}

	// `by why in cult`
	async getPageData(tree, { baseUrl, timestamp }) {
		let entry = Hobix.findClass(tree, "entry");
		let titleNode = Hobix.findClass(entry?.content, "entryTitle");
		if(!titleNode) {
			return {};
		}

		let permalink = Hobix.findClass(titleNode.content, "entryPermalink");
		let title = Hobix.getText({ content: titleNode.content.filter(node => node !== permalink) });
		let [author, section] = WaybackMachine.findAll(Hobix.findClass(entry.content, "entrySection")?.content, node => node.tag === "a").map(link => Hobix.getText(link));

		return {
			title,
			date: Hobix.getDate(Hobix.findClass(tree, "entryFooter")),
			authors: author ? [author] : undefined,
			tags: section ? [section] : undefined,
			comments: this.shouldIncludeComments() ? await this.getComments(tree, baseUrl, timestamp) : undefined,
		};
	}
}
