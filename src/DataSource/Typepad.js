import posthtml from "posthtml";

import { DataSource } from "../DataSource.js";
import { WaybackMachine } from "./WaybackMachine.js";

// Typepad blogs (offline since September 30, 2025) from the Wayback Machine, using Typepad’s standard template markup
export class Typepad extends WaybackMachine {
	static TYPE = "typepad";
	static TYPE_FRIENDLY = "Typepad";
	static SUPPORTS_COMMENTS = true;

	// Posts (`/2008/03/slug.html`) and pages (`/pages/slug.html`), skips archive (`/2008/03/index.html`), category, and comment pages
	isPage(urlkey) {
		return /\/(?:\d{4}\/\d{2}|pages)\/(?!index\.html$)[^/]+\.html$/i.test(urlkey);
	}

	static FIRST_YEAR = 2003;
	static LAST_YEAR = 2025;

	// When limited, one URL prefix per year (`/2017/`), newest first, unless the target is already a dated path
	getCaptureRanges() {
		if(!this.getLimit() || /\/\d{4}\//.test(this.url.pathname)) {
			return [{}];
		}

		let pathname = this.url.pathname.endsWith("/") ? this.url.pathname : `${this.url.pathname}/`;
		let ranges = [];
		for(let year = Typepad.LAST_YEAR; year >= Typepad.FIRST_YEAR; year--) {
			ranges.push({ pathname: `${pathname}${year}/` });
		}
		return ranges;
	}

	// Year and month from the URL, then the earliest capture
	getRawEntrySortValue(page) {
		let [, year = "", month = ""] = page.key.match(/\/(\d{4})\/(\d{2})\//) || [];
		return `${year}${month}:${page.firstTimestamp}`;
	}

	static findClass(nodes, name) {
		return WaybackMachine.find(nodes, node => WaybackMachine.hasClass(node, name));
	}

	static getText(node) {
		return WaybackMachine.getText(node).replace(/\s+/g, " ").trim();
	}

	// Body and the “Continue reading” extended body, without the entry footer
	getContentNode(tree) {
		let body = Typepad.findClass(tree, "entry-body");
		if(body) {
			let more = Typepad.findClass(tree, "entry-more");
			return { tag: false, content: [...body.content || [], "\n", ...more?.content || []] };
		}
		return Typepad.findClass(tree, "entry-content") || super.getContentNode(tree);
	}

	// Dates have no time zone and are treated as UTC (e.g. `March 04, 2008` and `01:02 PM`)
	static toDate(text) {
		if(text) {
			return new Date(Date.parse(`${text.replace(/ at /, " ")} UTC`));
		}
	}

	static getDate(tree) {
		let published = WaybackMachine.find(tree, node => node.tag === "abbr" && WaybackMachine.hasClass(node, "published") && node.attrs?.title);
		if(published) {
			return published.attrs.title;
		}

		let footer = Typepad.getText(Typepad.findClass(tree, "entry-footer"));
		let time = footer.match(/\b\d{1,2}:\d{2}\s*[AP]M\b/i)?.[0];
		let day = Typepad.getText(Typepad.findClass(tree, "date-header"))
			// Themes without a date header: `Posted by Name on June 04, 2018`
			|| footer.match(/\bon ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
		if(day) {
			return Typepad.toDate([day, time].filter(Boolean).join(" "));
		}
	}

	// Categories (`Posted at 01:02 PM in News`) and tags (`rel="tag"`)
	static getTags(tree) {
		let footers = Typepad.findClass(tree, "post-footers");
		let links = [
			...WaybackMachine.findAll(footers?.content, node => node.tag === "a"),
			...WaybackMachine.findAll(tree, node => node.tag === "a" && node.attrs?.rel === "tag"),
		];
		return [...new Set(links.map(link => Typepad.getText(link)).filter(Boolean))];
	}

	static getAuthors(tree) {
		let name = Typepad.getText(Typepad.findClass(tree, "entry-footer")).match(/\bPosted by (.+?) (?:at|on|in) /)?.[1];
		if(name) {
			return [name];
		}
	}

	// Flat comments: `.comment-content` with a `.comment-footer` (`Posted by: Name | March 05, 2008 at 09:00 AM`)
	async getComments(tree, baseUrl, timestamp) {
		let comments = [];
		for(let node of WaybackMachine.findAll(tree, node => WaybackMachine.hasClass(node, "comment") && Typepad.findClass(node.content, "comment-content"))) {
			let content = WaybackMachine.removeNodes(Typepad.findClass(node.content, "comment-content").content);
			let footer = Typepad.findClass(node.content, "comment-footer");
			this.resolveUrls([...content, footer], baseUrl, timestamp);

			let links = WaybackMachine.findAll(footer?.content, node => node.tag === "a" && node.attrs?.href);
			let permalink = links.find(link => link.attrs.href.includes("#comment-") || link.attrs.href.includes("#c"));
			let authorLink = links.find(link => link !== permalink);
			let footerText = Typepad.getText(footer);

			comments.push(DataSource.cleanComment({
				id: node.attrs?.id?.replace(/^comment-/, ""),
				parentId: 0,
				url: permalink?.attrs.href,
				author: {
					name: authorLink ? Typepad.getText(authorLink) : footerText.match(/^Posted by:\s*(.+?)\s*\|/)?.[1],
					url: authorLink?.attrs.href,
				},
				date: Typepad.toDate(permalink ? Typepad.getText(permalink) : footerText.split("|").pop().trim()),
				content: (await posthtml().process(content, { skipParse: true })).html.trim(),
			}));
		}
		return comments.sort((a, b) => a.date - b.date);
	}

	async getPageData(tree, { baseUrl, timestamp }) {
		let title = Typepad.getText(Typepad.findClass(tree, "entry-header"));
		let tags = Typepad.getTags(tree);

		return {
			title: title || undefined,
			date: Typepad.getDate(tree),
			authors: Typepad.getAuthors(tree),
			tags: tags.length ? tags : undefined,
			comments: this.shouldIncludeComments() ? await this.getComments(tree, baseUrl, timestamp) : undefined,
		};
	}
}
