import test from 'node:test';
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { Importer } from "../src/Importer.js";
import { DataSource } from "../src/DataSource.js";
import { Persist } from "../src/Persist.js";
import { Fetcher } from "../src/Fetcher.js";
import { HtmlTransformer } from "../src/HtmlTransformer.js";
import { MarkdownToHtml } from "../src/MarkdownToHtml.js";
import { WordPressApi } from "../src/DataSource/WordPressApi.js";
import { Squarespace } from "../src/DataSource/Squarespace.js";
import { Rss } from "../src/DataSource/Rss.js";
import { Archive } from "../src/Archive.js";

function cleanContent(content) {
	// trim extra whitespace (dirty workaround for trailing whitespace)
	return content.split("\n").map(line => line.trim()).join("\n");
}

const require = createRequire(import.meta.url);

test("YouTube user", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("youtubeUser", "UCskGTioqrMBcw8pd14_334A");

	let stubContent = fs.readFileSync("./test/sources/youtube-user.xml");
	importer.addDataOverride("youtube", "https://www.youtube.com/feeds/videos.xml?channel_id=UCskGTioqrMBcw8pd14_334A", Fetcher.parseXml(stubContent.toString("utf8")));

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 15);

	let [post] = entries;

	assert.deepEqual(Object.keys(post).sort(), ["authors", "content", "contentType", "date", "dateUpdated", "filePath", "metadata", "outputContentType", "title", "type", "url", "uuid"]);
	assert.equal(post.metadata.media.featuredImage, "https://i4.ytimg.com/vi/kNI_LcbvtNk/hqdefault.jpg");
	assert.equal(post.content.length, 812);
	assert.equal(post.content, `CloudCannon is the Recommended CMS Partner of 11ty:

https://cloudcannon.com/11tyconf/
https://cloudcannon.com/blog/how-to-manage-hundreds-of-connected-websites-with-a-git-based-headless-cms/

This was a talk given at the 11ty International Symposium on Making Web Sites Real Good (2024): https://conf.11ty.dev/2024/managing-content-management/

If Jamstack has taught us anything, it’s that websites work best when they’re generated from folders full of flat files. Even massively interconnected websites!

We talk through a classically Jamstacky approach to content management for large organizations: mounting shared layout and component repositories, creating a central content lake to aggregate content like news articles, and automating site builds and deployments when your content or dependencies change.`);

	assert.equal(post.authors[0].name, "Eleventy");
});

test("Bluesky posts", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("bluesky", "zachleat.com");

	let stubContent = fs.readFileSync("./test/sources/bluesky-test.xml");

	importer.addDataOverride("bluesky", "https://bsky.app/profile/zachleat.com/rss", Fetcher.parseXml(stubContent.toString("utf8")));

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 1);

	let [post] = entries;

	assert.deepEqual(Object.keys(post).sort(), ["authors", "content", "contentType", "date", "filePath", "outputContentType", "title", "type", "url", "uuid"]);
	assert.equal(post.content.length, 323);
	assert.equal(post.content, `time to review my HTML wrapped 2024

Most used: &lt;a&gt;
Doing work to reduce infrastructure bills: &lt;picture&gt;
Underrated: &lt;output&gt;
Misunderstood: &lt;details&gt;
Tame but a small win: &lt;search&gt;
Hope the design never calls for it: &lt;dialog&gt;
Not today Satan: &lt;canvas&gt;
Pure vibes: &lt;noscript&gt;`);

	assert.equal(post.authors[0].name, "@zachleat.com - Zach Leatherman");
});

test("Bluesky self-repost duplicates are deduplicated, issue #7", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("bluesky", "zachleat.com");

	let stubContent = fs.readFileSync("./test/sources/bluesky-test.xml").toString("utf8");
	let item = stubContent.slice(stubContent.indexOf("<item>"), stubContent.indexOf("</item>") + "</item>".length);
	stubContent = stubContent.replace(item, item + item);

	importer.addDataOverride("bluesky", "https://bsky.app/profile/zachleat.com/rss", Fetcher.parseXml(stubContent));

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 1);

	await importer.toFiles(entries);
});

test("WordPress import", async (t) => {

	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpress", "https://blog.fontawesome.com/");

	addWordPressTypes(importer);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 1), require("./sources/blog-awesome-posts.json"));
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 2), []);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("pages", 1), []);

	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/categories/1", require("./sources/blog-awesome-categories.json"));
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/users/155431370", require("./sources/blog-awesome-author.json"));

	importer.addPreserved(".c-button--primary");

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 1);

	let [post] = entries;
	assert.deepEqual(Object.keys(post).sort(), ["authors", "content", "contentType", "date", "dateUpdated", "description", "filePath", "metadata", "outputContentType", "status", "title", "type", "url", "uuid"]);

	assert.equal(cleanContent(post.content), `We’re so close to launching version 6, and we figured it was high time to make an official announcement. So, save the date for February. Font Awesome 6 will go beyond pure icon-imagination!

![](https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2021/12/image-calendar-exclamation-2.png?w=1440&ssl=1)

Save the date! February 2022 is just around the corner!

So, what’s new?

* * *

## More Icons

Font Awesome 6 contains over 7,000 new icons, so you’re sure to find what you need for your project. Plus, we’ve redesigned most of our icons from scratch, so they’re more consistent and easier to use.

![](https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2021/12/image-icons-2.png?w=1440&ssl=1)

* * *

## More Styles

Font Awesome 6 includes five icons styles: solid, regular, light, duotone, and the new THIN style — not to mention all of our brand icons. And coming later in 2022 is the entirely new SHARP family of styles.

![](https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2021/12/image-styles-2.png?w=1440&ssl=1)

* * *

## More Ways to Use

Font Awesome 6 makes it even easier to use icons where you want to. More plugins and packages to match your stack. Less time wrestling browser rendering.

![](https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2021/12/image-awesome-2.png?w=720&ssl=1)

* * *

We’ll keep fine-tuning that sweet, sweet recipe until February. Believe us; the web’s going to have a new scrumpdillyicious secret ingredient!

<a href="https://fontawesome.com/v6.0" class="c-button c-button--primary"><i class="fas fa-arrow-right c-button__icon"></i>Check Out the Beta!</a>`);

	assert.equal(post.content.length, 1634);
	assert.equal(post.authors[0].name, "Matt Johnson");
	assert.equal(post.authors[0].slug, "iamthedayofcurrenttaste");
	assert.equal(post.metadata.id, 3829);
	assert.equal(post.metadata.slug, "font-awesome-6");
	assert.equal(post.description, "We’re so close to launching version 6, and we figured it was high time to make an official announcement. So, save the date for February. Font Awesome 6 will go beyond pure icon-imagination! So, what’s new? More Icons Font Awesome 6 contains over 7,000 new icons, so you’re sure to find what you need for […]");
	assert.equal(post.metadata.media.featuredImage, "https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2021/12/image-save-the-date.png?fit=1920%2C1080&ssl=1");
	assert.equal(post.metadata.media.opengraphImage, "https://blog.fontawesome.com/wp-content/uploads/2021/12/image-save-the-date.png");
});

test("WordPress featured image and description without Jetpack, issue #11", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpress", "https://blog.fontawesome.com/");

	let [post] = require("./sources/blog-awesome-posts.json");
	let { jetpack_featured_media_url, yoast_head_json, ...base } = post;

	let embedded = {
		...base,
		_embedded: {
			"wp:featuredmedia": [{ source_url: "https://blog.fontawesome.com/wp-content/uploads/embedded.png" }],
		},
		excerpt: { rendered: "<p>An <em>excerpt</em> &amp; more&hellip;</p>\n" },
	};
	let yoast = {
		...base,
		guid: { rendered: "https://blog.fontawesome.com/?p=2" },
		link: "https://blog.fontawesome.com/yoast/",
		yoast_head_json: {
			description: "Yoast description",
			og_image: [{ url: "https://blog.fontawesome.com/wp-content/uploads/yoast.png" }],
		},
	};
	let bare = {
		...base,
		guid: { rendered: "https://blog.fontawesome.com/?p=3" },
		link: "https://blog.fontawesome.com/bare/",
		excerpt: { rendered: "" },
	};

	addWordPressTypes(importer);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 1), [embedded, yoast, bare]);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 2), []);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("pages", 1), []);
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/categories/1", require("./sources/blog-awesome-categories.json"));
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/users/155431370", require("./sources/blog-awesome-author.json"));

	let entries = await importer.getEntries({ contentType: "html" });
	assert.equal(entries.length, 3);

	assert.equal(entries[0].metadata.media.featuredImage, "https://blog.fontawesome.com/wp-content/uploads/embedded.png");
	assert.equal(entries[0].metadata.featuredImage, "https://blog.fontawesome.com/wp-content/uploads/embedded.png");
	assert.equal(entries[0].description, "An excerpt & more…");

	assert.deepEqual(entries[1].metadata.media, { featuredImage: "https://blog.fontawesome.com/wp-content/uploads/yoast.png" });
	assert.equal(entries[1].description, "Yoast description");

	assert.equal(entries[2].metadata.media, undefined);
	assert.equal(entries[2].description, undefined);

	assert.match(Importer.convertEntryToYaml(entries[1]), /^description: Yoast description$/m);
});

// Used for API discovery
function addWordPressTypes(importer, types = {}) {
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/types/", {
		post: { slug: "post", rest_base: "posts" },
		page: { slug: "page", rest_base: "pages" },
		...types,
	});
}

function getWordPressPagedUrl(restBase, pageNumber) {
	let status = process.env.WORDPRESS_USERNAME ? "&status=publish%2Cdraft" : "";
	return `https://blog.fontawesome.com/wp-json/wp/v2/${restBase}/?page=${pageNumber}&per_page=100&_embed=author%2Cwp%3Afeaturedmedia%2Cwp%3Aterm${status}`;
}

test("WordPress pages and custom post types, issue #17", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpress", {
		url: "https://blog.fontawesome.com/",
		postTypes: "posts,page,product",
	});

	let [post] = require("./sources/blog-awesome-posts.json");
	let page = {
		...post,
		id: 1,
		type: "page",
		guid: { rendered: "https://blog.fontawesome.com/?page_id=1" },
		link: "https://blog.fontawesome.com/about/",
		slug: "about",
		title: { rendered: "About" },
		content: { rendered: "<p>About page</p>" },
		categories: undefined,
		tags: undefined,
	};
	let product = {
		...page,
		id: 2,
		type: "product",
		guid: { rendered: "https://blog.fontawesome.com/?post_type=product&p=2" },
		link: "https://blog.fontawesome.com/product/icons/",
		slug: "icons",
		title: { rendered: "Icons" },
		content: undefined,
	};

	addWordPressTypes(importer, {
		product: { slug: "product", rest_base: "products" },
	});
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 1), [post]);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 2), []);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("pages", 1), [page]);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("pages", 2), []);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("products", 1), [product]);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("products", 2), []);
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/categories/1", require("./sources/blog-awesome-categories.json"));
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/users/155431370", require("./sources/blog-awesome-author.json"));

	let entries = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entries.map(entry => entry.metadata.postType), ["post", "page", "product"]);
	assert.deepEqual(entries.map(entry => entry.title), [post.title.rendered, "About", "Icons"]);
	assert.equal(entries[1].metadata.categories, undefined);
	assert.equal(entries[2].content, "");
});

function getWordPressPostWithTerms() {
	let [post] = require("./sources/blog-awesome-posts.json");
	return {
		...post,
		categories: [5, 7, 1],
		tags: [9],
		_embedded: {
			...post._embedded,
			"wp:term": [
				[
					{ id: 5, taxonomy: "category", name: "News" },
					{ id: 7, taxonomy: "category", name: "General" },
					{ id: 1, taxonomy: "category", name: "Sin categoría" },
				],
				[{ id: 9, taxonomy: "post_tag", name: "CSS" }],
			],
		},
	};
}

test("WordPress embedded terms are used without extra requests", async (t) => {
	withEnv(t, { WORDPRESS_USERNAME: undefined, WORDPRESS_PASSWORD: undefined });

	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpress", { url: "https://blog.fontawesome.com/", postTypes: "posts" });

	// No term (or settings) overrides: requests would fail
	addWordPressTypes(importer);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 1), [getWordPressPostWithTerms()]);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 2), []);
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/users/155431370", require("./sources/blog-awesome-author.json"));

	let [entry] = await importer.getEntries({ contentType: "html" });
	// Default category (ID 1) is ignored even when renamed or translated
	assert.deepEqual(entry.metadata.categories, ["News", "General"]);
	assert.deepEqual(entry.metadata.tags, ["CSS"]);
	assert.equal(importer.getCounts().errors, 0);
});

test("WordPress default category comes from settings when authenticated", async (t) => {
	withEnv(t, { WORDPRESS_USERNAME: "user", WORDPRESS_PASSWORD: "pass" });

	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpress", { url: "https://blog.fontawesome.com/", postTypes: "posts" });

	addWordPressTypes(importer);
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/settings/", { default_category: 7 });
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 1), [getWordPressPostWithTerms()]);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 2), []);
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/users/155431370", require("./sources/blog-awesome-author.json"));

	let [entry] = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entry.metadata.categories, ["News", "Sin categoría"]);
});

function withEnv(t, env) {
	let previous = {};
	for(let [key, value] of Object.entries(env)) {
		previous[key] = process.env[key];
		if(value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}

	t.after(() => {
		for(let [key, value] of Object.entries(previous)) {
			if(value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});
}

function getWordPressDotComPost() {
	let [post] = require("./sources/blog-awesome-posts.json");
	return {
		...post,
		guid: { rendered: "https://example.com/?p=1" },
		link: "https://example.com/2025/06/hello/",
		categories: [],
		tags: [],
		author: 1,
		_embedded: {
			author: [{ name: "Zach", slug: "zach", link: "https://example.com/author/zach/", avatar_urls: { "96": "https://example.com/avatar.png" } }],
		},
	};
}

test("WordPress API discovery falls back to WordPress.com, issue #16", async (t) => {
	withEnv(t, { WORDPRESSDOTCOM_TOKEN: undefined });

	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	// Site’s own API isn’t stubbed (unavailable)
	importer.addSource("wordpress", {
		url: "https://example.com/",
		postTypes: "posts",
	});

	let getUrl = pageNumber => `https://public-api.wordpress.com/wp/v2/sites/example.com/posts/?page=${pageNumber}&per_page=100&_embed=author%2Cwp%3Afeaturedmedia%2Cwp%3Aterm`;
	importer.addDataOverride("wordpress", "https://public-api.wordpress.com/wp/v2/sites/example.com/types/", { post: { rest_base: "posts" } });
	importer.addDataOverride("wordpress", getUrl(1), [getWordPressDotComPost()]);
	importer.addDataOverride("wordpress", getUrl(2), []);

	let entries = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entries.map(entry => entry.url), ["https://example.com/2025/06/hello/"]);
	// Embedded, the WordPress.com users endpoint requires auth
	// Author pages on the site are root-relative
	assert.deepEqual(entries[0].authors, [{ name: "Zach", url: "/author/zach/", avatarUrl: "https://example.com/avatar.png", slug: "zach" }]);
	assert.deepEqual(importer.getSources()[0].getHeaders(), {});
	assert.equal(importer.getCounts().errors, 0);
});

test("WordPress API discovery prefers WordPress.com with a token (for drafts)", async (t) => {
	withEnv(t, { WORDPRESSDOTCOM_TOKEN: "test-token" });

	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpress", {
		url: "https://example.com/",
		postTypes: "posts",
	});

	let getUrl = pageNumber => `https://public-api.wordpress.com/wp/v2/sites/example.com/posts/?page=${pageNumber}&per_page=100&_embed=author%2Cwp%3Afeaturedmedia%2Cwp%3Aterm&status=publish%2Cdraft`;
	// Would be used without a token
	importer.addDataOverride("wordpress", "https://example.com/wp-json/wp/v2/types/", { post: { rest_base: "posts" } });
	importer.addDataOverride("wordpress", "https://public-api.wordpress.com/wp/v2/sites/example.com/types/", { post: { rest_base: "posts" } });
	importer.addDataOverride("wordpress", getUrl(1), [{ ...getWordPressDotComPost(), status: "draft" }]);
	importer.addDataOverride("wordpress", getUrl(2), []);

	let [entry] = await importer.getEntries({ contentType: "html" });
	assert.equal(entry.status, "draft");
	assert.equal(importer.getSources()[0].getHeaders().Authorization, "Bearer test-token");
});

test("WordPress API discovery supports sites without pretty permalinks", async (t) => {
	withEnv(t, { WORDPRESSDOTCOM_TOKEN: undefined });

	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpress", {
		url: "https://example.com/blog",
		postTypes: "posts",
	});

	let getUrl = pageNumber => `https://example.com/blog/?rest_route=/wp/v2/posts/&page=${pageNumber}&per_page=100&_embed=author%2Cwp%3Afeaturedmedia%2Cwp%3Aterm`;
	importer.addDataOverride("wordpress", "https://example.com/blog/?rest_route=/wp/v2/types/", { post: { rest_base: "posts" } });
	importer.addDataOverride("wordpress", getUrl(1), [getWordPressDotComPost()]);
	importer.addDataOverride("wordpress", getUrl(2), []);

	let entries = await importer.getEntries({ contentType: "html" });
	assert.equal(entries.length, 1);
});

test("WordPress API discovery throws when no API is found", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("wordpress", "https://example.com/");
	importer.addDataOverride("wordpress", "https://example.com/unused", {});

	await assert.rejects(importer.getEntries({ contentType: "html" }), {
		message: "Could not find a WordPress REST API for https://example.com/",
	});
});

test("Author avatars are downloaded as assets", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	let author = { name: "Zach", url: "https://example.com/about/", avatarUrl: "https://example.com/avatar.png" };

	class MySource extends DataSource {
		static TYPE = "arbitrary";

		getData() {
			return [{
				url: "https://example.com/one/",
				content: "One",
				contentType: "text",
				authors: [author],
			}, {
				url: "https://example.com/two/",
				content: "Two",
				contentType: "text",
				authors: [author, { name: "No avatar" }],
			}];
		}
	}

	importer.addSource(MySource);
	importer.fetcher.fetchAsset = async (url, entry) => `assets/${new URL(url).pathname.slice(1)}`;

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.deepEqual(entries.map(entry => entry.authors), [
		// URLs are unchanged for sources that aren’t whole sites
		[{ name: "Zach", url: "https://example.com/about/", avatarUrl: "assets/avatar.png" }],
		[{ name: "Zach", url: "https://example.com/about/", avatarUrl: "assets/avatar.png" }, { name: "No avatar" }],
	]);
	// shared author objects aren’t mutated
	assert.equal(author.avatarUrl, "https://example.com/avatar.png");
});

function getLinkTransformer() {
	let transformer = new HtmlTransformer();
	let fetched = [];
	transformer.setFetcher({
		async fetchAsset(url) {
			fetched.push(url);
			return `assets/${new URL(url).pathname.split("/").pop()}`;
		},
	});
	return { transformer, fetched };
}

test("WordPress links to the site are root-relative and uploads are downloaded", async (t) => {
	let { transformer, fetched } = getLinkTransformer();
	let entry = {
		url: "https://example.com/blog/2025/06/hello/",
		source: new WordPressApi("https://example.com/blog/"),
	};

	let html = await transformer.transform([
		`<a href="https://example.com/blog/2020/01/post/#comments">Internal</a>`,
		`<a href="http://www.example.com/blog/about/">www and http</a>`,
		`<a href="https://example.com/blog/?p=123">Query string</a>`,
		`<a href="https://example.com/shop/">Outside the site</a>`,
		`<a href="https://other.com/blog/">External</a>`,
		`<a href="#top">Fragment</a>`,
		`<a href="mailto:hi@example.com">Email</a>`,
		`<a href="https://example.com/blog/wp-content/uploads/2020/01/doc.pdf">Upload</a>`,
		`<a href="/blog/wp-content/uploads/2020/01/full.jpg"><img src="https://cdn.example.com/small.jpg?w=300&amp;ssl=1"></a>`,
	].join("\n"), entry);

	assert.equal(html, [
		`<a href="/blog/2020/01/post/#comments">Internal</a>`,
		`<a href="/blog/about/">www and http</a>`,
		`<a href="https://example.com/blog/?p=123">Query string</a>`,
		`<a href="https://example.com/shop/">Outside the site</a>`,
		`<a href="https://other.com/blog/">External</a>`,
		`<a href="#top">Fragment</a>`,
		`<a href="mailto:hi@example.com">Email</a>`,
		`<a href="assets/doc.pdf">Upload</a>`,
		`<a href="assets/full.jpg"><img src="assets/small.jpg"></a>`,
	].join("\n"));

	assert.deepEqual(fetched, [
		"https://example.com/blog/wp-content/uploads/2020/01/doc.pdf",
		"https://example.com/blog/wp-content/uploads/2020/01/full.jpg",
		// HTML entities are decoded
		"https://cdn.example.com/small.jpg?w=300&ssl=1",
	]);
});

test("Links are unchanged for sources that aren’t whole sites", async (t) => {
	let { transformer, fetched } = getLinkTransformer();
	let entry = {
		url: "https://example.com/post/",
		source: new DataSource(),
	};

	let input = `<a href="https://example.com/about/">Internal</a><a href="https://example.com/wp-content/uploads/doc.pdf">Upload</a>`;
	assert.equal(await transformer.transform(input, entry), input);
	assert.deepEqual(fetched, []);
});

test("Markdown cleanup keeps srcset assets that are linked", async (t) => {
	let md = new MarkdownToHtml();
	md.setVerbose(false);

	let markdown = await md.toMarkdown(`<a href="assets/big.jpg"><img src="assets/small.jpg" srcset="assets/big.jpg 1024w, assets/small.jpg 300w, assets/medium.jpg 600w"></a>`, {
		filePath: "post/index.md",
	});

	assert.equal(markdown, "[![](assets/medium.jpg)](assets/big.jpg)");
	assert.deepEqual(Array.from(md.assetsToDelete), ["post/assets/small.jpg"]);
});

test("postTypes is not supported by other source types", async (t) => {
	let importer = new Importer();

	assert.throws(() => {
		importer.addSource("rss", { url: "https://example.com/feed.xml", postTypes: "pages" });
	});
});

test("Buttondown alias uses the RSS source", async (t) => {
	let importer = new Importer();
	importer.setVerbose(false);

	importer.addSource("buttondown", "zachleat");
	importer.addSource("Buttondown", "@zachleat");
	importer.addSource("buttondown", "https://newsletter.example.com");
	importer.addSource("buttondown", { url: "https://buttondown.com/zachleat/rss" });

	let sources = importer.getSources();
	assert.ok(sources.every(source => source instanceof Rss));
	assert.deepEqual(sources.map(source => source.getUrl()), [
		"https://buttondown.com/zachleat/rss",
		"https://buttondown.com/zachleat/rss",
		"https://newsletter.example.com/rss",
		"https://buttondown.com/zachleat/rss",
	]);
});

test("addSource using DataSource", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	class MySource extends DataSource {
		static TYPE = "arbitrary";
		static TYPE_FRIENDLY = "Arbitrary";

		getData() {
			return [{
				lol: "hi",
				url: "https://example.com/test/"
			}];
		}
	}

	importer.addSource(MySource);

	let entries = await importer.getEntries();
	assert.equal(entries.length, 1);
});

test("addSource needs to use DataSource", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	assert.throws(() => {
		importer.addSource(class MySource {});
	}, {
		message: "MySource is not a supported type for addSource(). Requires a string type or a DataSource class."
	})
});

test("Persist parseTarget", async (t) => {
	assert.deepEqual(Persist.parseTarget("github:11ty/eleventy"), {
		type: "github",
		username: "11ty",
		repository: "eleventy",
		branch: undefined,
	});

	assert.deepEqual(Persist.parseTarget("github:11ty/eleventy#main"), {
		type: "github",
		username: "11ty",
		repository: "eleventy",
		branch: "main",
	});
});

test("Persist constructor (no token)", async (t) => {
	let p = new Persist();

	assert.throws(() => p.setTarget("gitlab:11ty/eleventy"), {
		// message: "Invalid persist type: gitlab"
		message: "Missing GITHUB_TOKEN environment variable."
	});
});

test("Persist constructor (gitlab)", async (t) => {
	let p = new Persist();
	process.env.GITHUB_TOKEN = "FAKE_TOKEN";

	assert.throws(() => p.setTarget("gitlab:11ty/eleventy"), {
		message: "Invalid persist type: gitlab"
	});
});

test("Fetcher asset location tests (relative)", async (t) => {
	let f = new Fetcher();

	let relative1 = f.getAssetLocation("https://example.com/test.png", "image/png", { filePath: "/test.html" });
	assert.deepEqual(relative1, {
		filePath: "assets/test-NzhbK6MSYu2g.png",
		url: "assets/test-NzhbK6MSYu2g.png",
	});

	let relativeNoExt = f.getAssetLocation("https://example.com/test", "image/png", { filePath: "/test.html" });
	assert.deepEqual(relativeNoExt, {
		filePath: "assets/test-m4HI5oTdgEt4.png",
		url: "assets/test-m4HI5oTdgEt4.png",
	});

	let relative2 = f.getAssetLocation("https://example.com/subdir/test.png", "image/png", { filePath: "localsubdirectory/test.html" });
	assert.deepEqual(relative2, {
		filePath: "localsubdirectory/assets/test-slaK8pecO8QR.png",
		url: "assets/test-slaK8pecO8QR.png",
	});
});

test("Fetcher asset location tests (absolute)", async (t) => {
	let f = new Fetcher();
	f.setUseRelativeAssetPaths(false);

	let abs1 = f.getAssetLocation("https://example.com/test.png", "image/png");
	assert.deepEqual(abs1, {
		filePath: "assets/test-NzhbK6MSYu2g.png",
		url: "/assets/test-NzhbK6MSYu2g.png",
	});
});


test("Markdown cleanup code blocks strip tags", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	let content = await importer.getTransformedContent({
		content: `<pre id=\"b088\" class=\"graf graf--pre graf-after--p\">$ npm config set “<a class=\"markup--anchor markup--pre-anchor\" title=\"Twitter profile for @fortawesome\" href=\"http://twitter.com/fortawesome\" target=\"_blank\" rel=\"noopener noreferrer\" data-href=\"http://twitter.com/fortawesome\">@fortawesome</a>:registry” <a class=\"markup--anchor markup--pre-anchor\" href=\"https://npm.fontawesome.com/\" target=\"_blank\" rel=\"nofollow noopener noreferrer\" data-href=\"https://npm.fontawesome.com/\">https://npm.fontawesome.com/</a></pre>`,
		contentType: "html"
	}, true);

	assert.equal(content.trim(), "```\n$ npm config set “@fortawesome:registry” https://npm.fontawesome.com/\n```");
});

test("Markdown cleanup code blocks with nested <code>", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	let content2 = await importer.getTransformedContent({
		content: `<pre id=\"9da4\" class=\"graf graf--pre graf-after--p\">Authorization: Bearer <code>DEAD-BEEF</code></pre>`,
		contentType: "html"
	}, true);

	assert.equal(content2.trim(), "```\nAuthorization: Bearer DEAD-BEEF\n```");
});

const INSTAGRAM_EMBED = `<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/BqXyz/"><div><a href="https://www.instagram.com/p/BqXyz/">View this post on Instagram</a></div></blockquote>`;

test("Instagram embeds are kept as HTML with a single script, issue #20", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	let content = await importer.getTransformedContent({
		content: `<p>Before</p>\n${INSTAGRAM_EMBED}\n<script async src="//www.instagram.com/embed.js"></script>\n<p>Middle</p>\n${INSTAGRAM_EMBED}\n<script async src="//www.instagram.com/embed.js"></script>\n<p>After</p>`,
		contentType: "html"
	}, true);

	assert.equal(content.trim(), `Before\n\n${INSTAGRAM_EMBED}\n<script async src="https://www.instagram.com/embed.js"></script>\n\nMiddle\n\n${INSTAGRAM_EMBED}\n\nAfter`);
});

test("Embeds can be added and removed", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.removeEmbed("instagram");
	importer.addEmbed("my-embed", { selector: ".my-embed", script: "https://example.com/embed.js" });
	importer.addEmbed("no-script-embed", { selector: ".no-script-embed" });

	assert.throws(() => importer.addEmbed("bad", { selector: "blockquote" }));
	assert.throws(() => importer.addEmbed("", { selector: ".bad" }));

	let content = await importer.getTransformedContent({
		content: `${INSTAGRAM_EMBED}<div class="my-embed"><p>Hi</p></div><div class="no-script-embed"><p>Hello</p></div>`,
		contentType: "html"
	}, true);

	assert.equal(content.trim(), `> [View this post on Instagram](https://www.instagram.com/p/BqXyz/)\n\n<div class="my-embed"><p>Hi</p></div>\n<script async src="https://example.com/embed.js"></script>\n\n<div class="no-script-embed"><p>Hello</p></div>`);
});

test("Embeds can be converted to links", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.addEmbed("instagram", { output: "link" });
	importer.addEmbed("twitter", { output: "link" });
	importer.addEmbed("tiktok", { output: "link" });

	assert.throws(() => importer.addEmbed("bluesky", { output: "iframe" }));

	let content = await importer.getTransformedContent({
		content: `${INSTAGRAM_EMBED}
<script async src="//www.instagram.com/embed.js"></script>
<blockquote class="twitter-tweet"><p>Hello</p>&mdash; Eleventy (@eleven_ty) <a href="https://twitter.com/eleven_ty/status/123">January 1, 2024</a></blockquote>
<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@user/video/456"><section><a href="https://www.tiktok.com/@user">@user</a></section></blockquote>
<blockquote class="bluesky-embed"><p>Bluesky</p></blockquote>`,
		contentType: "html"
	}, true);

	assert.equal(content.trim(), `<https://www.instagram.com/p/BqXyz/>\n\n<https://twitter.com/eleven_ty/status/123>\n\n<https://www.tiktok.com/@user/video/456>\n\n<blockquote class="bluesky-embed"><p>Bluesky</p></blockquote>\n<script async src="https://embed.bsky.app/static/embed.js"></script>`);
});

test("within yes", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	class MySource extends DataSource {
		static TYPE = "arbitrary";
		static TYPE_FRIENDLY = "Arbitrary";

		getRawEntryDates(rawEntry) {
			return {
				created: rawEntry.date,
			}
		}

		getData() {
			return [{
				lol: "hi",
				url: "https://example.com/test/",
				date: new Date(),
			}];
		}
	}

	importer.addSource(MySource);

	let entries = await importer.getEntries({
		within: "1m"
	});
	assert.equal(entries.length, 1);
});

test("within no", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	class MySource extends DataSource {
		static TYPE = "arbitrary";
		static TYPE_FRIENDLY = "Arbitrary";

		getRawEntryDates(rawEntry) {
			return {
				created: rawEntry.date,
			}
		}

		getData() {
			return [{
				lol: "hi",
				url: "https://example.com/test/",
				date: new Date(2010, 0,1),
			}];
		}
	}

	importer.addSource(MySource);

	let entries = await importer.getEntries({
		within: "1m"
	});
	assert.equal(entries.length, 0);
});

test("dateUpdated strings are parsed from dateUpdated, not date", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	class MySource extends DataSource {
		static TYPE = "arbitrary";
		static TYPE_FRIENDLY = "Arbitrary";

		getData() {
			return [{
				url: "https://example.com/test/",
				date: "2020-01-01T00:00:00Z",
				dateUpdated: "2021-06-15T00:00:00Z",
			}];
		}
	}

	importer.addSource(MySource);

	let [entry] = await importer.getEntries();
	assert.equal(entry.dateUpdated.toISOString(), "2021-06-15T00:00:00.000Z");
});

test("Atom multiple authors and content without a type attribute", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("atom", "https://example.com/feed.xml");
	importer.addDataOverride("atom", "https://example.com/feed.xml", Fetcher.parseXml(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<entry>
		<id>https://example.com/post/</id>
		<title>Post</title>
		<updated>2024-01-01T00:00:00Z</updated>
		<author><name>Author One</name></author>
		<author><name>Author Two</name></author>
		<content>Plain content</content>
	</entry>
</feed>`));

	let [entry] = await importer.getEntries();
	assert.deepEqual(entry.authors, [{ name: "Author One" }, { name: "Author Two" }]);
	assert.equal(entry.content, "Plain content");
	assert.equal(entry.contentType, undefined);
});

test("RSS guid without attributes", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("rss", "https://example.com/feed.xml");
	importer.addDataOverride("rss", "https://example.com/feed.xml", Fetcher.parseXml(`<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
	<channel>
		<title>Example</title>
		<link>https://example.com/</link>
		<item>
			<title>With guid</title>
			<link>https://example.com/one/</link>
			<guid>https://example.com/one/</guid>
			<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
			<description>One</description>
		</item>
		<item>
			<title>Without guid</title>
			<link>https://example.com/two/</link>
			<pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
			<description>Two</description>
		</item>
	</channel>
</rss>`));

	let entries = await importer.getEntries();
	assert.deepEqual(entries.map(entry => entry.uuid), [
		"11ty/import::rss::https://example.com/two/",
		"11ty/import::rss::https://example.com/one/",
	]);
});

test("RSS audio enclosures and media:content", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("rss", "https://example.com/feed.xml");
	importer.addDataOverride("rss", "https://example.com/feed.xml", Fetcher.parseXml(`<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
	<channel>
		<title>Example</title>
		<link>https://example.com/</link>
		<item>
			<title>Episode</title>
			<link>https://example.com/episode/</link>
			<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
			<description>Episode</description>
			<enclosure url="https://example.com/episode.mp3" length="1234" type="audio/mpeg"/>
			<enclosure url="https://example.com/episode.pdf" length="1234" type="application/pdf"/>
			<media:content url="https://example.com/clip.ogg" type="audio/ogg"/>
			<media:content url="https://example.com/photo.png" type="image/png" medium="image"/>
		</item>
	</channel>
</rss>`));

	let [entry] = await importer.getEntries();
	assert.equal(entry.content, `Episode
<audio controls src="https://example.com/clip.ogg"></audio>
<img src="https://example.com/photo.png" alt="">
<audio controls src="https://example.com/episode.mp3"></audio>`);
});

test("RSS video, image enclosures, media:group, and thumbnails", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("rss", "https://example.com/feed.xml");
	importer.addDataOverride("rss", "https://example.com/feed.xml", Fetcher.parseXml(`<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
	<channel>
		<title>Example</title>
		<link>https://example.com/</link>
		<item>
			<title>Post</title>
			<link>https://example.com/post/</link>
			<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
			<media:thumbnail url="https://example.com/thumb.jpg"/>
			<media:content url="https://example.com/clip.mp4" type="video/mp4" medium="video"/>
			<media:content url="https://example.com/old.swf" type="application/x-shockwave-flash"/>
			<media:group>
				<media:content url="https://example.com/low.mp4" type="video/mp4"/>
				<media:content url="https://example.com/high.mp4" type="video/mp4" isDefault="true"/>
			</media:group>
			<enclosure url="https://example.com/photo.jpg" length="1234" type="image/jpeg"/>
			<enclosure url="https://example.com/movie.webm" length="1234" type="video/webm"/>
		</item>
	</channel>
</rss>`));

	let [entry] = await importer.getEntries();
	assert.equal(entry.metadata.media.featuredImage, "https://example.com/thumb.jpg");
	assert.equal(entry.content, `<video controls src="https://example.com/clip.mp4" poster="https://example.com/thumb.jpg"></video>
<video controls src="https://example.com/high.mp4" poster="https://example.com/thumb.jpg"></video>
<img src="https://example.com/photo.jpg" alt="">
<video controls src="https://example.com/movie.webm"></video>`);
});

test("Atom enclosures and Media RSS", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("atom", "https://example.com/feed.atom");
	importer.addDataOverride("atom", "https://example.com/feed.atom", Fetcher.parseXml(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
	<title>Example</title>
	<author><name>Author</name></author>
	<entry>
		<id>tag:example.com,2024:html</id>
		<title>HTML</title>
		<link rel="alternate" href="https://example.com/html/"/>
		<link rel="enclosure" href="https://example.com/episode.mp3" type="audio/mpeg"/>
		<published>2024-01-02T00:00:00Z</published>
		<content type="html">&lt;p&gt;Hello&lt;/p&gt;</content>
		<media:content url="https://example.com/photo.png" type="image/png"><media:description>A photo</media:description></media:content>
	</entry>
	<entry>
		<id>tag:example.com,2024:text</id>
		<title>Text</title>
		<link rel="enclosure" href="https://example.com/episode.mp3" type="audio/mpeg"/>
		<published>2024-01-01T00:00:00Z</published>
		<content type="text">Hello</content>
	</entry>
</feed>`));

	let [html, text] = await importer.getEntries();
	assert.equal(html.url, "https://example.com/html/");
	assert.equal(html.content, `<p>Hello</p>
<img src="https://example.com/photo.png" alt="A photo">
<audio controls="" src="https://example.com/episode.mp3"></audio>`);
	assert.equal(text.content, "Hello");
});

test("Documents that fail to process are counted as errors", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	class MySource extends DataSource {
		static TYPE = "arbitrary";
		static TYPE_FRIENDLY = "Arbitrary";

		getData() {
			return [{
				url: "https://example.com/test/",
				// missing content throws during Markdown conversion
				contentType: "text",
			}];
		}
	}

	importer.addSource(MySource);

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 0);
	assert.equal(importer.getCounts().errors, 1);
});

test("Titles have HTML entities decoded", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	class MySource extends DataSource {
		static TYPE = "arbitrary";
		static TYPE_FRIENDLY = "Arbitrary";

		getData() {
			return [{
				url: "https://example.com/test/",
				title: "Don&#8217;t &amp; Caf&eacute; &lt;3",
			}];
		}
	}

	importer.addSource(MySource);

	let [entry] = await importer.getEntries();
	assert.equal(entry.title, "Don’t & Café <3");
});

test("File paths use forward slashes on every platform", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setOutputFolder("dist");
	importer.setAssetReferenceType("colocate");

	class MySource extends DataSource {
		static TYPE = "arbitrary";
		static TYPE_FRIENDLY = "Arbitrary";

		getData() {
			return [{
				url: "https://example.com/posts/test/",
			}, {
				url: "https://example.com/posts/draft/",
				status: "draft",
			}];
		}
	}

	importer.addSource(MySource);
	importer.addSource(MySource, {
		filepathFormat: () => "custom/path/file.md"
	});

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.deepEqual(entries.map(entry => entry.filePath).sort(), [
		"dist/custom/path/file.md",
		"dist/custom/path/file.md",
		"dist/drafts/posts/draft/index.html",
		"dist/posts/test/index.html",
	]);

	assert.equal(importer.markdownService.recontextifyRelativeAssetPath("assets/image.png", "dist/posts/test/index.md"), "dist/posts/test/assets/image.png");
});

test("WordPress XML export", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpressxml", "./test/sources/wordpress-export.xml");

	let entries = await importer.getEntries({ contentType: "html" });
	// Sorted by date, newest first
	assert.deepEqual(entries.map(entry => entry.title), ["Classic", "Block & Editor", "About"]);

	let [draft, post, page] = entries;
	assert.equal(post.uuid, "11ty/import::wordpress::https://example.com/?p=10");
	assert.equal(post.content, "<p>Hello <strong>world</strong>.</p>");
	assert.deepEqual(post.authors, [{ name: "Zach Leatherman", slug: "zachleat" }]);
	assert.equal(post.date.toISOString(), "2024-01-02T08:04:05.000Z");
	assert.equal(post.dateUpdated.toISOString(), "2024-02-02T08:04:05.000Z");
	assert.equal(post.description, "A short excerpt.");
	assert.deepEqual(post.tags, ["News & Notes"]);
	assert.deepEqual(post.metadata.tags, ["Eleventy"]);
	assert.equal(post.metadata.id, 10);
	assert.equal(post.metadata.slug, "block-editor");
	assert.equal(post.metadata.media.featuredImage, "https://example.com/wp-content/uploads/2024/01/header.png");
	assert.equal(post.filePath, "block-editor.html");

	assert.equal(draft.status, "draft");
	assert.equal(draft.date.toISOString(), "2024-03-01T00:00:00.000Z");
	assert.equal(draft.content, "<p>First paragraph<br>\nstill first.</p>\n<p>Second paragraph.</p>");
	assert.equal(draft.metadata.slug, undefined);

	assert.equal(page.metadata.postType, "page");

	let postsOnly = new Importer();
	postsOnly.setVerbose(false);
	postsOnly.setDryRun(true);
	postsOnly.addSource("wordpressxml", { url: "./test/sources/wordpress-export.xml", postTypes: "posts" });
	assert.equal((await postsOnly.getEntries({ contentType: "html" })).length, 2);
});

test("WordPress XML comments", async (t) => {
	let withoutComments = new Importer();
	withoutComments.setVerbose(false);
	withoutComments.setDryRun(true);
	withoutComments.addSource("wordpressxml", { url: "./test/sources/wordpress-export.xml", comments: false });
	assert.ok((await withoutComments.getEntries({ contentType: "html" })).every(entry => !entry.comments));

	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");
	importer.addSource("wordpressxml", "./test/sources/wordpress-export.xml");

	let [draft, post] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(draft.comments, undefined);

	// Spam, pending, and pingbacks are skipped, sorted oldest first
	assert.deepEqual(post.comments, [
		{
			id: 2,
			parentId: 0,
			author: { name: "Jane & Co", url: "https://jane.example/" },
			date: new Date("2024-01-03T09:00:00.000Z"),
			content: "<p>Great post!</p>\n<p>Second line.</p>",
		},
		{
			id: 3,
			parentId: 2,
			author: { name: "Zach Leatherman" },
			date: new Date("2024-01-03T10:00:00.000Z"),
			content: "<p>Thanks!</p>",
		},
	]);

	assert.equal(Importer.getCommentsFilePath(post.filePath), "block-editor.json");
	assert.equal(Importer.getCommentsFilePath("dist/posts/test/index.md"), "dist/posts/test/index.json");

	let json = Importer.convertCommentsToJson(post);
	assert.equal(JSON.parse(json).comments[1].date, "2024-01-03T10:00:00.000Z");
	assert.ok(!json.includes("@example.com"));
	assert.ok(!json.includes("192.0.2.1"));
});

test("WordPress API comments are requested in bulk", async (t) => {
	withEnv(t, { WORDPRESS_USERNAME: undefined, WORDPRESS_PASSWORD: undefined });

	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");
	importer.addSource("wordpress", { url: "https://blog.fontawesome.com/", postTypes: "posts" });

	addWordPressTypes(importer);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 1), [getWordPressPostWithTerms()]);
	importer.addDataOverride("wordpress", getWordPressPagedUrl("posts", 2), []);
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/users/155431370", require("./sources/blog-awesome-author.json"));
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/comments/?post=3829&page=1&per_page=100&order=asc", [
		{
			id: 7,
			post: 3829,
			parent: 0,
			author_name: "Jane",
			author_url: "https://jane.example/",
			author_avatar_urls: { "24": "https://gravatar.example/24", "96": "https://gravatar.example/96" },
			date_gmt: "2024-01-03T09:00:00",
			content: { rendered: "<p>Great post!</p>\n" },
		},
		// Not an imported post
		{ id: 8, post: 1, parent: 0, author_name: "Other", date_gmt: "2024-01-03T09:00:00", content: { rendered: "" } },
	]);

	let [entry] = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entry.comments, [{
		id: 7,
		parentId: 0,
		author: { name: "Jane", url: "https://jane.example/", avatarUrl: "https://gravatar.example/96" },
		date: new Date("2024-01-03T09:00:00.000Z"),
		content: "<p>Great post!</p>\n",
	}]);
	assert.equal(importer.getCounts().errors, 0);
});

test("comments is not supported by other source types", async (t) => {
	let importer = new Importer();

	class MySource extends DataSource {
		static TYPE = "arbitrary";
	}

	assert.throws(() => {
		importer.addSource(MySource, { id: "test", comments: true });
	});

	// Disabling is a no-op
	importer.addSource(MySource, { id: "test", comments: false });
});

test("Absolute output folders are kept", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setOutputFolder("/var/output");
	importer.setAssetReferenceType("disabled");

	class MySource extends DataSource {
		static TYPE = "arbitrary";
		static TYPE_FRIENDLY = "Arbitrary";

		getData() {
			return [{ url: "https://example.com/posts/test/" }, { url: "https://example.com/posts/draft/", status: "draft" }];
		}
	}

	importer.addSource(MySource);

	let entries = await importer.getEntries();
	assert.deepEqual(entries.map(entry => entry.filePath).sort(), ["/var/output/drafts/posts/draft.html", "/var/output/posts/test.html"]);
});

function getCommentsImporter(type, options) {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");
	importer.addSource(type, options);
	return importer;
}

test("RSS comment feeds (wfw:commentRss)", async (t) => {
	let feed = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
	<channel>
		<title>Example</title>
		<link>https://example.com/</link>
		<item>
			<title>One</title>
			<link>https://example.com/one/</link>
			<guid>https://example.com/?p=1</guid>
			<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
			<description>One</description>
			<wfw:commentRss>https://example.com/one/feed/</wfw:commentRss>
		</item>
	</channel>
</rss>`;

	let importer = getCommentsImporter("rss", "https://example.com/feed.xml");
	importer.addDataOverride("rss", "https://example.com/feed.xml", Fetcher.parseXml(feed));
	importer.addDataOverride("rss", "https://example.com/one/feed/", Fetcher.parseXml(`<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
	<channel>
		<item>
			<title>By: Jane</title>
			<link>https://example.com/one/#comment-6</link>
			<dc:creator><![CDATA[Jane]]></dc:creator>
			<pubDate>Wed, 03 Jan 2024 00:00:00 GMT</pubDate>
			<guid isPermaLink="false">https://example.com/?p=1#comment-6</guid>
			<content:encoded><![CDATA[<p>Second</p>]]></content:encoded>
		</item>
		<item>
			<title>By: Zach</title>
			<link>https://example.com/one/#comment-5</link>
			<dc:creator><![CDATA[Zach]]></dc:creator>
			<pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
			<guid isPermaLink="false">https://example.com/?p=1#comment-5</guid>
			<description><![CDATA[First]]></description>
		</item>
	</channel>
</rss>`));

	let [entry] = await importer.getEntries();
	assert.deepEqual(entry.comments, [{
		id: "https://example.com/?p=1#comment-5",
		parentId: 0,
		url: "https://example.com/one/#comment-5",
		author: { name: "Zach" },
		date: new Date("2024-01-02T00:00:00.000Z"),
		content: "First",
	}, {
		id: "https://example.com/?p=1#comment-6",
		parentId: 0,
		url: "https://example.com/one/#comment-6",
		author: { name: "Jane" },
		date: new Date("2024-01-03T00:00:00.000Z"),
		content: "<p>Second</p>",
	}]);

	// Disabled: the comment feed isn’t requested
	let disabled = getCommentsImporter("rss", { url: "https://example.com/feed.xml", comments: false });
	disabled.addDataOverride("rss", "https://example.com/feed.xml", Fetcher.parseXml(feed));
	let [disabledEntry] = await disabled.getEntries();
	assert.equal(disabledEntry.comments, undefined);
});

test("Atom comment feeds (RFC 4685 replies)", async (t) => {
	let importer = getCommentsImporter("atom", "https://example.com/feed.xml");
	importer.addDataOverride("atom", "https://example.com/feed.xml", Fetcher.parseXml(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<title>Example</title>
	<entry>
		<id>https://example.com/one/</id>
		<title>One</title>
		<published>2024-01-01T00:00:00Z</published>
		<content type="html">One</content>
		<link rel="replies" type="application/atom+xml" href="https://example.com/one/comments.xml"/>
	</entry>
</feed>`));
	importer.addDataOverride("atom", "https://example.com/one/comments.xml", Fetcher.parseXml(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:thr="http://purl.org/syndication/thread/1.0">
	<entry>
		<id>tag:example.com,2024:2</id>
		<author><name>Zach</name></author>
		<published>2024-01-03T00:00:00Z</published>
		<content>Thanks &amp; more
on a new line</content>
		<thr:in-reply-to ref="tag:example.com,2024:1"/>
	</entry>
	<entry>
		<id>tag:example.com,2024:1</id>
		<author><name>Jane</name><uri>https://jane.example/</uri></author>
		<published>2024-01-02T00:00:00Z</published>
		<link rel="alternate" href="https://example.com/one/#c1"/>
		<content type="html">&lt;p&gt;Great&lt;/p&gt;</content>
		<thr:in-reply-to ref="https://example.com/one/"/>
	</entry>
</feed>`));

	let [entry] = await importer.getEntries();
	assert.deepEqual(entry.comments, [{
		id: "tag:example.com,2024:1",
		parentId: 0,
		url: "https://example.com/one/#c1",
		author: { name: "Jane", url: "https://jane.example/" },
		date: new Date("2024-01-02T00:00:00.000Z"),
		content: "<p>Great</p>",
	}, {
		id: "tag:example.com,2024:2",
		parentId: "tag:example.com,2024:1",
		author: { name: "Zach" },
		date: new Date("2024-01-03T00:00:00.000Z"),
		content: "Thanks &amp; more<br>\non a new line",
	}]);
});

test("Bluesky replies", async (t) => {
	let importer = getCommentsImporter("bluesky", "zachleat.com");
	importer.addDataOverride("bluesky", "https://bsky.app/profile/zachleat.com/rss", Fetcher.parseXml(fs.readFileSync("./test/sources/bluesky-test.xml", "utf8")));

	let root = "at://did:plc:xpchjovbk6sxl3bv74z7cs54/app.bsky.feed.post/3lckusgtkuk2r";
	let reply = {
		uri: "at://did:plc:jane/app.bsky.feed.post/aaa",
		author: { handle: "jane.example", displayName: "Jane", avatar: "https://cdn.bsky.app/avatar.jpg" },
		record: { text: "<b>Nice</b>\nlist", createdAt: "2024-12-05T15:00:00.000Z", reply: { parent: { uri: root } } },
	};
	let nested = {
		uri: "at://did:plc:xpchjovbk6sxl3bv74z7cs54/app.bsky.feed.post/bbb",
		author: { handle: "zachleat.com" },
		record: { text: "Thanks", createdAt: "2024-12-05T16:00:00.000Z", reply: { parent: { uri: reply.uri } } },
	};

	let hidden = {
		uri: "at://did:plc:hidden/app.bsky.feed.post/ddd",
		author: { handle: "hidden.example", displayName: "Hidden", labels: [{ val: "!no-unauthenticated" }] },
		record: { text: "Logged-in only", createdAt: "2024-12-05T17:00:00.000Z", reply: { parent: { uri: root } } },
	};

	let labeled = {
		uri: "at://did:plc:labeled/app.bsky.feed.post/eee",
		author: { handle: "labeled.example" },
		labels: [{ val: "graphic-media" }],
		record: { text: "Content warning", createdAt: "2024-12-05T18:00:00.000Z", reply: { parent: { uri: root } } },
	};

	importer.addDataOverride("bluesky", `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(root)}&depth=100&parentHeight=0`, {
		thread: {
			post: { uri: root },
			replies: [
				{ post: reply, replies: [{ post: nested, replies: [] }] },
				{ post: hidden, replies: [] },
				{ post: labeled, replies: [] },
				// Blocked
				{ $type: "app.bsky.feed.defs#blockedPost", uri: "at://did:plc:blocked/app.bsky.feed.post/ccc" },
			],
		},
	});

	let [entry] = await importer.getEntries();
	assert.deepEqual(entry.comments, [{
		id: reply.uri,
		parentId: 0,
		url: "https://bsky.app/profile/jane.example/post/aaa",
		author: { name: "Jane", url: "https://bsky.app/profile/jane.example", avatarUrl: "https://cdn.bsky.app/avatar.jpg" },
		date: new Date("2024-12-05T15:00:00.000Z"),
		content: "&lt;b&gt;Nice&lt;/b&gt;<br>\nlist",
	}, {
		id: nested.uri,
		parentId: reply.uri,
		url: "https://bsky.app/profile/zachleat.com/post/bbb",
		author: { name: "zachleat.com", url: "https://bsky.app/profile/zachleat.com" },
		date: new Date("2024-12-05T16:00:00.000Z"),
		content: "Thanks",
	}, {
		// Links only
		id: hidden.uri,
		parentId: 0,
		url: "https://bsky.app/profile/hidden.example/post/ddd",
		private: true,
		date: new Date("2024-12-05T17:00:00.000Z"),
	}, {
		id: labeled.uri,
		parentId: 0,
		url: "https://bsky.app/profile/labeled.example/post/eee",
		private: true,
		date: new Date("2024-12-05T18:00:00.000Z"),
	}]);
});

test("Fediverse replies", async (t) => {
	let importer = getCommentsImporter("fediverse", "@eleventy@fosstodon.org");
	importer.addDataOverride("fediverse", "https://fosstodon.org/users/eleventy.rss", Fetcher.parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
	<channel>
		<title>Eleventy</title>
		<link>https://fosstodon.org/@eleventy</link>
		<item>
			<guid isPermaLink="true">https://fosstodon.org/@eleventy/111</guid>
			<link>https://fosstodon.org/@eleventy/111</link>
			<pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
			<description>&lt;p&gt;Hello&lt;/p&gt;</description>
		</item>
	</channel>
</rss>`));
	importer.addDataOverride("fediverse", "https://fosstodon.org/api/v1/statuses/111/context", {
		ancestors: [],
		descendants: [{
			id: "222",
			in_reply_to_id: "111",
			url: "https://mastodon.social/@jane/222",
			created_at: "2024-01-02T00:00:00.000Z",
			content: "<p>Hi!</p>",
			account: { display_name: "", acct: "jane@mastodon.social", url: "https://mastodon.social/@jane", avatar: "https://mastodon.social/avatar.png" },
		}, {
			id: "333",
			in_reply_to_id: "222",
			url: "https://fosstodon.org/@eleventy/333",
			created_at: "2024-01-03T00:00:00.000Z",
			content: "<p>Hey</p>",
			spoiler_text: "Spoilers",
			sensitive: true,
			account: { display_name: "Eleventy", acct: "eleventy", url: "https://fosstodon.org/@eleventy" },
		}, {
			id: "444",
			in_reply_to_id: "111",
			visibility: "unlisted",
			url: "https://mastodon.social/@quiet/444",
			created_at: "2024-01-04T00:00:00.000Z",
			content: "<p>Unlisted</p>",
			account: { display_name: "Quiet", acct: "quiet@mastodon.social" },
		}, {
			id: "555",
			in_reply_to_id: "111",
			visibility: "public",
			url: "https://mastodon.social/@noindex/555",
			created_at: "2024-01-05T00:00:00.000Z",
			content: "<p>No index</p>",
			account: { display_name: "No Index", acct: "noindex@mastodon.social", noindex: true },
		}],
	});

	let [entry] = await importer.getEntries();
	let [first, warning, unlisted, noindex] = entry.comments;
	assert.deepEqual([first.id, first.parentId, first.author.name], ["222", 0, "jane@mastodon.social"]);
	assert.equal(first.content, "<p>Hi!</p>");
	assert.equal(first.author.avatarUrl, "https://mastodon.social/avatar.png");

	// Links only
	assert.deepEqual(warning, { id: "333", parentId: "222", url: "https://fosstodon.org/@eleventy/333", private: true, date: new Date("2024-01-03T00:00:00.000Z") });
	assert.deepEqual(unlisted, { id: "444", parentId: 0, url: "https://mastodon.social/@quiet/444", private: true, date: new Date("2024-01-04T00:00:00.000Z") });
	assert.deepEqual(noindex, { id: "555", parentId: 0, url: "https://mastodon.social/@noindex/555", private: true, date: new Date("2024-01-05T00:00:00.000Z") });
});

test("YouTube comments require an API key", async (t) => {
	let feedUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UCskGTioqrMBcw8pd14_334A";
	let feed = Fetcher.parseXml(fs.readFileSync("./test/sources/youtube-user.xml", "utf8"));

	withEnv(t, { YOUTUBE_API_KEY: undefined });
	let withoutKey = getCommentsImporter("youtubeUser", "UCskGTioqrMBcw8pd14_334A");
	withoutKey.addDataOverride("youtube", feedUrl, feed);
	assert.ok((await withoutKey.getEntries()).every(entry => !entry.comments));

	process.env.YOUTUBE_API_KEY = "test-key";
	let importer = getCommentsImporter("youtubeUser", "UCskGTioqrMBcw8pd14_334A");
	importer.addDataOverride("youtube", feedUrl, feed);

	let [source] = importer.getSources();
	assert.deepEqual(source.getHeaders("https://www.googleapis.com/youtube/v3/commentThreads"), { "X-Goog-Api-Key": "test-key" });
	assert.deepEqual(source.getHeaders(feedUrl), {});

	let comment = (id, text, publishedAt, parentId) => ({
		id,
		snippet: { authorDisplayName: "Jane", authorChannelUrl: "http://www.youtube.com/@jane", authorProfileImageUrl: "https://yt3.ggpht.com/jane", textDisplay: text, publishedAt, parentId },
	});

	importer.addDataOverride("youtube", "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet%2Creplies&videoId=kNI_LcbvtNk&maxResults=100&textFormat=html", {
		items: [{
			snippet: { topLevelComment: comment("c1", "Great talk", "2024-12-01T00:00:00Z"), totalReplyCount: 2 },
			replies: { comments: [comment("c1.r1", "Agreed", "2024-12-02T00:00:00Z", "c1")] },
		}],
		nextPageToken: "page2",
	});
	importer.addDataOverride("youtube", "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet%2Creplies&videoId=kNI_LcbvtNk&maxResults=100&textFormat=html&pageToken=page2", {
		items: [{ snippet: { topLevelComment: comment("c2", "Second page", "2024-12-04T00:00:00Z"), totalReplyCount: 0 } }],
	});
	// Thread is missing a reply, so all replies are requested
	importer.addDataOverride("youtube", "https://www.googleapis.com/youtube/v3/comments?part=snippet&parentId=c1&maxResults=100&textFormat=html", {
		items: [comment("c1.r1", "Agreed", "2024-12-02T00:00:00Z", "c1"), comment("c1.r2", "Same", "2024-12-03T00:00:00Z", "c1")],
	});

	// Other videos have no overrides (failed requests are skipped)
	let entries = await importer.getEntries();
	let video = entries.find(entry => entry.url.endsWith("kNI_LcbvtNk"));
	assert.deepEqual(video.comments.map(({ id, parentId }) => [id, parentId]), [["c1", 0], ["c1.r1", "c1"], ["c1.r2", "c1"], ["c2", 0]]);
	assert.deepEqual(video.comments[0], {
		id: "c1",
		parentId: 0,
		url: "https://www.youtube.com/watch?v=kNI_LcbvtNk&lc=c1",
		author: { name: "Jane", url: "http://www.youtube.com/@jane", avatarUrl: "https://yt3.ggpht.com/jane" },
		date: new Date("2024-12-01T00:00:00.000Z"),
		content: "Great talk",
	});
	assert.equal(entries.filter(entry => entry.comments).length, 1);
});

function getSquarespaceItem(id, publishOn, extra = {}) {
	return {
		id,
		publishOn,
		addedOn: publishOn,
		updatedOn: publishOn + 1000,
		urlId: `2026/post-${id}`,
		fullUrl: `/blog/2026/post-${id}`,
		title: `Post ${id} &amp; more`,
		tags: [],
		categories: [],
		body: `<p>Post ${id}</p>`,
		...extra,
	};
}

test("Squarespace collection", async (t) => {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("squarespace", "https://example.com/blog");

	importer.addDataOverride("squarespace", "https://example.com/blog?format=json", {
		collection: { typeName: "blog" },
		// `nextPageUrl` is relative to the collection’s own path, not the requested URL
		pagination: { nextPage: true, nextPageOffset: 1700000000000, nextPageUrl: "/?offset=1700000000000" },
		items: [getSquarespaceItem("a", 1784908800742, {
			title: "Stain the Page",
			author: { displayName: "Hannah Tipperman", avatarAssetUrl: "https://images.squarespace-cdn.com/avatar.png" },
			tags: ["web design"],
			categories: ["Engineering"],
			assetUrl: "https://images.squarespace-cdn.com/content/v1/thumbnail.png",
			contentType: "image/png",
			excerpt: `<p style="white-space:pre-wrap;">An excerpt.</p>`,
			body: [
				`<style>.sqs-block { color: red; }</style>`,
				`<div class="sqs-block-content"><p class="" style="white-space:pre-wrap;">Hello <strong>world</strong>.</p></div>`,
				`<div class="sqs-block-content">&nbsp;</div>`,
				`<p class="">&nbsp;</p>`,
				`<noscript><img src="https://images.squarespace-cdn.com/gallery.png" alt="Gallery"></noscript>`,
				`<img class="thumb-image" data-src="https://images.squarespace-cdn.com/gallery.png" alt="Gallery">`,
			].join("\n\n\n"),
		})],
	});
	importer.addDataOverride("squarespace", "https://example.com/blog?format=json&offset=1700000000000", {
		collection: { typeName: "blog" },
		pagination: { nextPage: false },
		items: [getSquarespaceItem("b", 1600000000000, {
			seoData: { seoDescription: "SEO description" },
			assetUrl: "https://static1.squarespace.com/static/no-image",
		})],
	});

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 2);

	let [post, second] = entries;
	assert.equal(post.uuid, "11ty/import::squarespace::a");
	assert.equal(post.type, "squarespace");
	assert.equal(post.title, "Stain the Page");
	assert.equal(post.url, "https://example.com/blog/2026/post-a");
	assert.equal(post.filePath, "blog/2026/post-a.md");
	assert.deepEqual(post.date, new Date(1784908800742));
	assert.deepEqual(post.dateUpdated, new Date(1784908801742));
	assert.deepEqual(post.authors, [{ name: "Hannah Tipperman", avatarUrl: "https://images.squarespace-cdn.com/avatar.png" }]);
	assert.equal(post.description, "An excerpt.");
	assert.deepEqual(post.tags, ["Engineering"]);
	assert.deepEqual(post.metadata, {
		id: "a",
		postType: "blog",
		slug: "post-a",
		media: { featuredImage: "https://images.squarespace-cdn.com/content/v1/thumbnail.png" },
		categories: ["Engineering"],
		tags: ["web design"],
	});
	assert.equal(post.content, `Hello **world**.\n\n![Gallery](https://images.squarespace-cdn.com/gallery.png)`);

	assert.equal(second.title, "Post b & more");
	assert.equal(second.description, "SEO description");
	assert.equal(second.tags, undefined);
	assert.deepEqual(second.metadata, { id: "b", postType: "blog", slug: "post-b" });
});

test("Squarespace page and single item", async (t) => {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("squarespace", "https://example.com/about");
	importer.addSource("squarespace", "https://example.com/blog/2026/post-c");

	importer.addDataOverride("squarespace", "https://example.com/about?format=json", {
		collection: { id: "page1", typeName: "page", title: "About", fullUrl: "/about", updatedOn: 1757026662102, description: "<p>About us.</p>" },
		mainContent: `<div class="sqs-layout"><h1>About</h1></div>`,
	});
	importer.addDataOverride("squarespace", "https://example.com/blog/2026/post-c?format=json", {
		collection: { typeName: "blog" },
		item: getSquarespaceItem("c", 1700000000000),
	});

	let [page, item] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(page.uuid, "11ty/import::squarespace::page1");
	assert.equal(page.url, "https://example.com/about");
	assert.equal(page.description, "About us.");
	assert.deepEqual(page.date, new Date(1757026662102));
	assert.deepEqual(page.metadata, { id: "page1", postType: "page" });
	assert.equal(page.content, "# About");

	assert.equal(item.url, "https://example.com/blog/2026/post-c");
	assert.equal(item.content, "Post c");
});

test("Squarespace links to the site are root-relative and uploads are downloaded", async (t) => {
	let { transformer, fetched } = getLinkTransformer();
	let entry = {
		url: "https://example.com/blog/2026/hello",
		source: new Squarespace("https://example.com/blog"),
	};

	let html = await transformer.transform([
		`<a href="https://example.com/about">Internal</a>`,
		`<a href="/s/document.pdf">Upload</a>`,
		`<a href="https://static1.squarespace.com/static/file.zip">Static</a>`,
		`<a href="https://other.com/s/file.pdf">External</a>`,
	].join("\n"), entry);

	assert.equal(html, [
		`<a href="/about">Internal</a>`,
		`<a href="assets/document.pdf">Upload</a>`,
		`<a href="assets/file.zip">Static</a>`,
		`<a href="https://other.com/s/file.pdf">External</a>`,
	].join("\n"));

	assert.deepEqual(fetched, [
		"https://example.com/s/document.pdf",
		"https://static1.squarespace.com/static/file.zip",
	]);
});

test("Squarespace comments", async (t) => {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("squarespace", "https://example.com/blog");

	importer.addDataOverride("squarespace", "https://example.com/blog?format=json", {
		collection: { typeName: "blog" },
		pagination: { nextPage: false },
		items: [
			getSquarespaceItem("a", 1700000000000, { publicCommentCount: 3 }),
			// No comments, so none are requested
			getSquarespaceItem("b", 1600000000000, { publicCommentCount: 0 }),
		],
	});

	let comment = (id, addedOn, extra = {}) => ({ id, authorName: `Author ${id}`, ancestors: [], status: 1, cleared: false, addedOn, body: `<p>Comment ${id}</p>`, ...extra });
	importer.addDataOverride("squarespace", "https://example.com/api/comment/GetComments?targetId=a&targetType=1&page=1", {
		comments: [
			comment("c2", 1700000002000, { ancestors: ["c1"], depth: 1 }),
			comment("c1", 1700000001000),
			comment("spam", 1700000003000, { status: 2 }),
		],
		totalComments: 4,
	});
	importer.addDataOverride("squarespace", "https://example.com/api/comment/GetComments?targetId=a&targetType=1&page=2", {
		comments: [comment("c3", 1700000004000)],
		totalComments: 4,
	});

	let [post, second] = await importer.getEntries();
	assert.deepEqual(post.comments, [
		{ id: "c1", parentId: 0, author: { name: "Author c1" }, date: new Date(1700000001000), content: "<p>Comment c1</p>" },
		{ id: "c2", parentId: "c1", author: { name: "Author c2" }, date: new Date(1700000002000), content: "<p>Comment c2</p>" },
		{ id: "c3", parentId: 0, author: { name: "Author c3" }, date: new Date(1700000004000), content: "<p>Comment c3</p>" },
	]);
	assert.equal(second.comments, undefined);
});

// Folder fixture is extracted from the zip (`node --test` would run its `.js` files)
const TWITTER_ZIP = "./test/sources/twitter-archive.zip";
const TWITTER_FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), "eleventy-import-twitter-"));
let twitterZip = await Archive.open(TWITTER_ZIP);
for(let file of await twitterZip.list()) {
	let target = path.join(TWITTER_FOLDER, file);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, await twitterZip.read(file));
}

for(let archivePath of [TWITTER_FOLDER, TWITTER_ZIP]) {
	test(`Twitter archive (${archivePath})`, async (t) => {
		let importer = new Importer();
		importer.setVerbose(false);
		importer.setDryRun(true);
		importer.setAssetReferenceType("disabled");

		importer.addSource("twitter", archivePath);

		let entries = await importer.getEntries({ contentType: "markdown" });
		// Retweets and replies to others are skipped
		assert.deepEqual(entries.map(entry => entry.metadata.id), ["2006", "2003", "2002", "2001"]);

		let [part1, reply, media, text] = entries;
		assert.equal(part1.filePath, "zachleat/2006.md");
		assert.equal(part1.content, "From the second part");

		assert.equal(reply.metadata.inReplyTo, "https://x.com/zachleat/status/2002");
		assert.equal(reply.content, "Continuing the thread");

		assert.equal(text.uuid, "11ty/import::twitter::2001");
		assert.equal(text.type, "twitter");
		assert.equal(text.url, "https://x.com/zachleat/status/2001");
		assert.deepEqual(text.date, new Date("2018-10-10T20:19:24.000Z"));
		assert.deepEqual(text.authors, [{ name: "Zach Leatherman", url: "https://x.com/zachleat", avatarUrl: "https://pbs.twimg.com/profile_images/1/avatar.jpg" }]);
		assert.equal(text.content, `Eleventy & friends with [@eleven\\_ty](https://x.com/eleven_ty) and @nobody, read [11ty.dev/docs/?a=1&b=2](https://www.11ty.dev/docs/?a=1&b=2) (email me@zachleat)`);

		assert.equal(media.content, [
			`A photo and a video  `,
			`Second line`,
			``,
			`![A &quot;photo&quot;](https://pbs.twimg.com/media/Photo1.jpg)`,
			``,
			// Archived video variant is preferred over the highest bitrate
			`<video controls="" src="https://video.twimg.com/ext_tw_video/3/pu/vid/640x360/Small.mp4?tag=10" poster="https://pbs.twimg.com/ext_tw_video_thumb/3/pu/img/Poster.jpg"></video>`,
		].join("\n"));
	});

	test(`Twitter archive local media (${archivePath})`, async (t) => {
		let importer = new Importer();
		importer.setVerbose(false);
		importer.setDryRun(true);
		importer.setAssetReferenceType("relative");

		importer.addSource("twitter", archivePath);

		let [source] = importer.getSources();
		let [entry] = await source.getEntries();

		assert.deepEqual(await source.getLocalAsset("https://pbs.twimg.com/media/Photo1.jpg"), { body: Buffer.from("photo-bytes") });
		assert.equal(await source.getLocalAsset("https://pbs.twimg.com/media/Missing.jpg"), undefined);

		// Copied from the archive instead of fetched
		assert.match(await importer.fetcher.fetchAsset("https://pbs.twimg.com/media/Photo1.jpg", entry), /^assets\/Photo1-\w+\.jpg$/);
		assert.match(await importer.fetcher.fetchAsset("https://video.twimg.com/ext_tw_video/3/pu/vid/640x360/Small.mp4?tag=10", entry), /^assets\/Small-\w+\.mp4$/);
		assert.match(await importer.fetcher.fetchAsset("https://pbs.twimg.com/profile_images/1/avatar.jpg", entry), /^assets\/avatar-\w+\.jpg$/);
	});
}

function getImporter() {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");
	return importer;
}

test("Substack", async (t) => {
	let importer = getImporter();
	importer.addSource("substack", "example");

	let archivePost = (id, slug, extra = {}) => ({ id, slug, post_date: "2026-10-01T12:00:00.000Z", comment_count: 0, ...extra });
	importer.addDataOverride("substack", "https://example.substack.com/api/v1/archive?sort=new&offset=0&limit=25", [
		archivePost(1, "first", { comment_count: 2 }),
		archivePost(2, "paid"),
	]);
	// Shorter pages are offset by the number of posts returned
	importer.addDataOverride("substack", "https://example.substack.com/api/v1/archive?sort=new&offset=2&limit=25", []);

	importer.addDataOverride("substack", "https://example.substack.com/api/v1/posts/first", {
		id: 1,
		slug: "first",
		type: "newsletter",
		audience: "everyone",
		title: "First &amp; best",
		subtitle: "A subtitle",
		canonical_url: "https://example.substack.com/p/first",
		post_date: "2026-10-01T12:00:00.000Z",
		updated_at: "2026-10-02T12:00:00.000Z",
		cover_image: "https://substack-post-media.s3.amazonaws.com/cover.png",
		postTags: [{ name: "Career" }],
		publishedBylines: [{ name: "Jane", handle: "jane", photo_url: "https://substackcdn.com/jane.png" }],
		body_html: `<p>Hello <a href="https://example.substack.com/p/paid">world</a>.</p>`,
		comment_count: 2,
	});
	importer.addDataOverride("substack", "https://example.substack.com/api/v1/posts/paid", {
		id: 2,
		slug: "paid",
		type: "podcast",
		audience: "only_paid",
		title: "Paid",
		canonical_url: "https://example.substack.com/p/paid",
		post_date: "2026-09-01T12:00:00.000Z",
		podcast_url: "https://api.substack.com/episode.mp3",
		body_html: "<p>Preview</p>",
	});
	importer.addDataOverride("substack", "https://example.substack.com/api/v1/post/1/comments?all_comments=true&sort=oldest_first", {
		comments: [{
			id: 10, ancestor_path: "", status: "published", deleted: false, name: "Commenter", handle: "commenter", date: "2026-10-01T13:00:00.000Z", body: "Nice\npost",
			children: [
				{ id: 11, ancestor_path: "10", status: "published", deleted: false, name: "Jane", date: "2026-10-01T14:00:00.000Z", body: "Thanks", children: [] },
				{ id: 12, ancestor_path: "10", status: "published", deleted: true, date: "2026-10-01T15:00:00.000Z", body: null, children: [] },
			],
		}],
	});

	let [post, paid] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(post.uuid, "11ty/import::substack::1");
	assert.equal(post.title, "First & best");
	assert.equal(post.url, "https://example.substack.com/p/first");
	assert.equal(post.filePath, "p/first.md");
	assert.equal(post.description, "A subtitle");
	assert.deepEqual(post.dateUpdated, new Date("2026-10-02T12:00:00.000Z"));
	assert.deepEqual(post.authors, [{ name: "Jane", url: "https://substack.com/@jane", avatarUrl: "https://substackcdn.com/jane.png" }]);
	assert.deepEqual(post.tags, ["Career"]);
	assert.deepEqual(post.metadata, {
		id: 1,
		slug: "first",
		postType: "newsletter",
		media: { featuredImage: "https://substack-post-media.s3.amazonaws.com/cover.png" },
		tags: ["Career"],
	});
	// Links to the publication are root-relative
	assert.equal(post.content, "Hello [world](/p/paid).");
	assert.deepEqual(post.comments, [
		{ id: 10, parentId: 0, url: "https://example.substack.com/p/first/comment/10", author: { name: "Commenter", url: "https://substack.com/@commenter" }, date: new Date("2026-10-01T13:00:00.000Z"), content: "Nice<br>\npost" },
		{ id: 11, parentId: 10, url: "https://example.substack.com/p/first/comment/11", author: { name: "Jane" }, date: new Date("2026-10-01T14:00:00.000Z"), content: "Thanks" },
	]);

	assert.equal(paid.metadata.audience, "only_paid");
	assert.equal(paid.metadata.postType, "podcast");
	assert.equal(paid.content, `Preview\n\n<audio controls="" src="https://api.substack.com/episode.mp3"></audio>`);
	assert.equal(paid.comments, undefined);
});

test("Ghost", async (t) => {
	let importer = getImporter();
	importer.addSource("ghost", "https://example.com/");

	// Key is discovered from the search script
	importer.addDataOverride("ghost", "https://example.com/", `<script src="https://cdn.jsdelivr.net/sodo-search.min.js" data-key="abc123" data-api="https://example.ghost.io/ghost/api/content/"></script>`);

	let api = "https://example.ghost.io/ghost/api/content/";
	let query = "&include=tags,authors&formats=html";
	let post = (id, extra = {}) => ({
		id,
		slug: `post-${id}`,
		title: `Post ${id}`,
		url: `https://example.com/post-${id}/`,
		html: `<p>Post ${id}</p>`,
		visibility: "public",
		published_at: "2026-10-01T12:00:00.000-04:00",
		updated_at: "2026-10-02T12:00:00.000-04:00",
		tags: [],
		authors: [],
		...extra,
	});

	importer.addDataOverride("ghost", `${api}posts/?key=abc123&limit=100&page=1${query}`, {
		posts: [post("a", {
			feature_image: "https://example.com/content/images/feature.jpg",
			custom_excerpt: "An excerpt",
			visibility: "paid",
			tags: [{ name: "News", visibility: "public" }, { name: "#internal", visibility: "internal" }],
			authors: [{ name: "Jane", url: "https://example.com/author/jane/", profile_image: "https://example.com/content/images/jane.jpg" }],
		})],
		meta: { pagination: { next: 2 } },
	});
	importer.addDataOverride("ghost", `${api}posts/?key=abc123&limit=100&page=2${query}`, {
		posts: [post("b", { published_at: "2026-09-01T12:00:00.000-04:00", meta_description: "Meta description" })],
		meta: { pagination: { next: null } },
	});
	importer.addDataOverride("ghost", `${api}pages/?key=abc123&limit=100&page=1${query}`, {
		pages: [post("about", { published_at: "2026-01-01T12:00:00.000-04:00" })],
		meta: { pagination: { next: null } },
	});

	importer.addDataOverride("ghost", "https://example.com/members/api/comments/counts/?ids=a,b,about", { a: 3, b: 0, about: 0 });
	let comment = (id, extra = {}) => ({ id, status: "published", html: `<p>${id}</p>`, created_at: "2026-10-01T18:00:00.000Z", member: { name: `Member ${id}`, avatar_image: null }, replies: [], count: { replies: 0 }, ...extra });
	importer.addDataOverride("ghost", "https://example.com/members/api/comments/post/a/?limit=100&page=1&order=created_at%20asc", {
		// Threads only include some replies
		comments: [comment("c1", { replies: [comment("r1", { parent_id: "c1" })], count: { replies: 2 } })],
		meta: { pagination: { next: null } },
	});
	importer.addDataOverride("ghost", "https://example.com/members/api/comments/c1/replies/?limit=100&page=1&order=created_at%20asc", {
		comments: [
			comment("r1", { parent_id: "c1", created_at: "2026-10-01T19:00:00.000Z" }),
			comment("r2", { parent_id: "c1", in_reply_to_id: "r1", created_at: "2026-10-01T20:00:00.000Z" }),
		],
		meta: { pagination: { next: null } },
	});

	let [a, b, about] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(a.uuid, "11ty/import::ghost::a");
	assert.equal(a.filePath, "post-a.md");
	assert.equal(a.description, "An excerpt");
	assert.deepEqual(a.tags, ["News"]);
	assert.deepEqual(a.authors, [{ name: "Jane", url: "/author/jane/", avatarUrl: "https://example.com/content/images/jane.jpg" }]);
	assert.deepEqual(a.metadata, {
		id: "a",
		slug: "post-a",
		postType: "post",
		visibility: "paid",
		media: { featuredImage: "https://example.com/content/images/feature.jpg" },
		tags: ["News"],
	});
	assert.deepEqual(a.comments.map(({ id, parentId }) => ({ id, parentId })), [
		{ id: "c1", parentId: 0 },
		{ id: "r1", parentId: "c1" },
		{ id: "r2", parentId: "r1" },
	]);

	assert.equal(b.description, "Meta description");
	assert.equal(b.comments, undefined);

	assert.equal(about.metadata.postType, "page");
	assert.equal(about.content, "Post about");
});

test("Ghost requires a Content API key", async (t) => {
	let importer = getImporter();
	importer.addSource("ghost", "https://example.com/");
	importer.addDataOverride("ghost", "https://example.com/", "<html></html>");

	await assert.rejects(importer.getEntries(), /GHOST_CONTENT_API_KEY/);
});

test("JSON Feed", async (t) => {
	let importer = getImporter();
	importer.addSource("jsonfeed", "https://example.com/feed.json");

	importer.addDataOverride("jsonfeed", "https://example.com/feed.json", {
		version: "https://jsonfeed.org/version/1.1",
		title: "Example",
		authors: [{ name: "Feed Author", url: "https://example.com/" }],
		next_url: "https://example.com/feed.json?page=2",
		items: [{
			id: "1",
			url: "https://example.com/posts/one/",
			title: "One",
			content_html: "<p>Hello <em>world</em></p>",
			summary: "A summary",
			image: "https://example.com/one.jpg",
			date_published: "2026-10-01T12:00:00Z",
			date_modified: "2026-10-02T12:00:00Z",
			tags: ["web"],
			authors: [{ name: "Jane", url: "https://jane.example/", avatar: "https://jane.example/avatar.png" }],
			attachments: [{ url: "https://example.com/one.mp3", mime_type: "audio/mpeg" }],
		}],
	});
	importer.addDataOverride("jsonfeed", "https://example.com/feed.json?page=2", {
		version: "https://jsonfeed.org/version/1",
		author: { name: "Feed Author", url: "https://example.com/" },
		items: [{
			id: "2",
			url: "https://example.com/posts/two/",
			content_text: "Plain text",
			date_published: "2026-09-01T12:00:00Z",
		}],
	});

	let [one, two] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(one.uuid, "11ty/import::jsonfeed::1");
	assert.equal(one.filePath, "posts/one.md");
	assert.equal(one.description, "A summary");
	assert.deepEqual(one.tags, ["web"]);
	assert.deepEqual(one.dateUpdated, new Date("2026-10-02T12:00:00Z"));
	assert.deepEqual(one.authors, [{ name: "Jane", url: "https://jane.example/", avatarUrl: "https://jane.example/avatar.png" }]);
	assert.deepEqual(one.metadata, { media: { featuredImage: "https://example.com/one.jpg" } });
	assert.equal(one.content, `Hello _world_\n\n<audio controls="" src="https://example.com/one.mp3"></audio>`);

	assert.equal(two.contentType, "text");
	assert.equal(two.content, "Plain text");
	// Feed `author` (1.0) is the fallback
	assert.deepEqual(two.authors, [{ name: "Feed Author", url: "https://example.com/" }]);
});

test("Blogger", async (t) => {
	let importer = getImporter();
	importer.addSource("blogger", "https://example.blogspot.com/");

	let entry = (id, extra = {}) => ({
		id: { $t: `tag:blogger.com,1999:blog-1.post-${id}` },
		published: { $t: "2026-10-01T12:00:00.000-07:00" },
		updated: { $t: "2026-10-02T12:00:00.000-07:00" },
		title: { type: "text", $t: `Post ${id}` },
		content: { type: "html", $t: `<p>Post ${id}</p>` },
		link: [{ rel: "alternate", type: "text/html", href: `https://example.blogspot.com/2026/10/post-${id}.html` }],
		author: [{ name: { $t: "Unknown" }, gd$image: { src: "https://img1.blogblog.com/img/b16-rounded.gif" } }],
		...extra,
	});

	importer.addDataOverride("blogger", "https://example.blogspot.com/feeds/posts/default?alt=json&max-results=150&start-index=1", {
		feed: {
			openSearch$totalResults: { $t: "1" },
			entry: [entry("100", {
				category: [{ term: "news" }],
				media$thumbnail: { url: "https://blogger.googleusercontent.com/img/b/abc/s72-c/photo.jpg" },
				thr$total: { $t: "2" },
				link: [
					{ rel: "replies", type: "application/atom+xml", href: "https://example.blogspot.com/feeds/100/comments/default" },
					{ rel: "alternate", type: "text/html", href: "https://example.blogspot.com/2026/10/post-100.html" },
				],
				author: [{ name: { $t: "Jane" }, uri: { $t: "https://www.blogger.com/profile/1" }, gd$image: { src: "//blogger.googleusercontent.com/jane.png" } }],
			})],
		},
	});
	importer.addDataOverride("blogger", "https://example.blogspot.com/feeds/pages/default?alt=json&max-results=150&start-index=1", {
		feed: {
			openSearch$totalResults: { $t: "1" },
			entry: [entry("200", { published: { $t: "2026-01-01T12:00:00.000-07:00" } })],
		},
	});
	importer.addDataOverride("blogger", "https://example.blogspot.com/feeds/100/comments/default?alt=json&max-results=150&start-index=1", {
		feed: {
			openSearch$totalResults: { $t: "2" },
			entry: [
				entry("301", {
					published: { $t: "2026-10-01T14:00:00.000-07:00" },
					content: { type: "html", $t: "Reply" },
					link: [
						{ rel: "alternate", type: "text/html", href: "https://example.blogspot.com/2026/10/post-100.html?showComment=2#c301" },
						{ rel: "related", type: "application/atom+xml", href: "https://www.blogger.com/feeds/1/100/comments/default/300" },
					],
				}),
				entry("300", {
					published: { $t: "2026-10-01T13:00:00.000-07:00" },
					content: { type: "html", $t: "Comment" },
					link: [{ rel: "alternate", type: "text/html", href: "https://example.blogspot.com/2026/10/post-100.html?showComment=1#c300" }],
				}),
			],
		},
	});

	let [post, page] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(post.uuid, "11ty/import::blogger::100");
	assert.equal(post.url, "https://example.blogspot.com/2026/10/post-100.html");
	assert.equal(post.filePath, "2026/10/post-100.md");
	assert.deepEqual(post.tags, ["news"]);
	assert.deepEqual(post.authors, [{ name: "Jane", url: "https://www.blogger.com/profile/1", avatarUrl: "https://blogger.googleusercontent.com/jane.png" }]);
	assert.deepEqual(post.metadata, {
		id: "100",
		postType: "post",
		media: { featuredImage: "https://blogger.googleusercontent.com/img/b/abc/s1600/photo.jpg" },
		tags: ["news"],
	});
	assert.deepEqual(post.comments, [
		{ id: "300", parentId: 0, url: "https://example.blogspot.com/2026/10/post-100.html?showComment=1#c300", author: { name: "Unknown" }, date: new Date("2026-10-01T20:00:00.000Z"), content: "Comment" },
		{ id: "301", parentId: "300", url: "https://example.blogspot.com/2026/10/post-100.html?showComment=2#c301", author: { name: "Unknown" }, date: new Date("2026-10-01T21:00:00.000Z"), content: "Reply" },
	]);

	assert.equal(page.metadata.postType, "page");
	assert.deepEqual(page.authors, [{ name: "Unknown" }]);
	assert.equal(page.comments, undefined);
});

test("DEV", async (t) => {
	let importer = getImporter();
	importer.addSource("devto", "@jane");

	let user = { name: "Jane", username: "jane", profile_image: "https://media2.dev.to/jane.png", profile_image_90: "https://media2.dev.to/jane-90.png" };
	importer.addDataOverride("devto", "https://dev.to/api/articles?username=jane&per_page=100&page=1", [
		{ id: 1, comments_count: 1, published_at: "2026-10-01T12:00:00Z" },
	]);
	importer.addDataOverride("devto", "https://dev.to/api/articles?username=jane&per_page=100&page=2", []);
	importer.addDataOverride("devto", "https://dev.to/api/articles/1", {
		id: 1,
		slug: "hello-1abc",
		title: "Hello",
		description: "A description",
		url: "https://dev.to/jane/hello-1abc",
		canonical_url: "https://jane.example/hello/",
		cover_image: "https://media2.dev.to/cover.png",
		published_at: "2026-10-01T12:00:00Z",
		edited_at: "2026-10-03T12:00:00Z",
		// Article details have a string `tag_list` and an array of `tags`
		tag_list: "webdev, css",
		tags: ["webdev", "css"],
		body_html: `<p>Hello <a href="https://dev.to/jane/other">other</a></p>`,
		user,
	});
	importer.addDataOverride("devto", "https://dev.to/api/comments?a_id=1", [{
		id_code: "c1", created_at: "2026-10-01T13:00:00Z", body_html: "<p>Comment</p>", user,
		children: [
			{ id_code: "c2", created_at: "2026-10-01T14:00:00Z", body_html: "<p>Reply</p>", user, children: [] },
			{ id_code: "c3", created_at: "2026-10-01T15:00:00Z", body_html: "<p>[deleted]</p>", children: [] },
		],
	}]);

	let [post] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(post.uuid, "11ty/import::devto::1");
	assert.equal(post.filePath, "jane/hello-1abc.md");
	assert.equal(post.description, "A description");
	assert.deepEqual(post.dateUpdated, new Date("2026-10-03T12:00:00Z"));
	assert.deepEqual(post.tags, ["webdev", "css"]);
	assert.deepEqual(post.authors, [{ name: "Jane", url: "https://dev.to/jane", avatarUrl: "https://media2.dev.to/jane.png" }]);
	assert.deepEqual(post.metadata, {
		id: 1,
		slug: "hello-1abc",
		media: { featuredImage: "https://media2.dev.to/cover.png" },
		canonicalUrl: "https://jane.example/hello/",
		tags: ["webdev", "css"],
	});
	// Links to DEV stay absolute
	assert.equal(post.content, "Hello [other](https://dev.to/jane/other)");
	assert.deepEqual(post.comments.map(({ id, parentId, author }) => ({ id, parentId, avatarUrl: author.avatarUrl })), [
		{ id: "c1", parentId: 0, avatarUrl: "https://media2.dev.to/jane-90.png" },
		{ id: "c2", parentId: "c1", avatarUrl: "https://media2.dev.to/jane-90.png" },
	]);
});

test("Medium export", async (t) => {
	let importer = getImporter();
	importer.addSource("medium", "./test/sources/medium");

	let [post, draft] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(post.uuid, "11ty/import::medium::0123456789ab");
	assert.equal(post.title, "Hello & World");
	assert.equal(post.description, "A subtitle & more");
	assert.equal(post.url, "https://medium.com/@zachleat/hello-world-0123456789ab");
	assert.equal(post.filePath, "@zachleat/hello-world-0123456789ab.md");
	assert.equal(post.status, "publish");
	assert.deepEqual(post.date, new Date("2024-01-15T18:30:00.000Z"));
	assert.deepEqual(post.authors, [{ name: "Zach Leatherman", url: "https://medium.com/@zachleat" }]);
	assert.deepEqual(post.metadata, { id: "0123456789ab" });
	// The title and subtitle repeated in the body are removed
	assert.equal(post.content, "* * *\n\nFirst **paragraph**.\n\n![](https://cdn-images-1.medium.com/max/800/1*abc.png)");

	assert.equal(draft.uuid, "11ty/import::medium::ba9876543210");
	assert.equal(draft.status, "draft");
	assert.equal(draft.url, "https://medium.com/p/ba9876543210");
	assert.equal(draft.filePath, "drafts/p/ba9876543210.md");
	assert.deepEqual(draft.authors, []);
	assert.equal(draft.content, "Draft text.");
});
