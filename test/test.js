import test from 'node:test';
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { Importer } from "../src/Importer.js";
import { DataSource } from "../src/DataSource.js";
import { Fetcher } from "../src/Fetcher.js";
import { HtmlTransformer } from "../src/HtmlTransformer.js";
import { MarkdownToHtml } from "../src/MarkdownToHtml.js";
import { WordPressApi } from "../src/DataSource/WordPressApi.js";
import { Squarespace } from "../src/DataSource/Squarespace.js";
import { Rss } from "../src/DataSource/Rss.js";
import { BlueskyUser } from "../src/DataSource/BlueskyUser.js";
import { FediverseUser } from "../src/DataSource/FediverseUser.js";
import { Npm } from "../src/DataSource/Npm.js";
import { GitHub } from "../src/DataSource/GitHub.js";
import { GitHubGist } from "../src/DataSource/GitHubGist.js";
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

	assert.deepEqual(Object.keys(post).sort(), ["authors", "content", "contentType", "counts", "date", "dateUpdated", "filePath", "metadata", "outputContentType", "title", "type", "url", "uuid"]);
	assert.deepEqual(post.counts, { likes: 13, views: 598 });
	assert.equal(post.metadata.media.featuredImage, "https://i4.ytimg.com/vi/kNI_LcbvtNk/hqdefault.jpg");
	assert.equal(post.metadata.slug, "kNI_LcbvtNk");
	assert.equal(post.contentType, "markdown");
	assert.ok(!post.content.includes("<iframe"));
	assert.ok(post.content.includes(`CloudCannon is the Recommended CMS Partner of 11ty:

[https://cloudcannon.com/11tyconf/](https://cloudcannon.com/11tyconf/)  
[https://cloudcannon.com/blog/how-to-manage-hundreds-of-connected-websites-with-a-git-based-headless-cms/](https://cloudcannon.com/blog/how-to-manage-hundreds-of-connected-websites-with-a-git-based-headless-cms/)

This was a talk given at the 11ty International Symposium on Making Web Sites Real Good (2024): [https://conf.11ty.dev/2024/managing-content-management/](https://conf.11ty.dev/2024/managing-content-management/)`));

	assert.equal(post.authors[0].name, "Eleventy");
});

test("Linkify plain text", async (t) => {
	assert.equal(DataSource.linkify("See https://example.com/a?b=1&c=2. Or (https://example.com/x)! <b>"), `See <a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a>. Or (<a href="https://example.com/x">https://example.com/x</a>)! &lt;b&gt;`);
	assert.equal(DataSource.textToParagraphs("One\nhttps://example.com\n\n\nTwo"), `<p>One<br>\n<a href="https://example.com">https://example.com</a></p>\n<p>Two</p>`);
});

const BLUESKY_FEED_URL = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=zachleat.com&filter=posts_and_author_threads&limit=100";

function getBlueskyFeed() {
	return JSON.parse(fs.readFileSync("./test/sources/bluesky-feed.json", "utf8"));
}

test("Bluesky posts", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("bluesky", "zachleat.com");

	importer.addDataOverride("bluesky", BLUESKY_FEED_URL, getBlueskyFeed());

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 1);

	let [post] = entries;

	assert.deepEqual(Object.keys(post).sort(), ["authors", "content", "contentType", "date", "filePath", "metadata", "outputContentType", "title", "type", "url", "uuid"]);
	assert.equal(post.uuid, "11ty/import::rss::at://did:plc:xpchjovbk6sxl3bv74z7cs54/app.bsky.feed.post/3lckusgtkuk2r");
	assert.equal(post.metadata.slug, post.url.split("/").pop());
	assert.equal(post.content, `time to review my HTML wrapped 2024

Most used: \\<a>  
Doing work to reduce infrastructure bills: \\<picture>  
Underrated: \\<output>  
Misunderstood: \\<details>  
Tame but a small win: \\<search>  
Hope the design never calls for it: \\<dialog>  
Not today Satan: \\<canvas>  
Pure vibes: \\<noscript>`);

	assert.equal(post.authors[0].name, "Zach Leatherman");
	assert.equal(post.authors[0].url, "https://bsky.app/profile/zachleat.com");
});

test("Bluesky self-repost duplicates are deduplicated, issue #7", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("bluesky", "zachleat.com");

	let feed = getBlueskyFeed();
	feed.feed.push({ ...feed.feed[0], reason: { $type: "app.bsky.feed.defs#reasonRepost" } });
	importer.addDataOverride("bluesky", BLUESKY_FEED_URL, feed);

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 1);

	await importer.toFiles(entries);
});

test("Skip content (front matter only)", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.addSource("bluesky", { url: "zachleat.com", content: false });

	importer.addDataOverride("bluesky", BLUESKY_FEED_URL, getBlueskyFeed());

	let [post] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(post.content, "");
	assert.equal(post.url, "https://bsky.app/profile/zachleat.com/post/3lckusgtkuk2r");
	assert.equal(post.authors[0].name, "Zach Leatherman");
});

test("Bluesky rich text, embeds, and paging past reposts", async (t) => {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");
	importer.addSource("bluesky", { url: "@zachleat.com", comments: false });

	let did = "did:plc:xpchjovbk6sxl3bv74z7cs54";
	let author = { did, handle: "zachleat.com", displayName: "Zach Leatherman" };
	let other = { did: "did:plc:jane", handle: "jane.example", displayName: "Jane" };
	let hidden = { did: "did:plc:hidden", handle: "hidden.example", labels: [{ val: "!no-unauthenticated" }] };

	importer.addDataOverride("bluesky", BLUESKY_FEED_URL, {
		cursor: "page2",
		feed: [{ reason: { $type: "app.bsky.feed.defs#reasonRepost" }, post: { uri: "at://did:plc:jane/app.bsky.feed.post/r", author: other, record: { text: "Repost", createdAt: "2024-12-06T00:00:00.000Z" } } }],
	});
	importer.addDataOverride("bluesky", `${BLUESKY_FEED_URL}&cursor=page2`, {
		feed: [{
			post: {
				uri: `at://${did}/app.bsky.feed.post/one`,
				author,
				record: {
					text: "Hi @jane.example 🎉 #11ty example.com/long...",
					createdAt: "2024-12-05T00:00:00.000Z",
					facets: [
						{ index: { byteStart: 3, byteEnd: 16 }, features: [{ $type: "app.bsky.richtext.facet#mention", did: "did:plc:jane" }] },
						{ index: { byteStart: 22, byteEnd: 27 }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: "11ty" }] },
						{ index: { byteStart: 28, byteEnd: 47 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com/long/url" }] },
					],
				},
				embed: {
					$type: "app.bsky.embed.recordWithMedia#view",
					media: { $type: "app.bsky.embed.images#view", images: [{ fullsize: "https://cdn.bsky.app/img/a@jpeg", alt: "Alt" }] },
					record: { record: {
						$type: "app.bsky.embed.record#viewRecord",
						uri: "at://did:plc:jane/app.bsky.feed.post/quoted",
						author: other,
						value: { text: "Quoted <b>", createdAt: "2024-12-04T00:00:00.000Z" },
						embeds: [{ $type: "app.bsky.embed.record#view", record: { $type: "app.bsky.embed.record#viewRecord", uri: "at://did:plc:x/app.bsky.feed.post/nested", author: { handle: "x.example" } } }],
					} },
				},
			},
		}, {
			post: {
				uri: `at://${did}/app.bsky.feed.post/two`,
				author,
				record: { text: "Video", createdAt: "2024-12-04T00:00:00.000Z" },
				embed: { $type: "app.bsky.embed.video#view", cid: "vid", thumbnail: "https://video.bsky.app/thumb.jpg" },
			},
		}, {
			post: {
				uri: `at://${did}/app.bsky.feed.post/three`,
				author,
				record: { text: "", createdAt: "2024-12-03T00:00:00.000Z" },
				embed: { $type: "app.bsky.embed.record#view", record: { $type: "app.bsky.embed.record#viewRecord", uri: "at://did:plc:hidden/app.bsky.feed.post/h", author: hidden, value: { text: "Hidden" } } },
			},
		}, {
			post: {
				uri: `at://${did}/app.bsky.feed.post/four`,
				author,
				record: { text: "Gone", createdAt: "2024-12-02T00:00:00.000Z" },
				embed: { $type: "app.bsky.embed.record#view", record: { $type: "app.bsky.embed.record#viewNotFound", uri: "at://did:plc:gone/app.bsky.feed.post/g", notFound: true } },
			},
		}, {
			post: {
				uri: `at://${did}/app.bsky.feed.post/five`,
				author,
				record: {
					text: "See example.com",
					createdAt: "2024-12-01T00:00:00.000Z",
					facets: [{ index: { byteStart: 4, byteEnd: 15 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com" }] }],
				},
				embed: { $type: "app.bsky.embed.external#view", external: { uri: "https://example.com/", title: "Example", description: "Duplicate" } },
			},
		}, {
			post: {
				uri: `at://${did}/app.bsky.feed.post/six`,
				author,
				record: { text: "Card", createdAt: "2024-11-30T00:00:00.000Z" },
				embed: { $type: "app.bsky.embed.external#view", external: { uri: "https://example.com/", title: "Example", description: "Kept" } },
			},
		}],
	});
	importer.addDataOverride("bluesky", `https://plc.directory/${did}`, {
		service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example" }],
	});

	let [one, two, three, four, five, six] = await importer.getEntries({ contentType: "html" });
	let quoteDate = new BlueskyUser("x").toReadableDate("2024-12-04T00:00:00.000Z");
	assert.equal(one.content, `<p>Hi <a href="https://bsky.app/profile/did:plc:jane">@jane.example</a> 🎉 <a href="https://bsky.app/hashtag/11ty">#11ty</a> <a href="https://example.com/long/url">example.com/long...</a></p>
<img src="https://cdn.bsky.app/img/a@jpeg" alt="Alt">
<blockquote cite="https://bsky.app/profile/jane.example/post/quoted">
<p>Quoted &lt;b&gt;</p>
<p><a href="https://bsky.app/profile/x.example/post/nested">Quoted post</a></p>
<p>— <a href="https://bsky.app/profile/jane.example">Jane</a> (<a href="https://bsky.app/profile/jane.example/post/quoted">${quoteDate}</a>)</p>
</blockquote>`);
	assert.equal(two.content, `<p>Video</p>
<video controls="" src="https://pds.example/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Axpchjovbk6sxl3bv74z7cs54&amp;cid=vid" poster="https://video.bsky.app/thumb.jpg"></video>`);
	assert.equal(three.content, `<p><a href="https://bsky.app/profile/hidden.example/post/h">Quoted post</a></p>`);
	assert.equal(four.content, `<p>Gone</p>
<p><a href="https://bsky.app/profile/did:plc:gone/post/g">Quoted post (unavailable)</a></p>`);
	assert.equal(five.content, `<p>See <a href="https://example.com">example.com</a></p>`);
	assert.equal(six.content, `<p>Card</p>
<p><a href="https://example.com/">Example</a><br>
Kept</p>`);
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

	assert.match(Importer.getFileContent(entries[1]).content, /^description: Yoast description$/m);
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

test("WordPress falls back to the paged RSS feed when no API is found", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);

	importer.addSource("wordpress", "https://example.com/");

	let feed = {
		rss: {
			channel: {
				title: "Example",
				link: "https://example.com/",
				item: [{
					title: "Hello &#8217;world",
					link: "https://example.com/2024/01/hello.html?utm_source=rss&#038;utm_medium=rss",
					"dc:creator": "Zach",
					pubDate: "Mon, 01 Jan 2024 12:00:00 +0000",
					category: ["Economics", "Uncategorized"],
					guid: { "#text": "https://example.com/?p=123", "@_isPermaLink": "false" },
					description: "<p>Excerpt</p>\n<p>The post <a href=\"https://example.com/2024/01/hello.html\">Hello</a> appeared first on <a href=\"https://example.com\">Example</a>.</p>",
					"content:encoded": "<p>Content</p>",
				}],
			},
		},
	};
	importer.addDataOverride("wordpress", "https://example.com/feed?paged=1", feed);
	importer.addDataOverride("wordpress", "https://example.com/feed?paged=2", { rss: { channel: {} } });

	let entries = await importer.getEntries({ contentType: "html" });
	assert.equal(entries.length, 1);
	assert.equal(entries[0].uuid, "11ty/import::wordpress::https://example.com/?p=123");
	assert.equal(entries[0].type, "wordpress");
	assert.equal(entries[0].title, "Hello ’world");
	assert.equal(entries[0].url, "https://example.com/2024/01/hello.html");
	// `.html` isn’t doubled
	assert.equal(entries[0].filePath, "2024/01/hello.html");
	assert.equal(entries[0].description, "Excerpt");
	assert.deepEqual(entries[0].authors, [{ name: "Zach" }]);
	assert.deepEqual(entries[0].tags, ["Economics"]);
	assert.deepEqual(entries[0].metadata, { id: 123, slug: "hello", postType: "post", categories: ["Economics"] });
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
	importer.addDataOverride("bluesky", BLUESKY_FEED_URL, getBlueskyFeed());

	let root = "at://did:plc:xpchjovbk6sxl3bv74z7cs54/app.bsky.feed.post/3lckusgtkuk2r";
	let reply = {
		uri: "at://did:plc:jane/app.bsky.feed.post/aaa",
		author: { handle: "jane.example", displayName: "Jane", avatar: "https://cdn.bsky.app/avatar.jpg" },
		record: {
			text: "<b>Nice</b>\nlist 🎉 example.com/a...",
			facets: [{ index: { byteStart: 22, byteEnd: 38 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com/a/long" }] }],
			createdAt: "2024-12-05T15:00:00.000Z",
			reply: { parent: { uri: root } },
		},
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
		content: `<p>&lt;b&gt;Nice&lt;/b&gt;<br>\nlist 🎉 <a href="https://example.com/a/long">example.com/a...</a></p>`,
	}, {
		id: nested.uri,
		parentId: reply.uri,
		url: "https://bsky.app/profile/zachleat.com/post/bbb",
		author: { name: "zachleat.com", url: "https://bsky.app/profile/zachleat.com" },
		date: new Date("2024-12-05T16:00:00.000Z"),
		content: "<p>Thanks</p>",
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

test("Escaped HTML stays escaped for JSON sources, Atom feeds are decoded", async (t) => {
	let importer = getCommentsImporter("fediverse", { url: "@eleventy@fosstodon.org", comments: false });
	let account = { id: "1", acct: "eleventy", url: "https://fosstodon.org/@eleventy" };
	let statusesUrl = "https://fosstodon.org/api/v1/accounts/1/statuses?limit=40&exclude_replies=true&exclude_reblogs=true";
	importer.addDataOverride("fediverse", "https://fosstodon.org/api/v1/accounts/lookup?acct=eleventy", account);
	importer.addDataOverride("fediverse", statusesUrl, [{ id: "1", created_at: "2024-01-01T00:00:00.000Z", url: "https://fosstodon.org/@eleventy/1", content: "<p>Use &lt;output&gt; &amp; more</p>", account }]);
	importer.addDataOverride("fediverse", `${statusesUrl}&max_id=1`, []);

	let [status] = await importer.getEntries({ contentType: "html" });
	assert.equal(status.content, "<p>Use &lt;output&gt; &amp; more</p>");

	let atom = getCommentsImporter("atom", { url: "https://example.com/feed.xml", comments: false });
	atom.addDataOverride("atom", "https://example.com/feed.xml", Fetcher.parseXml(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title><entry><id>tag:example.com,2024:1</id><link href="https://example.com/one/"/><published>2024-01-01T00:00:00Z</published><updated>2024-01-01T00:00:00Z</updated><content type="html">&lt;p&gt;Hi&lt;/p&gt;</content></entry></feed>`));

	let [item] = await atom.getEntries({ contentType: "html" });
	assert.equal(item.content, "<p>Hi</p>");
});

test("Bluesky and Fediverse counts", async (t) => {
	let importer = getCommentsImporter("fediverse", { url: "@eleventy@fosstodon.org", comments: false });
	let account = { id: "1", acct: "eleventy", url: "https://fosstodon.org/@eleventy" };
	let statusesUrl = "https://fosstodon.org/api/v1/accounts/1/statuses?limit=40&exclude_replies=true&exclude_reblogs=true";
	importer.addDataOverride("fediverse", "https://fosstodon.org/api/v1/accounts/lookup?acct=eleventy", account);
	importer.addDataOverride("fediverse", statusesUrl, [
		{ id: "2", created_at: "2024-01-02T00:00:00.000Z", url: "https://fosstodon.org/@eleventy/2", content: "<p>Hi</p>", account, favourites_count: 5, reblogs_count: 2, replies_count: 0, quotes_count: 1 },
		{ id: "1", created_at: "2024-01-01T00:00:00.000Z", url: "https://fosstodon.org/@eleventy/1", content: "<p>Quiet</p>", account, favourites_count: 0, reblogs_count: 0, replies_count: 0 },
	]);
	importer.addDataOverride("fediverse", `${statusesUrl}&max_id=1`, []);

	let [status, quiet] = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(status.counts, { likes: 5, reposts: 2, quotes: 1 });
	assert.equal(quiet.counts, undefined);

	let feed = getBlueskyFeed();
	Object.assign(feed.feed[0].post, { likeCount: 12, repostCount: 3, replyCount: 4, quoteCount: 0 });
	let bluesky = getCommentsImporter("bluesky", { url: "zachleat.com", comments: false });
	bluesky.addDataOverride("bluesky", BLUESKY_FEED_URL, feed);
	let [post] = await bluesky.getEntries();
	assert.deepEqual(post.counts, { likes: 12, reposts: 3, comments: 4 });
});

function getFediversePagingImporter(dir) {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setOutputFolder(dir);
	importer.setAssetReferenceType("colocate");
	importer.setPruneAssets(true);
	importer.addSource("fediverse", { url: "@eleventy@fosstodon.org", comments: false });
	return importer;
}

const FEDIVERSE_ACCOUNT_URL = "https://fosstodon.org/api/v1/accounts/lookup?acct=eleventy";
const FEDIVERSE_STATUSES_URL = "https://fosstodon.org/api/v1/accounts/1/statuses?limit=40&exclude_replies=true&exclude_reblogs=true";

test("A failed page keeps entries from earlier pages", async (t) => {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), "eleventy-import-paging-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

	// Stale asset from an earlier import isn’t pruned from a partial import
	let postDir = path.join(dir, "eleventy@fosstodon.org", "1");
	fs.mkdirSync(postDir, { recursive: true });
	fs.writeFileSync(path.join(postDir, "old-AAAAAAAAAAAA.png"), "old");

	let importer = getFediversePagingImporter(dir);
	let account = { id: "1", acct: "eleventy", url: "https://fosstodon.org/@eleventy" };
	importer.addDataOverride("fediverse", FEDIVERSE_ACCOUNT_URL, account);
	importer.addDataOverride("fediverse", FEDIVERSE_STATUSES_URL, [{ id: "1", created_at: "2024-01-01T00:00:00.000Z", url: "https://fosstodon.org/@eleventy/1", content: "<p>One</p>", favourites_count: 2, account }]);
	importer.addDataOverride("fediverse", `${FEDIVERSE_STATUSES_URL}&max_id=1`, new Error("Rate limited (429)"));

	let entries = await importer.getEntries({ contentType: "html", target: "fs" });
	assert.deepEqual(entries.map(entry => entry.url), ["https://fosstodon.org/@eleventy/1"]);

	await importer.toFiles(entries);
	assert.ok(fs.existsSync(path.join(postDir, "index.html")));
	assert.ok(fs.existsSync(path.join(postDir, "old-AAAAAAAAAAAA.png")));

	assert.equal(importer.isIncomplete(), true);
	assert.equal(importer.getCounts().errors, 1);
	assert.equal(importer.getCounts().pruned, 0);
	assert.equal(importer.getCounts().files, 1);
	assert.equal(importer.getCounts().data, 1);
});

test("A failed first request throws", async (t) => {
	let account = { id: "1", acct: "eleventy", url: "https://fosstodon.org/@eleventy" };

	let lookup = getFediversePagingImporter(".");
	lookup.addDataOverride("fediverse", FEDIVERSE_ACCOUNT_URL, new Error("Rate limited (429)"));
	await assert.rejects(lookup.getEntries(), /Rate limited/);

	let firstPage = getFediversePagingImporter(".");
	firstPage.addDataOverride("fediverse", FEDIVERSE_ACCOUNT_URL, account);
	firstPage.addDataOverride("fediverse", FEDIVERSE_STATUSES_URL, new Error("Rate limited (429)"));
	await assert.rejects(firstPage.getEntries(), /Rate limited/);
});

test("Counts are replaced by their post source and kept by data only sources", async (t) => {
	let post = counts => ({ source: { constructor: { TYPE: "bluesky" } }, ...(counts ? { counts } : {}) });
	let webmentions = { source: { constructor: { TYPE: "webmention", DATA_ONLY: true } }, likes: [{ id: 1, date: "2024-01-01T00:00:00.000Z" }] };

	let data = JSON.parse(Importer.convertCommentsToJson(post({ likes: 2 })));
	assert.deepEqual(data.counts, { likes: 2, via: "bluesky" });

	data = JSON.parse(Importer.convertCommentsToJson(webmentions, data));
	assert.deepEqual(data.counts, { likes: 2, via: "bluesky" });
	assert.equal(data.likes.length, 1);

	data = JSON.parse(Importer.convertCommentsToJson(post({ likes: 3, reposts: 1 }), data, { replace: false }));
	assert.deepEqual(data.counts, { likes: 3, reposts: 1, via: "bluesky" });

	// Dropped to zero
	data = JSON.parse(Importer.convertCommentsToJson(post(), data, { replace: false }));
	assert.equal(data.counts, undefined);
	assert.equal(data.likes.length, 1);

	// Another post source’s counts are kept
	data = JSON.parse(Importer.convertCommentsToJson({ source: { constructor: { TYPE: "fediverse" } } }, { counts: { likes: 1, via: "bluesky" } }));
	assert.deepEqual(data.counts, { likes: 1, via: "bluesky" });
});

test("Fediverse access token is only sent to the user’s server API", async (t) => {
	withEnv(t, { MASTODON_ACCESS_TOKEN: "FAKE_TOKEN" });

	let source = new FediverseUser("@eleventy@fosstodon.org");
	assert.deepEqual(source.getHeaders("https://fosstodon.org/api/v1/accounts/lookup?acct=eleventy"), { Authorization: "Bearer FAKE_TOKEN" });
	assert.deepEqual(source.getHeaders("https://cdn.fosstodon.org/media/image.png"), {});
	assert.deepEqual(source.getHeaders("https://mastodon.social/api/v1/statuses/1"), {});

	withEnv(t, { MASTODON_ACCESS_TOKEN: undefined });
	assert.deepEqual(source.getHeaders("https://fosstodon.org/api/v1/accounts/lookup?acct=eleventy"), {});
});

test("Fediverse replies", async (t) => {
	let importer = getCommentsImporter("fediverse", "@eleventy@fosstodon.org");
	let account = { id: "1", acct: "eleventy", display_name: "Eleventy", url: "https://fosstodon.org/@eleventy" };
	let statusesUrl = "https://fosstodon.org/api/v1/accounts/1/statuses?limit=40&exclude_replies=true&exclude_reblogs=true";
	importer.addDataOverride("fediverse", "https://fosstodon.org/api/v1/accounts/lookup?acct=eleventy", account);
	importer.addDataOverride("fediverse", statusesUrl, [{
		id: "111",
		created_at: "2024-01-01T00:00:00.000Z",
		edited_at: "2024-01-01T01:00:00.000Z",
		url: "https://fosstodon.org/@eleventy/111",
		content: "<p>Hello</p>",
		media_attachments: [
			{ type: "image", url: "https://files.example/a.png", description: "Alt" },
			{ type: "gifv", url: "https://files.example/b.mp4", preview_url: "https://files.example/b.png" },
		],
		account,
	}]);
	importer.addDataOverride("fediverse", `${statusesUrl}&max_id=111`, [{
		id: "100",
		created_at: "2023-12-31T00:00:00.000Z",
		url: "https://fosstodon.org/@eleventy/100",
		content: "<p>Older</p>",
		media_attachments: [],
		account,
	}]);
	importer.addDataOverride("fediverse", `${statusesUrl}&max_id=100`, []);
	importer.addDataOverride("fediverse", "https://fosstodon.org/api/v1/statuses/100/context", { ancestors: [], descendants: [] });
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

	let entries = await importer.getEntries();
	assert.equal(entries.length, 2);
	let [entry, older] = entries;
	assert.equal(entry.metadata.slug, "111");
	assert.equal(entry.uuid, "11ty/import::rss::https://fosstodon.org/@eleventy/111");
	assert.deepEqual(entry.authors, [{ name: "Eleventy", url: "https://fosstodon.org/@eleventy" }]);
	assert.deepEqual(entry.dateUpdated, new Date("2024-01-01T01:00:00.000Z"));
	assert.equal(entry.content, `<p>Hello</p>\n<img src="https://files.example/a.png" alt="Alt">\n<video controls="" src="https://files.example/b.mp4" poster="https://files.example/b.png"></video>`);
	assert.equal(older.metadata.slug, "100");
	assert.equal(older.dateUpdated, undefined);
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
		// Retweets and replies to others are skipped, replies to yourself are comments
		assert.deepEqual(entries.map(entry => entry.metadata.id), ["2008", "2006", "2002", "2001"]);
		assert.deepEqual(entries.map(entry => entry.metadata.slug), ["2008", "2006", "2002", "2001"]);

		let [deletedParent, part1, media, text] = entries;
		assert.equal(part1.filePath, "zachleat/2006.md");
		assert.equal(part1.content, "From the second part");
		assert.equal(part1.comments, undefined);

		// Parent isn’t in the archive
		assert.equal(deletedParent.metadata.inReplyTo, "https://x.com/zachleat/status/1999");
		assert.equal(deletedParent.content, "Reply to a deleted tweet");

		let author = { name: "Zach Leatherman", url: "https://x.com/zachleat", avatarUrl: "https://pbs.twimg.com/profile_images/1/avatar.jpg" };
		assert.deepEqual(media.comments, [
			{ id: "2003", parentId: 0, url: "https://x.com/zachleat/status/2003", author, date: new Date("2018-10-12T20:19:24.000Z"), content: "<p>Continuing the thread</p>" },
			{ id: "2007", parentId: "2003", url: "https://x.com/zachleat/status/2007", author, date: new Date("2018-10-16T20:19:24.000Z"), content: `<p>Thread photo</p>\n<p><img src="https://pbs.twimg.com/media/Photo2.jpg" alt=""></p>` },
		]);

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
			`![A "photo"](https://pbs.twimg.com/media/Photo1.jpg)`,
			``,
			// Archived video variant is preferred over the highest bitrate
			`<video controls="" src="https://video.twimg.com/ext_tw_video/3/pu/vid/640x360/Small.mp4?tag=10" poster="https://pbs.twimg.com/ext_tw_video_thumb/3/pu/img/Poster.jpg"></video>`,
		].join("\n"));
	});

	test(`Twitter archive without comments (${archivePath})`, async (t) => {
		let importer = new Importer();
		importer.setVerbose(false);
		importer.setDryRun(true);
		importer.setAssetReferenceType("disabled");

		importer.addSource("twitter", { url: archivePath, comments: false });

		let entries = await importer.getEntries({ contentType: "markdown" });
		assert.deepEqual(entries.map(entry => entry.metadata.id), ["2008", "2007", "2006", "2003", "2002", "2001"]);
		assert.equal(entries[3].metadata.inReplyTo, "https://x.com/zachleat/status/2002");
		assert.ok(entries.every(entry => !entry.comments));
	});

	test(`Twitter archive thread media (${archivePath})`, async (t) => {
		let importer = new Importer();
		importer.setVerbose(false);
		importer.setDryRun(true);
		importer.setAssetReferenceType("relative");

		importer.addSource("twitter", archivePath);

		let [source] = importer.getSources();
		let entry = (await source.getEntries()).find(entry => entry.metadata.id === "2002");
		entry.filePath = "zachleat/2002.md";

		await importer.transformComments(entry);
		let [first, second] = entry.comments;
		// Avatars default to the root assets folder
		assert.match(first.author.avatarUrl, /^\/assets\/avatar-\w+\.jpg$/);
		assert.match(second.content, /<img src="assets\/Photo2-\w+\.jpg" alt="">/);
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
		reaction_count: 5,
		restacks: 1,
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
	assert.deepEqual(post.counts, { likes: 5, reposts: 1, comments: 2 });
	assert.equal(paid.counts, undefined);
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
			entry: [entry("200", {
				published: { $t: "2026-01-01T12:00:00.000-07:00" },
				content: { type: "html", $t: `<p><a href="https://example.blogspot.com/2026/10/post-100.html#more">Post</a></p>` },
			})],
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

	// Links to imported posts point to their files
	assert.equal(page.content.trim(), "[Post](post-100.md#more)");
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
		public_reactions_count: 7,
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
	assert.deepEqual(post.counts, { likes: 7, comments: 1 });
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
	assert.deepEqual(post.metadata, { id: "0123456789ab", slug: "0123456789ab" });
	// The title and subtitle repeated in the body are removed
	assert.equal(post.content, "* * *\n\nFirst **paragraph**.\n\n![](https://cdn-images-1.medium.com/max/800/1*abc.png)");

	assert.equal(draft.uuid, "11ty/import::medium::ba9876543210");
	assert.equal(draft.status, "draft");
	assert.equal(draft.url, "https://medium.com/p/ba9876543210");
	assert.equal(draft.filePath, "drafts/p/ba9876543210.md");
	assert.deepEqual(draft.authors, []);
	assert.equal(draft.content, "Draft text.");
});

test("Wayback Machine", async (t) => {
	let importer = getImporter();
	importer.addSource("wayback", "https://web.archive.org/web/2020/http://example.com/blog/?ref=1");

	let cdxUrl = resumeKey => `https://web.archive.org/cdx/search/cdx?url=example.com%2Fblog%2F&matchType=prefix&output=json&fl=urlkey%2Ctimestamp%2Coriginal&filter=statuscode%3A200&collapse=digest&showResumeKey=true&limit=5000&filter=mimetype%3Atext%2Fhtml&to=2020${resumeKey ? `&resumeKey=${resumeKey}` : ""}`;
	importer.addDataOverride("wayback", cdxUrl(), [
		["urlkey", "timestamp", "original"],
		["com,example)/blog/first", "20100101000000", "http://example.com/blog/first"],
		["com,example)/blog/first", "20150101000000", "http://www.example.com/blog/first/"],
		["com,example)/blog/search?q=x", "20150101000000", "http://example.com/blog/search?q=x"],
		[],
		["next"],
	]);
	importer.addDataOverride("wayback", cdxUrl("next"), [
		["urlkey", "timestamp", "original"],
		["com,example)/blog/second.html", "20120101000000", "http://example.com/blog/second.html"],
		["com,example)/blog/missing", "20120101000000", "http://example.com/blog/missing"],
	]);

	importer.addDataOverride("wayback", "https://web.archive.org/web/20150101000000id_/http://www.example.com/blog/first/", `<!doctype html>
<html><head>
	<title>First &amp; best | Example</title>
	<meta property="og:title" content="First &amp; best">
	<meta name="description" content="A description">
	<meta property="og:image" content="/images/cover.png">
	<meta property="article:tag" content="Web">
	<script type="application/ld+json">{"@graph":[{"@type":"BlogPosting","datePublished":"2009-12-01T12:00:00Z","dateModified":"2010-02-01T12:00:00Z","author":{"name":"Jane"}}]}</script>
</head><body>
	<nav><a href="/">Home</a></nav>
	<article>
		<header><h1>First &amp; best</h1></header>
		<!-- comment -->
		<p>Hello <a href="../second.html">second</a> and <a href="https://web.archive.org/web/2014/http://other.example/">other</a>.</p>
		<img data-src="photo.jpg" src="data:image/gif;base64,R0lGOD">
		<script>alert(1)</script>
		<footer>Share</footer>
	</article>
</body></html>`);
	importer.addDataOverride("wayback", "https://web.archive.org/web/20120101000000id_/http://example.com/blog/second.html", `<html><head><title>Second | Example</title></head><body><main><h1>Another heading</h1><p>Text</p></main></body></html>`);
	importer.addDataOverride("wayback", "https://web.archive.org/web/20120101000000id_/http://example.com/blog/missing", new Error("Not found"));

	let [second, first] = await importer.getEntries({ contentType: "html" });
	assert.equal(importer.getSources()[0].to, "2020");

	assert.equal(first.uuid, "11ty/import::wayback::com,example)/blog/first");
	assert.equal(first.title, "First & best");
	assert.equal(first.url, "http://www.example.com/blog/first/");
	assert.equal(first.filePath, "blog/first.html");
	assert.equal(first.description, "A description");
	assert.deepEqual(first.date, new Date("2009-12-01T12:00:00Z"));
	assert.deepEqual(first.dateUpdated, new Date("2010-02-01T12:00:00Z"));
	assert.deepEqual(first.authors, [{ name: "Jane" }]);
	assert.deepEqual(first.tags, ["Web"]);
	assert.deepEqual(first.metadata, {
		archiveUrl: "https://web.archive.org/web/20150101000000/http://www.example.com/blog/first/",
		media: { featuredImage: "https://web.archive.org/web/20150101000000id_/http://www.example.com/images/cover.png" },
	});
	// Links to imported pages point to their files, the title, navigation, header, footer, scripts, and comments are removed
	assert.equal(cleanContent(first.content), `<p>Hello <a href="second.html">second</a> and <a href="http://other.example/">other</a>.</p>
<img data-src="photo.jpg" src="https://web.archive.org/web/20150101000000id_/http://www.example.com/blog/first/photo.jpg">`);

	assert.equal(second.title, "Another heading");
	assert.equal(second.filePath, "blog/second.html");
	// Earliest capture is the fallback date
	assert.deepEqual(second.date, new Date("2012-01-01T00:00:00Z"));
	assert.deepEqual(second.authors, []);
	assert.equal(cleanContent(second.content), "<p>Text</p>");
});

test("Wayback Machine links to imported pages", async (t) => {
	let importer = getImporter();
	importer.addSource("wayback", "example.com");

	importer.addDataOverride("wayback", "https://web.archive.org/cdx/search/cdx?url=example.com%2F&matchType=prefix&output=json&fl=urlkey%2Ctimestamp%2Coriginal&filter=statuscode%3A200&collapse=digest&showResumeKey=true&limit=5000&filter=mimetype%3Atext%2Fhtml", [
		["com,example)/book", "20090101000000", "http://example.com/book/"],
		["com,example)/book/chapter-1.html", "20090101000000", "http://example.com/book/chapter-1.html"],
	]);
	importer.addDataOverride("wayback", "https://web.archive.org/web/20090101000000id_/http://example.com/book/", `<html><head><title>Book</title></head><body><main><p><a href="/book/chapter-1.html#section1">One</a> <a href="/book/chapter-2.html">Two</a></p></main></body></html>`);
	importer.addDataOverride("wayback", "https://web.archive.org/web/20090101000000id_/http://example.com/book/chapter-1.html", `<html><head><title>One</title></head><body><main><p><a href="../book/">Contents</a></p></main></body></html>`);

	let entries = await importer.getEntries({ contentType: "markdown" });
	let book = entries.find(entry => entry.title === "Book");
	let chapter = entries.find(entry => entry.title === "One");

	assert.equal(book.filePath, "book.md");
	assert.equal(chapter.filePath, "book/chapter-1.md");
	// Pages that weren’t imported stay root-relative
	assert.equal(book.content.trim(), "[One](book/chapter-1.md#section1) [Two](/book/chapter-2.html)");
	assert.equal(chapter.content.trim(), "[Contents](../book.md)");
});

test("Wayback Machine until option", async (t) => {
	let importer = getImporter();
	importer.addSource("wayback", { url: "https://web.archive.org/web/2020/http://example.com/", until: "2009-08-19" });
	assert.equal(importer.getSources()[0].to, "20090819");

	importer.addSource("typepad", { url: "example.typepad.com", until: "2009" });
	assert.equal(importer.getSources()[1].to, "2009");

	assert.throws(() => importer.addSource("wayback", { url: "example.com", until: "last year" }), /Invalid until value/);
	assert.throws(() => importer.addSource("rss", { url: "https://example.com/feed.xml", until: "200913" }), /Invalid until value/);
});

test("Until option skips newer entries for any source", async (t) => {
	let importer = getImporter();
	importer.addSource("jsonfeed", { url: "https://example.com/feed.json", until: "2009-08" });

	let item = (id, date) => ({ id, url: `https://example.com/posts/${id}/`, title: id, content_html: "<p>Hi</p>", date_published: date });
	importer.addDataOverride("jsonfeed", "https://example.com/feed.json", {
		version: "https://jsonfeed.org/version/1.1",
		title: "Example",
		next_url: "https://example.com/feed.json?page=2",
		items: [item("newer", "2009-09-01T00:00:00Z")],
	});
	importer.addDataOverride("jsonfeed", "https://example.com/feed.json?page=2", {
		version: "https://jsonfeed.org/version/1.1",
		title: "Example",
		items: [item("last-day", "2009-08-31T23:59:59Z"), item("older", "2008-01-01T00:00:00Z"), item("undated")],
	});

	let entries = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entries.map(entry => entry.title).sort(), ["last-day", "older", "undated"]);
});

test("Wayback Machine skips deeply nested pages", async (t) => {
	let importer = getImporter();
	importer.addSource("wayback", "example.com");
	importer.getSources()[0].setVerbose(false);

	importer.addDataOverride("wayback", "https://web.archive.org/cdx/search/cdx?url=example.com%2F&matchType=prefix&output=json&fl=urlkey%2Ctimestamp%2Coriginal&filter=statuscode%3A200&collapse=digest&showResumeKey=true&limit=5000&filter=mimetype%3Atext%2Fhtml", [
		["urlkey", "timestamp", "original"],
		["com,example)/deep", "20090101000000", "http://example.com/deep"],
		["com,example)/ok", "20090101000000", "http://example.com/ok"],
	]);
	importer.addDataOverride("wayback", "https://web.archive.org/web/20090101000000id_/http://example.com/deep", `<html><body>${"<ol><li>".repeat(10000)}Spam</body></html>`);
	importer.addDataOverride("wayback", "https://web.archive.org/web/20090101000000id_/http://example.com/ok", `<html><body><main><h1>OK</h1><p>Text</p></main></body></html>`);

	let entries = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entries.map(entry => entry.title), ["OK"]);
});

test("Wayback Machine content selector", async (t) => {
	let importer = getImporter();
	importer.addSource("wayback", { url: "example.com", contentSelector: "div.entry" });

	importer.addDataOverride("wayback", "https://web.archive.org/cdx/search/cdx?url=example.com%2F&matchType=prefix&output=json&fl=urlkey%2Ctimestamp%2Coriginal&filter=statuscode%3A200&collapse=digest&showResumeKey=true&limit=5000&filter=mimetype%3Atext%2Fhtml", [
		["urlkey", "timestamp", "original"],
		["com,example)/post", "20090101000000", "http://example.com/post"],
		["com,example)/about", "20090101000000", "http://example.com/about"],
	]);
	importer.addDataOverride("wayback", "https://web.archive.org/web/20090101000000id_/http://example.com/post", `<html><head><title>Post</title></head><body><main><p>Sidebar</p><span class="entry">Not a div</span><div class="other entry"><p>Body</p></div></main></body></html>`);
	importer.addDataOverride("wayback", "https://web.archive.org/web/20090101000000id_/http://example.com/about", `<html><head><title>About</title></head><body><main><p>About</p></main></body></html>`);

	let entries = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entries.map(entry => [entry.title, entry.content]), [["Post", "<p>Body</p>"]]);

	assert.throws(() => importer.addSource("wayback", { url: "example.com", contentSelector: "div > p" }), /Invalid content selector/);
	assert.throws(() => importer.addSource("rss", { url: "https://example.com/feed.xml", contentSelector: ".entry" }), /not supported by the rss source/);
});

test("Hobix (Wayback Machine)", async (t) => {
	let importer = getImporter();
	importer.addSource("hobix", "redhanded.hobix.com");

	importer.addDataOverride("hobix", "https://web.archive.org/cdx/search/cdx?url=redhanded.hobix.com%2F&matchType=prefix&output=json&fl=urlkey%2Ctimestamp%2Coriginal&filter=statuscode%3A200&collapse=digest&showResumeKey=true&limit=5000&filter=mimetype%3Atext%2Fhtml", [
		["urlkey", "timestamp", "original"],
		["com,hobix,redhanded)/", "20090101000000", "http://redhanded.hobix.com/"],
		["com,hobix,redhanded)/cult", "20090101000000", "http://redhanded.hobix.com/cult"],
		["com,hobix,redhanded)/2005/03/24.html", "20090101000000", "http://redhanded.hobix.com/2005/03/24.html"],
		["com,hobix,redhanded)/-h/heyalrightwell.html", "20090101000000", "http://redhanded.hobix.com/-h/heyAlrightWell.html"],
		["com,hobix,redhanded)/rdoc/http.html", "20090101000000", "http://redhanded.hobix.com/rdoc/http.html"],
	]);

	let date = (ms, text) => `<script type="text/javascript">document.write((new Date(${ms})).strftime("%d %b %Y"));</script><noscript>${text}</noscript>`;
	importer.addDataOverride("hobix", "https://web.archive.org/web/20090101000000id_/http://redhanded.hobix.com/-h/heyAlrightWell.html", `<html><head><title>RedHanded &raquo; Hey, Alright, Well</title></head><body>
<div id="sidebar"><h2>Archive</h2></div>
<div class="entry">
	<h2 class="entryTitle">Hey, Alright, Well
	<span class="entryPermalink"><a href="http://redhanded.hobix.com/-h/heyAlrightWell.html">#</a></span></h2>
	<div class="entrySection">by <a href="http://whytheluckystiff.net/">why</a> in <a href="/-h">-h</a></div>
	<div class="entryContent"><p>A note to <a href="/cult/">readers</a>.</p></div>
</div>
<div class="entryFooter">${date(1111682784000, "<nobr>24 Mar 2005</nobr> at <nobr>10:46</nobr> UTC")} | 2 comments</div>
<div id="comments">
	<div class="entry">
		<div class="entryAttrib"><div class="entryAuthor"><h3>Joao</h3></div><div class="entryTime">said on <noscript><nobr>24 Mar 2005</nobr> at <nobr>10:57</nobr> UTC</noscript></div></div>
		<div class="entryContentOuter"><div class="entryContent"><p>I for one like your attitudes.</p></div></div>
	</div>
	<div class="entry">
		<div class="entryAttrib"><div class="entryAuthor"><h3>UUuuugh</h3></div><div class="entryTime">said on ${date(1111683361000, "")}</div></div>
		<div class="entryContentOuter"><div class="entryContent"><p>Flaming Lips?</p></div></div>
	</div>
	<div class="entry"><p><small>Comments are closed for this entry.</small></p></div>
</div>
</body></html>`);
	importer.addDataOverride("hobix", "https://web.archive.org/web/20090101000000id_/http://redhanded.hobix.com/rdoc/http.html", `<html><head><title>HTTP</title></head><body><p>Docs</p></body></html>`);

	let entries = await importer.getEntries({ contentType: "html" });
	assert.equal(entries.length, 1);

	let [post] = entries;
	assert.equal(post.title, "Hey, Alright, Well");
	assert.equal(post.filePath, "-h/heyAlrightWell.html");
	assert.deepEqual(post.date, new Date(1111682784000));
	assert.deepEqual(post.authors, [{ name: "why" }]);
	assert.deepEqual(post.tags, ["-h"]);
	assert.equal(cleanContent(post.content), `<p>A note to <a href="/cult/">readers</a>.</p>`);
	assert.deepEqual(post.comments.map(({ id, author, date, content }) => ({ id, author, date, content })), [
		{ id: "1111661820000", author: { name: "Joao" }, date: new Date("2005-03-24T10:57:00Z"), content: "<p>I for one like your attitudes.</p>" },
		{ id: "1111683361000", author: { name: "UUuuugh" }, date: new Date(1111683361000), content: "<p>Flaming Lips?</p>" },
	]);
});

test("Typepad (Wayback Machine)", async (t) => {
	let importer = getImporter();
	importer.addSource("typepad", "example.typepad.com/blog/");

	let cdxUrl = `https://web.archive.org/cdx/search/cdx?url=example.typepad.com%2Fblog%2F&matchType=prefix&output=json&fl=urlkey%2Ctimestamp%2Coriginal&filter=statuscode%3A200&collapse=digest&showResumeKey=true&limit=5000&filter=mimetype%3Atext%2Fhtml`;
	importer.addDataOverride("typepad", cdxUrl, [
		["urlkey", "timestamp", "original"],
		["com,typepad,example)/blog", "20100101000000", "http://example.typepad.com/blog/"],
		["com,typepad,example)/blog/news", "20100101000000", "http://example.typepad.com/blog/news/"],
		["com,typepad,example)/blog/2008/03", "20100101000000", "http://example.typepad.com/blog/2008/03/"],
		["com,typepad,example)/blog/2008/03/index.html", "20100101000000", "http://example.typepad.com/blog/2008/03/index.html"],
		["com,typepad,example)/blog/2008/03/hello.html", "20100101000000", "http://example.typepad.com/blog/2008/03/hello.html"],
	]);

	importer.addDataOverride("typepad", "https://web.archive.org/web/20100101000000id_/http://example.typepad.com/blog/2008/03/hello.html", `<!doctype html>
<html><head><title>Example Blog: Hello Typepad</title></head><body>
	<div id="beta"><h2 class="date-header">March 04, 2008</h2>
	<div class="entry-category-news entry-type-post entry" id="entry-6a00d8">
		<h3 class="entry-header">Hello Typepad</h3>
		<div class="entry-content">
			<div class="entry-body"><p>First <a href="http://example.typepad.com/blog/2008/02/older.html">older</a>.</p></div>
			<div class="entry-more" id="more"><p><img src="http://example.typepad.com/.a/6a00d8-pi"></p></div>
		</div>
		<div class="entry-footer">
			<p class="entry-footer-info"><span class="post-footers">Posted by Zach at 01:02 PM in <a href="http://example.typepad.com/blog/news/">News</a></span> <span class="separator">|</span> <a class="permalink" href="http://example.typepad.com/blog/2008/03/hello.html">Permalink</a></p>
		</div>
		<div class="entry-footer"><span class="tags">Tags: <a rel="tag" href="http://example.typepad.com/blog/tags/web">web</a></span></div>
	</div>
	<div class="comments" id="comments"><div class="comments-content">
		<div class="comment font-entrybody" id="comment-6a00d9">
			<div class="comment-content font-entrybody"><p>Nice <strong>post</strong>!</p></div>
			<p class="comment-footer font-entryfooter">Posted by: <a rel="nofollow" href="https://jane.example/">Jane</a> | <a href="http://example.typepad.com/blog/2008/03/hello.html#comment-6a00d9">March 05, 2008 at 09:00 AM</a></p>
		</div>
		<div class="comment font-entrybody" id="comment-6a00da">
			<div class="comment-content font-entrybody"><p>First!</p></div>
			<p class="comment-footer font-entryfooter">Posted by: Anonymous | March 04, 2008 at 02:00 PM</p>
		</div>
	</div></div>
	</div>
</body></html>`);

	let [post, ...rest] = await importer.getEntries({ contentType: "html" });
	assert.equal(rest.length, 0);
	assert.equal(post.uuid, "11ty/import::typepad::com,typepad,example)/blog/2008/03/hello");
	assert.equal(post.type, "typepad");
	assert.equal(post.title, "Hello Typepad");
	assert.deepEqual(post.date, new Date("2008-03-04T13:02:00Z"));
	assert.deepEqual(post.authors, [{ name: "Zach" }]);
	assert.deepEqual(post.tags, ["News", "web"]);
	assert.equal(cleanContent(post.content), `<p>First <a href="/blog/2008/02/older.html">older</a>.</p>
<p><img src="https://web.archive.org/web/20100101000000id_/http://example.typepad.com/.a/6a00d8-pi"></p>`);

	assert.deepEqual(post.comments.map(comment => [comment.id, comment.author, comment.date.toISOString(), comment.content]), [
		["6a00da", { name: "Anonymous" }, "2008-03-04T14:00:00.000Z", "<p>First!</p>"],
		["6a00d9", { name: "Jane", url: "https://jane.example/" }, "2008-03-05T09:00:00.000Z", "<p>Nice <strong>post</strong>!</p>"],
	]);
	assert.equal(post.comments[1].url, "http://example.typepad.com/blog/2008/03/hello.html#comment-6a00d9");
});

test("Typepad limit", async (t) => {
	let importer = getImporter();
	importer.addSource("typepad", { url: "example.typepad.com/blog/", limit: 2, comments: false });

	// One CDX query per year, newest first, stopping at the first year with enough posts
	let cdxUrl = year => `https://web.archive.org/cdx/search/cdx?url=example.typepad.com%2Fblog%2F${year}%2F&matchType=prefix&output=json&fl=urlkey%2Ctimestamp%2Coriginal&filter=statuscode%3A200&collapse=digest&showResumeKey=true&limit=5000&filter=mimetype%3Atext%2Fhtml`;
	for(let year = 2025; year > 2008; year--) {
		importer.addDataOverride("typepad", cdxUrl(year), [["urlkey", "timestamp", "original"]]);
	}
	importer.addDataOverride("typepad", cdxUrl(2008), [
		["urlkey", "timestamp", "original"],
		["com,typepad,example)/blog/2008/01/old.html", "20200101000000", "http://example.typepad.com/blog/2008/01/old.html"],
		["com,typepad,example)/blog/2008/03/b.html", "20080302000000", "http://example.typepad.com/blog/2008/03/b.html"],
		["com,typepad,example)/blog/2008/03/a.html", "20080301000000", "http://example.typepad.com/blog/2008/03/a.html"],
		// Month archive with several posts
		["com,typepad,example)/blog/2008/03/index.html", "20080401000000", "http://example.typepad.com/blog/2008/03/index.html"],
	]);
	for(let slug of ["a", "b"]) {
		// Footer date and author, the date header is commented out (e.g. Seth’s Blog)
		importer.addDataOverride("typepad", `https://web.archive.org/web/2008030${slug === "a" ? 1 : 2}000000id_/http://example.typepad.com/blog/2008/03/${slug}.html`, `<html><head><meta property="og:image" content="http://example.com/og.jpg"></head><body><!--MTDateHeader><h2 class="date-header">March 01, 2008</h2></MTDateHeader--><h3 class="entry-header">${slug}</h3><div class="entry-body"><p>${slug}</p></div><div class="entry-footer"><p class="entry-footer-info">Posted by <a href="http://profile.typepad.com/zach">Zach</a> on March 0${slug === "a" ? 1 : 2}, 2008 <span class="separator">|</span></p></div></body></html>`);
	}

	let entries = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entries.map(entry => [entry.title, entry.date.toISOString(), entry.authors]), [
		["b", "2008-03-02T00:00:00.000Z", [{ name: "Zach" }]],
		["a", "2008-03-01T00:00:00.000Z", [{ name: "Zach" }]],
	]);
	// Shared assets use one archive URL
	assert.deepEqual(new Set(entries.map(entry => entry.metadata.media.featuredImage)), new Set(["https://web.archive.org/web/20080302000000id_/http://example.com/og.jpg"]));
});

test("Limit stops paging and cleaning", async (t) => {
	let requests = [];
	class Paged extends DataSource {
		static TYPE = "paged";
		getType() {
			return "json";
		}
		getUrl() {
			return pageNumber => pageNumber <= 3 ? `https://example.com/page/${pageNumber}` : false;
		}
		getRawEntryDates(rawEntry) {
			return { created: new Date(rawEntry.date) };
		}
		cleanEntry(rawEntry) {
			requests.push(rawEntry.id);
			return { uuid: rawEntry.id, type: "paged", title: rawEntry.id, url: `https://example.com/${rawEntry.id}`, date: new Date(rawEntry.date), content: "", contentType: "html" };
		}
	}

	let importer = getImporter();
	importer.addSource(Paged, { url: "https://example.com/", limit: 3 });
	// Out of order within a page, newest are cleaned first
	importer.addDataOverride("paged", "https://example.com/page/1", [{ id: "b", date: "2024-01-02" }, { id: "a", date: "2024-01-03" }]);
	importer.addDataOverride("paged", "https://example.com/page/2", [{ id: "d", date: "2023-12-01" }, { id: "c", date: "2023-12-02" }]);

	let entries = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entries.map(entry => entry.title), ["a", "b", "c"]);
	// `d` is never cleaned and page 3 is never requested (it has no override)
	assert.deepEqual(requests, ["a", "b", "c"]);
});

test("Linktree", async (t) => {
	let importer = getImporter();
	importer.addSource("linktree", "@example");

	let link = (id, position, extra = {}) => ({ id: String(id), type: "CLASSIC", title: `Link ${id}`, url: `https://example.com/${id}`, position, parent: null, locked: null, thumbnail: null, ...extra });
	let pageProps = {
		account: {
			id: 1,
			username: "example",
			pageTitle: " Example & Co ",
			description: "A bio",
			profilePictureUrl: "https://ugc.production.linktr.ee/avatar.png",
			createdAt: 1629853014000,
			updatedAt: 1792131940000,
			socialLinks: [{ type: "INSTAGRAM", url: "https://instagram.com/example", position: 1 }, { type: "TIKTOK", url: "https://tiktok.com/@example", position: 0 }],
		},
		links: [
			link(2, 1, { title: " Second  ", thumbnail: "https://ugc.production.linktr.ee/thumb.png" }),
			link(1, 0),
			link(10, 2, { type: "GROUP", title: "Group ", url: "" }),
			link(12, 1, { parent: { id: 10, context: { layoutOption: "stack" } } }),
			link(11, 0, { type: "YOUTUBE_VIDEO", parent: { id: 10, context: { layoutOption: "carousel" } } }),
			// Children of a missing group, an empty group, widgets without a URL, and locked links are skipped
			link(21, 0, { parent: { id: 20 } }),
			link(30, 3, { type: "GROUP", title: "Empty", url: "" }),
			link(4, 4, { type: "EXTENSION", url: "" }),
			link(5, 5, { locked: true }),
			link(6, 6),
		],
	};
	importer.addDataOverride("linktree", "https://linktr.ee/example", `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></body></html>`);

	let [entry] = await importer.getEntries({ contentType: "html" });

	assert.equal(entry.uuid, "11ty/import::linktree::1");
	assert.equal(entry.title, "Example & Co");
	assert.equal(entry.url, "https://linktr.ee/example");
	assert.equal(entry.filePath, "example.html");
	assert.equal(entry.description, "A bio");
	assert.deepEqual(entry.date, new Date(1629853014000));
	assert.deepEqual(entry.dateUpdated, new Date(1792131940000));
	assert.deepEqual(entry.authors, [{ name: "Example & Co", url: "https://linktr.ee/example", avatarUrl: "https://ugc.production.linktr.ee/avatar.png" }]);
	assert.deepEqual(entry.metadata, {
		id: 1,
		slug: "example",
		postType: "page",
		links: [
			{ id: "1", type: "CLASSIC", title: "Link 1", url: "https://example.com/1" },
			{ id: "2", type: "CLASSIC", title: "Second", url: "https://example.com/2" },
			{ id: "11", type: "YOUTUBE_VIDEO", title: "Link 11", url: "https://example.com/11", group: "Group" },
			{ id: "12", type: "CLASSIC", title: "Link 12", url: "https://example.com/12", group: "Group" },
			{ id: "6", type: "CLASSIC", title: "Link 6", url: "https://example.com/6" },
		],
		socialLinks: [
			{ type: "TIKTOK", url: "https://tiktok.com/@example" },
			{ type: "INSTAGRAM", url: "https://instagram.com/example" },
		],
		media: { featuredImage: "https://ugc.production.linktr.ee/avatar.png" },
	});
	assert.equal(entry.content, `<ul>
<li><a href="https://example.com/1">Link 1</a></li>
<li><img src="https://ugc.production.linktr.ee/thumb.png" alt=""> <a href="https://example.com/2">Second</a></li>
</ul>
<h2>Group</h2>
<ul>
<li><a href="https://example.com/11">Link 11</a></li>
<li><a href="https://example.com/12">Link 12</a></li>
</ul>
<ul>
<li><a href="https://example.com/6">Link 6</a></li>
</ul>`);
});

test("Asset filenames replace URL-unsafe characters", async (t) => {
	assert.equal(Fetcher.getFilenameFromSrc("https://example.com/Screen%20Shot%202023-07-12%20at%207.41.23%20AM.png"), `Screen-Shot-2023-07-12-at-7.41-${Fetcher.createHash("https://example.com/Screen%20Shot%202023-07-12%20at%207.41.23%20AM.png")}.png`);
	assert.equal(Fetcher.getFilenameFromSrc("https://example.com/caf%C3%A9%20(1).jpg"), `café-1-${Fetcher.createHash("https://example.com/caf%C3%A9%20(1).jpg")}.jpg`);
	assert.equal(Fetcher.getFilenameFromSrc("https://example.com/plain-file_1.png"), `plain-file_1-${Fetcher.createHash("https://example.com/plain-file_1.png")}.png`);
});

test("Avatar reference types", async (t) => {
	let entry = { url: "https://example.com/blog/one/", filePath: "out/blog/one.md" };
	let fetcher = new Fetcher();
	fetcher.setOutputFolder("out");
	let location = refType => fetcher.getAssetLocation("https://example.com/avatar.png", "image/png", entry, refType);

	assert.match(location("absolute").url, /^\/assets\/avatar-\w+\.png$/);
	assert.match(location("absolute").filePath, /^out\/assets\/avatar-\w+\.png$/);
	assert.match(location("relative").filePath, /^out\/blog\/assets\/avatar-\w+\.png$/);
	assert.match(location("colocate").url, /^avatar-\w+\.png$/);
	assert.equal(await fetcher.fetchAsset("https://example.com/avatar.png", entry, "disabled"), "https://example.com/avatar.png");

	let importer = new Importer();
	assert.equal(importer.getAvatarReferenceType(), "absolute");
	importer.setAssetReferenceType("disabled");
	assert.equal(importer.getAvatarReferenceType(), "disabled");
	importer.setAvatarReferenceType("relative");
	assert.equal(importer.getAvatarReferenceType(), "relative");
	assert.throws(() => importer.setAvatarReferenceType("nope"), /--avatarrefs/);
});

const WEBMENTIONS_API = "https://webmention.io/api/mentions.jf2?domain=example.com&per-page=100&page=0&token=secret";

function webmention(id, property, target, extra = {}) {
	return {
		type: "entry",
		"wm-id": id,
		"wm-property": property,
		"wm-target": target,
		"wm-source": `https://brid.gy/${id}`,
		"wm-received": "2024-01-05T00:00:00Z",
		author: { type: "card", name: `Author ${id}`, url: `https://author${id}.example/`, photo: "" },
		...extra,
	};
}

function getWebmentionsImporter(t, children, outputFolder) {
	withEnv(t, { WEBMENTION_IO_TOKEN: "secret" });
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(!outputFolder);
	if(outputFolder) {
		importer.setOutputFolder(outputFolder);
	}
	importer.setAssetReferenceType("disabled");
	importer.addSource("webmentions", "https://www.example.com/");
	importer.addDataOverride("webmention", WEBMENTIONS_API.replace("example.com", "www.example.com"), { type: "feed", children });
	return importer;
}

test("Webmentions", async (t) => {
	let importer = getWebmentionsImporter(t, [
		webmention(10, "in-reply-to", "http://www.example.com/one/index.html#comments", { published: "2024-01-03T00:00:00Z", url: "https://site.example/reply", content: { html: "<p>Reply</p>", text: "Reply" } }),
		webmention(11, "mention-of", "https://example.com/one?utm_source=x", { content: { text: "Plain\ntext" } }),
		webmention(13, "in-reply-to", "https://example.com/one/", { "wm-private": true, content: { text: "Secret" } }),
		webmention(14, "like-of", "https://example.com/one/", { url: "https://site.example/like" }),
		webmention(15, "rsvp", "https://example.com/one/", { rsvp: "yes" }),
		webmention(16, "repost-of", "https://example.com/two/"),
	]);

	let [one, two] = (await importer.getEntries()).sort((a, b) => a.url.localeCompare(b.url));

	assert.equal(one.url, "http://www.example.com/one/");
	assert.equal(one.filePath, "one.html");
	assert.deepEqual(one.comments, [
		{ id: 10, parentId: 0, url: "https://site.example/reply", author: { name: "Author 10", url: "https://author10.example/" }, date: new Date("2024-01-03T00:00:00Z"), content: "<p>Reply</p>", type: "reply" },
		{ id: 11, parentId: 0, url: "https://brid.gy/11", author: { name: "Author 11", url: "https://author11.example/" }, date: new Date("2024-01-05T00:00:00Z"), content: "Plain<br>\ntext", type: "mention" },
		{ id: 13, parentId: 0, url: "https://brid.gy/13", private: true, date: new Date("2024-01-05T00:00:00Z"), type: "reply" },
	]);
	assert.deepEqual(one.likes, [{ id: 14, url: "https://site.example/like", date: new Date("2024-01-05T00:00:00Z"), author: { name: "Author 14", url: "https://author14.example/" } }]);
	assert.deepEqual(one.rsvps, [{ id: 15, url: "https://brid.gy/15", date: new Date("2024-01-05T00:00:00Z"), author: { name: "Author 15", url: "https://author15.example/" }, rsvp: "yes" }]);
	assert.equal(two.reposts.length, 1);
	assert.equal(two.comments, undefined);
	assert.equal(importer.getCounts().errors, 0);
});

test("Webmentions require a token", async (t) => {
	withEnv(t, { WEBMENTION_IO_TOKEN: undefined });
	assert.throws(() => new Importer().addSource("webmentions", "example.com"), /WEBMENTION_IO_TOKEN/);
});

test("Webmentions token isn’t logged", async (t) => {
	withEnv(t, { WEBMENTION_IO_TOKEN: "secret" });
	let importer = new Importer();
	importer.addSource("webmentions", "example.com");
	let [source] = importer.getSources();
	assert.equal(source.getLogUrl(WEBMENTIONS_API), WEBMENTIONS_API.replace("token=secret", "token=…"));
});

test("Webmention avatars are downloaded", async (t) => {
	let author = { type: "card", name: "Jane", photo: "https://webmention.io/avatar/jane.png" };
	let importer = getWebmentionsImporter(t, [
		webmention(1, "in-reply-to", "https://www.example.com/one/", { author, content: { html: `<p><img src="https://jane.example/photo.jpg"></p>` } }),
		webmention(2, "like-of", "https://www.example.com/one/", { author }),
	]);
	importer.setAssetReferenceType("relative");
	importer.fetcher.fetchAsset = async (url, entry, refType) => `/${refType}/${new URL(url).pathname.split("/").pop()}`;

	let [entry] = await importer.getEntries();
	assert.deepEqual(entry.comments[0].author, { name: "Jane", avatarUrl: "/absolute/jane.png" });
	// Third-party content is unchanged
	assert.equal(entry.comments[0].content, `<p><img src="https://jane.example/photo.jpg"></p>`);
	assert.deepEqual(entry.likes[0].author, { name: "Jane", avatarUrl: "/absolute/jane.png" });
});

test("Data files are shared by sources", async (t) => {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), "eleventy-import-data-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	let dataFile = path.join(dir, "one.json");

	// Earlier import (no `via`) and a key the importer doesn’t manage
	fs.writeFileSync(dataFile, JSON.stringify({
		custom: true,
		comments: [{ id: 1, parentId: 0, url: "https://mastodon.example/@jane/1", date: "2024-01-01T00:00:00.000Z", content: "Native" }],
	}));

	let webmentions = getWebmentionsImporter(t, [
		webmention(10, "in-reply-to", "https://www.example.com/one/", { url: "https://site.example/reply", content: { text: "Reply" } }),
		// Bridgy backfeed of the native comment
		webmention(11, "in-reply-to", "https://www.example.com/one/", { url: "https://mastodon.example/@jane/1", content: { text: "Duplicate" } }),
		webmention(12, "like-of", "https://www.example.com/one/"),
	], dir);
	await webmentions.toFiles(await webmentions.getEntries());

	// No post is written
	assert.deepEqual(fs.readdirSync(dir), ["one.json"]);
	let data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
	assert.equal(data.custom, true);
	assert.deepEqual(data.comments.map(({ id, via }) => [id, via]), [[1, undefined], [10, "webmention"]]);
	assert.deepEqual(data.likes.map(({ id, via }) => [id, via]), [[12, "webmention"]]);

	// Always rewritten: mentions deleted upstream are removed
	let rerun = getWebmentionsImporter(t, [webmention(12, "like-of", "https://www.example.com/one/")], dir);
	await rerun.toFiles(await rerun.getEntries());
	data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
	assert.deepEqual(data.comments.map(({ id }) => id), [1]);

	// A post source replaces its own (and earlier) comments, webmentions are kept
	await importCommentsTo(dir, [{ id: 2, parentId: 0, date: new Date("2024-01-02T00:00:00Z"), content: "Updated" }]);
	data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
	assert.deepEqual(data.comments.map(({ id, via }) => [id, via]), [[2, "arbitrary"]]);
	assert.deepEqual(data.likes.map(({ id }) => id), [12]);
	assert.equal(data.custom, true);

	// Comments deleted upstream are removed
	await importCommentsTo(dir, []);
	data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
	assert.equal(data.comments, undefined);
	assert.deepEqual(data.likes.map(({ id }) => id), [12]);
});

// Post source with comments at https://example.com/one/ (or a failed comment request, with or without its entry)
async function importCommentsTo(dir, comments, { fail = false, attributed = true, supported = true } = {}) {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setOutputFolder(dir);
	importer.setAssetReferenceType("disabled");
	importer.setSafeMode(false);

	class MySource extends DataSource {
		static TYPE = "arbitrary";
		static SUPPORTS_COMMENTS = supported;

		getType() {
			return "json";
		}

		getUrl() {
			return "https://example.com/posts.json";
		}

		async addComments(entries) {
			for(let entry of entries) {
				if(fail) {
					await this.getOptionalData("https://example.com/comments.json", "json", attributed ? [entry] : undefined);
				}
				entry.comments = comments;
			}
		}
	}

	importer.addSource(MySource);
	let [source] = importer.getSources();
	source.setDataOverride("https://example.com/posts.json", [{ url: "https://example.com/one/", content: "One", contentType: "text" }]);
	source.setDataOverride("https://example.com/comments.json", new Error("Rate limited"));
	await importer.toFiles(await importer.getEntries());
}

test("Data files keep comments when comments are incomplete", async (t) => {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), "eleventy-import-data-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	let dataFile = path.join(dir, "one.json");
	let comment = (id, content) => ({ id, parentId: 0, date: new Date(`2024-01-0${id}T00:00:00Z`), content });
	let read = () => JSON.parse(fs.readFileSync(dataFile, "utf8")).comments.map(({ id, content }) => [id, content]);

	await importCommentsTo(dir, [comment(1, "First"), comment(2, "Second")]);
	assert.deepEqual(read(), [[1, "First"], [2, "Second"]]);

	// A failed request keeps existing comments and updates fetched ones
	await importCommentsTo(dir, [comment(2, "Edited"), comment(3, "Third")], { fail: true });
	assert.deepEqual(read(), [[1, "First"], [2, "Edited"], [3, "Third"]]);

	// A failed request with no comments doesn’t clear them
	await importCommentsTo(dir, [], { fail: true });
	assert.deepEqual(read(), [[1, "First"], [2, "Edited"], [3, "Third"]]);

	// A failed request without entries affects all of the source’s entries
	await importCommentsTo(dir, [], { fail: true, attributed: false });
	assert.deepEqual(read(), [[1, "First"], [2, "Edited"], [3, "Third"]]);

	// Comments disabled: the data file isn’t touched
	await importCommentsTo(dir, [], { supported: false });
	assert.deepEqual(read(), [[1, "First"], [2, "Edited"], [3, "Third"]]);

	// Complete comments replace them
	await importCommentsTo(dir, [comment(3, "Third")]);
	assert.deepEqual(read(), [[3, "Third"]]);
});

test("Comment request failures only affect their own entries", async (t) => {
	let source = new DataSource();
	source.setVerbose(false);
	let [one, two] = [{}, {}];
	source.setDataOverride("https://example.com/one.json", new Error("Rate limited"));
	source.setDataOverride("https://example.com/two.json", { ok: true });

	await source.getOptionalData("https://example.com/one.json", "json", [one]);
	await source.getOptionalData("https://example.com/two.json", "json", [two]);
	assert.equal(DataSource.hasIncompleteComments(one), true);
	assert.equal(DataSource.hasIncompleteComments(two), false);
});

test("Fetch timeout", async (t) => {
	let { createServer } = await import("node:http");
	let server = createServer((req, res) => {
		setTimeout(() => res.end("ok"), 500);
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());

	let fetcher = new Fetcher();
	fetcher.setVerbose(false);
	fetcher.setFetchTimeout(50);
	fetcher.setFetchRetries(0);

	let url = `http://127.0.0.1:${server.address().port}/slow`;
	await assert.rejects(fetcher.fetch(url, {}, { showErrors: false }));
});

test("Fetch retries", async (t) => {
	let { createServer } = await import("node:http");
	let requests = {};
	let server = createServer((req, res) => {
		requests[req.url] = (requests[req.url] || 0) + 1;
		if(req.url === "/flaky" && requests[req.url] < 3) {
			res.statusCode = 503;
			return res.end();
		}
		res.statusCode = req.url === "/missing" ? 404 : 200;
		res.end("ok");
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());

	let fetcher = new Fetcher();
	fetcher.setVerbose(false);
	fetcher.setFetchRetryDelay(1);

	let origin = `http://127.0.0.1:${server.address().port}`;
	assert.equal(await fetcher.fetch(`${origin}/flaky`), "ok");
	assert.equal(requests["/flaky"], 3);
	assert.equal(fetcher.errors.size, 0);

	// Not retried
	await assert.rejects(fetcher.fetch(`${origin}/missing`, {}, { showErrors: false }));
	assert.equal(requests["/missing"], 1);
	assert.equal(fetcher.errors.size, 1);
});

test("Fetch origin limit", async (t) => {
	let { createServer } = await import("node:http");
	let active = 0;
	let maxActive = 0;
	let server = createServer((req, res) => {
		active++;
		maxActive = Math.max(maxActive, active);
		setTimeout(() => {
			active--;
			res.end("ok");
		}, 20);
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());

	let origin = `http://127.0.0.1:${server.address().port}`;
	let fetcher = new Fetcher();
	fetcher.setVerbose(false);
	fetcher.setOriginLimit(origin, { concurrency: 2 });

	await Promise.all([1, 2, 3, 4, 5, 6].map(id => fetcher.fetch(`${origin}/${id}`)));
	assert.equal(maxActive, 2);
});

test("Fetch retry delay headers", async (t) => {
	let rateLimited = headers => ({ cause: { status: 429, headers: new Headers(headers) } });
	let near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1000, `${actual} ≈ ${expected}`);

	// Mastodon
	near(Fetcher.getRetryDelay(rateLimited({ "x-ratelimit-reset": new Date(Date.now() + 60000).toISOString() }), 0, 1000), 60000);
	// Epoch seconds
	near(Fetcher.getRetryDelay(rateLimited({ "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 30) }), 0, 1000), 30000);
	// Seconds from now
	near(Fetcher.getRetryDelay(rateLimited({ "x-ratelimit-reset": "20" }), 0, 1000), 20000);
	// `Retry-After` takes precedence
	near(Fetcher.getRetryDelay(rateLimited({ "retry-after": "5", "x-ratelimit-reset": "20" }), 0, 1000), 5000);
	near(Fetcher.getRetryDelay(rateLimited({ "retry-after": new Date(Date.now() + 8000).toUTCString() }), 0, 1000), 8000);
	// Capped
	assert.equal(Fetcher.getRetryDelay(rateLimited({ "x-ratelimit-reset": new Date(Date.now() + 3600000).toISOString() }), 0, 1000), Fetcher.MAX_RETRY_DELAY);
	assert.equal(Fetcher.getRetryDelay(rateLimited({ "retry-after": "3600" }), 0, 1000, 10000), 10000);
	// Plain object headers (cached response metadata)
	near(Fetcher.getRateLimitResetDelay({ "x-ratelimit-reset": "20" }), 20000);

	// Backoff for a reset in the past, a reset on another status, or no headers
	let backoff = delay => delay >= 4000 && delay <= 5000;
	assert.ok(backoff(Fetcher.getRetryDelay(rateLimited({ "x-ratelimit-reset": new Date(Date.now() - 1000).toISOString() }), 2, 1000)));
	assert.ok(backoff(Fetcher.getRetryDelay({ cause: { status: 503, headers: new Headers({ "x-ratelimit-reset": "20" }) } }, 2, 1000)));
	assert.ok(backoff(Fetcher.getRetryDelay(new Error("Timeout"), 2, 1000)));
});

test("Fetch waits for x-ratelimit-reset on a 429", async (t) => {
	let { createServer } = await import("node:http");
	let requests = 0;
	let server = createServer((req, res) => {
		requests++;
		if(requests === 1) {
			res.writeHead(429, {
				"x-ratelimit-limit": "300",
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": new Date(Date.now() + 1000).toISOString(),
			});
			return res.end();
		}
		res.end("ok");
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());

	let fetcher = new Fetcher();
	fetcher.setVerbose(false);
	fetcher.setFetchRetryDelay(1);

	let start = Date.now();
	assert.equal(await fetcher.fetch(`http://127.0.0.1:${server.address().port}/limited`), "ok");
	assert.equal(requests, 2);
	assert.ok(Date.now() - start >= 900);
});

test("Fetch slows down when x-ratelimit-remaining is low", async (t) => {
	let { createServer } = await import("node:http");
	let server = createServer((req, res) => {
		res.writeHead(200, {
			"x-ratelimit-limit": "300",
			"x-ratelimit-remaining": req.url === "/low" ? "0" : "299",
			"x-ratelimit-reset": new Date(Date.now() + 1000).toISOString(),
		});
		res.end("ok");
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());

	let origin = `http://127.0.0.1:${server.address().port}`;
	let fetcher = new Fetcher();
	fetcher.setVerbose(false);

	let start = Date.now();
	await fetcher.fetch(`${origin}/high`);
	await fetcher.fetch(`${origin}/a`);
	assert.ok(Date.now() - start < 500);

	await fetcher.fetch(`${origin}/low`);
	await fetcher.fetch(`${origin}/b`);
	assert.ok(Date.now() - start >= 900);
});

test("Fetch cache hits skip the origin queue", async (t) => {
	let { createServer } = await import("node:http");
	let requests = 0;
	let server = createServer((req, res) => {
		requests++;
		res.end(JSON.stringify({ id: req.url }));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());

	let directory = fs.mkdtempSync(path.join(os.tmpdir(), "eleventy-import-cache-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

	let origin = `http://127.0.0.1:${server.address().port}`;
	let fetcher = new Fetcher();
	fetcher.setVerbose(false);
	fetcher.setCacheDuration("1h");

	assert.deepEqual(await fetcher.fetch(`${origin}/cached`, { type: "json", directory }), { id: "/cached" });
	assert.equal(requests, 1);

	// A queue that never starts
	fetcher.setOriginLimit(origin, { autoStart: false });
	assert.deepEqual(await fetcher.fetch(`${origin}/cached`, { type: "json", directory }), { id: "/cached" });
	let response = await fetcher.fetch(`${origin}/cached`, { type: "json", directory, returnType: "response" });
	assert.deepEqual(response.body, { id: "/cached" });
	assert.equal(requests, 1);

	// Uncached requests still wait
	let uncached = fetcher.fetch(`${origin}/uncached`, { type: "json", directory });
	let state = await Promise.race([uncached.then(() => "fetched"), new Promise(resolve => setTimeout(() => resolve("queued"), 100))]);
	assert.equal(state, "queued");
	assert.equal(requests, 1);
});

test("Fediverse default origin limit", async (t) => {
	let importer = new Importer();
	importer.setOriginLimit("https://example.social", { concurrency: 1 });
	importer.addSource("fediverse", "@zachleat@zachleat.com");
	importer.addSource("fediverse", "@someone@example.social");

	assert.ok(importer.fetcher.hasOriginLimit("https://zachleat.com"));
	assert.ok(importer.fetcher.hasOriginLimit("https://example.social"));
	assert.equal(importer.fetcher.hasOriginLimit("https://example.com"), false);
});

const INSTAGRAM_API = "https://graph.instagram.com/v23.0";
const INSTAGRAM_FIELDS = "id%2Ccaption%2Cmedia_type%2Cmedia_product_type%2Cmedia_url%2Cpermalink%2Cthumbnail_url%2Ctimestamp%2Clike_count%2Ccomments_count%2Cchildren%7Bid%2Cmedia_type%2Cmedia_url%2Cthumbnail_url%7D";

function getInstagramImporter(t, target = "@ZachLeat") {
	withEnv(t, { INSTAGRAM_ACCESS_TOKEN: "secret" });
	let importer = getImporter();
	importer.addSource("instagram", target);
	importer.addDataOverride("instagram", `${INSTAGRAM_API}/me?fields=username%2Cname%2Cprofile_picture_url&access_token=secret`, {
		username: "zachleat",
		name: "Zach Leatherman",
		profile_picture_url: "https://scontent.cdninstagram.com/avatar.jpg",
	});
	importer.addDataOverride("instagram", `${INSTAGRAM_API}/me/media?fields=${INSTAGRAM_FIELDS}&limit=100&access_token=secret`, {
		data: [
			{ id: "3", media_type: "VIDEO", media_product_type: "REELS", media_url: "https://scontent.cdninstagram.com/reel.mp4", thumbnail_url: "https://scontent.cdninstagram.com/reel.jpg", permalink: "https://www.instagram.com/reel/CCC/", timestamp: "2023-03-01T12:00:00+0000" },
			{ id: "2", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", caption: "Two things", permalink: "https://www.instagram.com/p/BBB/", timestamp: "2023-02-01T12:00:00+0000", children: { data: [
				{ id: "21", media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/two.jpg" },
				// Flagged for copyrighted audio
				{ id: "22", media_type: "VIDEO" },
			] } },
		],
		paging: { next: `${INSTAGRAM_API}/me/media?after=cursor&access_token=secret` },
	});
	importer.addDataOverride("instagram", `${INSTAGRAM_API}/me/media?after=cursor&access_token=secret`, {
		data: [
			{ id: "1", media_type: "IMAGE", media_product_type: "FEED", caption: "Hello @eleven_ty & friends #11ty #café\nSecond line\n\nSee https://www.11ty.dev/docs/. Email me@example.com", media_url: "https://scontent.cdninstagram.com/one.jpg", permalink: "https://www.instagram.com/p/AAA/", timestamp: "2023-01-01T12:00:00+0000", like_count: 9, comments_count: 0 },
		],
	});
	return importer;
}

test("Instagram", async (t) => {
	let importer = getInstagramImporter(t);

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.deepEqual(entries.map(entry => entry.filePath), ["reel/CCC.md", "p/BBB.md", "p/AAA.md"]);

	let [reel, carousel, photo] = entries;
	assert.equal(photo.uuid, "11ty/import::instagram::1");
	assert.equal(photo.type, "instagram");
	assert.equal(photo.url, "https://www.instagram.com/p/AAA/");
	assert.deepEqual(photo.date, new Date("2023-01-01T12:00:00.000Z"));
	assert.deepEqual(photo.metadata, { id: "1", slug: "AAA", postType: "post" });
	assert.deepEqual(photo.counts, { likes: 9 });
	assert.deepEqual(photo.authors, [{ name: "Zach Leatherman", url: "https://www.instagram.com/zachleat/", avatarUrl: "https://scontent.cdninstagram.com/avatar.jpg" }]);
	assert.equal(photo.content, [
		`Hello [@eleven\\_ty](https://www.instagram.com/eleven_ty/) & friends [#11ty](https://www.instagram.com/explore/tags/11ty/) [#café](https://www.instagram.com/explore/tags/caf%C3%A9/)  `,
		`Second line`,
		``,
		`See [https://www.11ty.dev/docs/](https://www.11ty.dev/docs/). Email me@example.com`,
		``,
		`![](https://scontent.cdninstagram.com/one.jpg)`,
	].join("\n"));

	assert.equal(carousel.content, `Two things\n\n![](https://scontent.cdninstagram.com/two.jpg)`);

	assert.equal(reel.metadata.postType, "reel");
	assert.equal(reel.content, `<video controls="" src="https://scontent.cdninstagram.com/reel.mp4" poster="https://scontent.cdninstagram.com/reel.jpg"></video>`);
});

test("Instagram requires a token", async (t) => {
	withEnv(t, { INSTAGRAM_ACCESS_TOKEN: undefined });
	assert.throws(() => new Importer().addSource("instagram", "zachleat"), /INSTAGRAM_ACCESS_TOKEN/);
});

test("Instagram token must match the username", async (t) => {
	let importer = getInstagramImporter(t, "https://www.instagram.com/someone/");
	await assert.rejects(importer.getEntries(), /for @zachleat, not @someone/);
});

test("Instagram token isn’t logged", async (t) => {
	withEnv(t, { INSTAGRAM_ACCESS_TOKEN: "secret" });
	let importer = new Importer();
	importer.addSource("instagram", "zachleat");
	let [source] = importer.getSources();
	assert.equal(source.getLogUrl(`${INSTAGRAM_API}/me/media?after=cursor&access_token=secret`), `${INSTAGRAM_API}/me/media?after=cursor&access_token=…`);
});

test("npm", async (t) => {
	let importer = getImporter();
	importer.addSource("npm", "https://www.npmjs.com/~ZachLeat");

	importer.addDataOverride("npm", "https://registry.npmjs.org/-/user/zachleat/package", { "@11ty/a": "write", b: "write", gone: "write" });
	importer.addDataOverride("npm", "https://registry.npmjs.org/@11ty%2fa", {
		name: "@11ty/a",
		description: "Package A",
		"dist-tags": { latest: "2.0.0" },
		time: { created: "2020-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", "2.0.0": "2025-01-01T00:00:00.000Z" },
		repository: { type: "git", url: "git+https://github.com/11ty/utils.git", directory: "packages/a" },
		license: "MIT",
		readme: `# A\n\n![Logo](./logo.png) See [docs](docs/README.md), [usage](#usage), and <img src="https://example.com/x.png">.\n\n## Usage`,
		versions: {
			"2.0.0": { keywords: ["eleventy"], author: "Zach Leatherman <zach@example.com> (https://zachleat.com/)", deprecated: "Use b" },
		},
	});
	importer.addDataOverride("npm", "https://registry.npmjs.org/b", {
		name: "b",
		description: "Package B & more",
		"dist-tags": { latest: "1.0.0" },
		time: { created: "2010-01-01T00:00:00.000Z", "1.0.0": "2010-01-01T00:00:00.000Z" },
		repository: "gitlab:someone/b",
		readme: "ERROR: No README data found!",
		versions: { "1.0.0": {} },
	});
	importer.addDataOverride("npm", "https://registry.npmjs.org/gone", {
		name: "gone",
		time: { created: "2010-01-01T00:00:00.000Z", unpublished: { time: "2011-01-01T00:00:00.000Z" } },
	});

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.deepEqual(entries.map(entry => entry.filePath), ["@11ty/a.md", "b.md"]);

	let [a, b] = entries;
	assert.equal(a.uuid, "11ty/import::npm::@11ty/a");
	assert.equal(a.url, "https://www.npmjs.com/package/@11ty/a");
	assert.equal(a.title, "@11ty/a");
	assert.deepEqual(a.date, new Date("2020-01-01T00:00:00.000Z"));
	assert.deepEqual(a.dateUpdated, new Date("2025-01-01T00:00:00.000Z"));
	assert.deepEqual(a.authors, [{ name: "Zach Leatherman", url: "https://zachleat.com/" }]);
	assert.deepEqual(a.tags, ["eleventy"]);
	assert.deepEqual(a.metadata, {
		name: "@11ty/a",
		version: "2.0.0",
		license: "MIT",
		repository: "https://github.com/11ty/utils",
		deprecated: "Use b",
		tags: ["eleventy"],
	});
	// Relative URLs resolve to the repository directory
	assert.equal(a.content, [
		"# A",
		"",
		"![Logo](https://raw.githubusercontent.com/11ty/utils/HEAD/packages/a/logo.png) See [docs](https://github.com/11ty/utils/blob/HEAD/packages/a/docs/README.md), [usage](#usage), and ![](https://example.com/x.png).",
		"",
		"## Usage",
	].join("\n"));

	// No author falls back to the profile, no README falls back to the description
	assert.deepEqual(b.authors, [{ name: "zachleat", url: "https://www.npmjs.com/~zachleat" }]);
	assert.equal(b.metadata.repository, "gitlab:someone/b");
	assert.equal(b.content, "Package B & more");
});

test("npm targets", async (t) => {
	assert.deepEqual(Npm.parseTarget("@11ty"), { name: "11ty", isOrg: true });
	assert.deepEqual(Npm.parseTarget("https://www.npmjs.com/org/11ty"), { name: "11ty", isOrg: true });
	assert.deepEqual(Npm.parseTarget("~zachleat"), { name: "zachleat", isOrg: false });
	assert.equal(Npm.getRepositoryUrl("git@github.com:11ty/eleventy.git"), "https://github.com/11ty/eleventy");
	assert.equal(Npm.getRepositoryUrl("11ty/eleventy"), "https://github.com/11ty/eleventy");
});

test("GitHub releases", async (t) => {
	withEnv(t, { GITHUB_TOKEN: undefined });
	let importer = getImporter();
	importer.addSource("github", "https://github.com/11ty/Eleventy");

	let author = { login: "zachleat", html_url: "https://github.com/zachleat", avatar_url: "https://avatars.githubusercontent.com/u/39355" };
	importer.addDataOverride("github", "https://api.github.com/repos/11ty/eleventy/releases?per_page=100&page=1", [
		{ id: 2, tag_name: "v3.0.0-beta.1", name: "", prerelease: true, html_url: "https://github.com/11ty/eleventy/releases/tag/v3.0.0-beta.1", author, created_at: "2024-02-01T00:00:00Z", published_at: "2024-02-01T00:00:00Z", body_html: "<p>Beta <a href=\"https://www.11ty.dev/\">docs</a></p>" },
		{ id: 1, tag_name: "v2.0.0", name: "Eleventy v2.0.0", prerelease: false, html_url: "https://github.com/11ty/eleventy/releases/tag/v2.0.0", author, created_at: "2023-02-01T00:00:00Z", published_at: "2023-02-08T00:00:00Z", body_html: "<h2>Features</h2><ul><li>Fast</li></ul>" },
	]);
	importer.addDataOverride("github", "https://api.github.com/repos/11ty/eleventy/releases?per_page=100&page=2", []);

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.deepEqual(entries.map(entry => entry.filePath), ["releases/v3.0.0-beta.1.md", "releases/v2.0.0.md"]);

	let [beta, stable] = entries;
	assert.equal(beta.title, "v3.0.0-beta.1");
	assert.deepEqual(beta.metadata, { id: 2, tag: "v3.0.0-beta.1", prerelease: true });
	assert.equal(beta.content, "Beta [docs](https://www.11ty.dev/)");

	assert.equal(stable.uuid, "11ty/import::github::11ty/eleventy::1");
	assert.equal(stable.title, "Eleventy v2.0.0");
	assert.deepEqual(stable.date, new Date("2023-02-08T00:00:00Z"));
	assert.deepEqual(stable.authors, [{ name: "zachleat", url: "https://github.com/zachleat", avatarUrl: "https://avatars.githubusercontent.com/u/39355" }]);
	assert.equal(stable.content, "## Features\n\n-   Fast");

	let [source] = importer.getSources();
	assert.equal(source.getHeaders("https://api.github.com/x").Accept, "application/vnd.github.html+json");
	assert.equal(source.getHeaders("https://api.github.com/x").Authorization, undefined);
});

test("GitHub gists", async (t) => {
	withEnv(t, { GITHUB_TOKEN: "secret" });
	let importer = getImporter();
	importer.addSource("github-gist", "@ZachLeat");

	let owner = { login: "zachleat", html_url: "https://github.com/zachleat" };
	importer.addDataOverride("github-gist", "https://api.github.com/users/zachleat/gists?per_page=100&page=1", [{ id: "abc" }]);
	importer.addDataOverride("github-gist", "https://api.github.com/users/zachleat/gists?per_page=100&page=2", []);
	importer.addDataOverride("github-gist", "https://api.github.com/gists/abc", {
		id: "abc",
		description: "",
		html_url: "https://gist.github.com/abc",
		owner,
		created_at: "2020-01-01T00:00:00Z",
		updated_at: "2021-01-01T00:00:00Z",
		files: {
			"notes.md": { filename: "notes.md", language: "Markdown", content: "# Notes\n\nHi" },
			"a.js": { filename: "a.js", language: "JavaScript", content: "let a = 1 < 2;" },
			"big.txt": { filename: "big.txt", language: "Text", truncated: true, content: "…", raw_url: "https://gist.githubusercontent.com/zachleat/abc/raw/big.txt" },
		},
	});

	let [gist] = await importer.getEntries({ contentType: "markdown" });
	assert.equal(gist.filePath, "abc.md");
	assert.equal(gist.uuid, "11ty/import::github-gist::abc");
	assert.equal(gist.title, "notes.md");
	assert.deepEqual(gist.dateUpdated, new Date("2021-01-01T00:00:00Z"));
	assert.deepEqual(gist.authors, [{ name: "zachleat", url: "https://github.com/zachleat" }]);
	assert.deepEqual(gist.metadata, { id: "abc", files: ["notes.md", "a.js", "big.txt"] });
	assert.equal(gist.content, [
		"## notes.md",
		"",
		"# Notes",
		"",
		"Hi",
		"",
		"## a.js",
		"",
		"```javascript",
		"let a = 1 < 2;",
		"```",
		"",
		"## big.txt",
		"",
		"[big.txt](https://gist.githubusercontent.com/zachleat/abc/raw/big.txt)",
	].join("\n"));

	let [source] = importer.getSources();
	assert.equal(source.getHeaders("https://api.github.com/x").Authorization, "Bearer secret");
	assert.deepEqual(source.getHeaders("https://example.com/"), {});
});

test("GitHub repositories", async (t) => {
	withEnv(t, { GITHUB_TOKEN: undefined });
	let importer = getImporter();
	importer.addSource("github", "11ty");

	let owner = { login: "11ty", html_url: "https://github.com/11ty" };
	importer.addDataOverride("github", "https://api.github.com/users/11ty/repos?type=owner&sort=created&direction=desc&per_page=100&page=1", [
		{ full_name: "11ty/eleventy", name: "eleventy", html_url: "https://github.com/11ty/eleventy", owner, description: "A simpler site generator.", created_at: "2017-11-01T00:00:00Z", pushed_at: "2026-10-01T00:00:00Z", stargazers_count: 18000, forks_count: 500, language: "JavaScript", license: { spdx_id: "MIT" }, homepage: "https://www.11ty.dev/", topics: ["ssg"] },
		{ full_name: "11ty/fork", name: "fork", fork: true, html_url: "https://github.com/11ty/fork", owner, created_at: "2020-01-01T00:00:00Z" },
		{ full_name: "11ty/empty", name: "empty", html_url: "https://github.com/11ty/empty", owner, description: "No README", created_at: "2016-01-01T00:00:00Z", pushed_at: "2016-01-01T00:00:00Z", stargazers_count: 0, archived: true, license: { spdx_id: "NOASSERTION" } },
	]);
	importer.addDataOverride("github", "https://api.github.com/users/11ty/repos?type=owner&sort=created&direction=desc&per_page=100&page=2", []);
	importer.addDataOverride("github", "https://api.github.com/repos/11ty/eleventy/readme", "# Eleventy\n\n![Logo](./docs/logo.png) See [docs](docs/README.md).");
	importer.addDataOverride("github", "https://api.github.com/repos/11ty/empty/readme", new Error("Not Found"));

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.deepEqual(entries.map(entry => entry.filePath), ["eleventy.md", "empty.md"]);

	let [eleventy, empty] = entries;
	assert.equal(eleventy.uuid, "11ty/import::github::11ty/eleventy");
	assert.equal(eleventy.description, "A simpler site generator.");
	assert.deepEqual(eleventy.dateUpdated, new Date("2026-10-01T00:00:00Z"));
	assert.deepEqual(eleventy.tags, ["ssg"]);
	assert.deepEqual(eleventy.metadata, { name: "11ty/eleventy", language: "JavaScript", license: "MIT", homepage: "https://www.11ty.dev/", tags: ["ssg"] });
	assert.deepEqual(eleventy.counts, { stars: 18000, forks: 500 });
	assert.equal(eleventy.content, "# Eleventy\n\n![Logo](https://raw.githubusercontent.com/11ty/eleventy/HEAD/docs/logo.png) See [docs](https://github.com/11ty/eleventy/blob/HEAD/docs/README.md).");

	assert.deepEqual(empty.metadata, { name: "11ty/empty", archived: true });
	assert.equal(empty.counts, undefined);
	assert.equal(empty.content, "No README");

	let [source] = importer.getSources();
	assert.equal(source.getHeaders("https://api.github.com/repos/11ty/eleventy/readme").Accept, "application/vnd.github.raw+json");
});

test("GitHub repository issue and pull request counts", async (t) => {
	withEnv(t, { GITHUB_TOKEN: "secret" });
	let importer = getImporter();
	importer.addSource("github", "11ty");

	let owner = { login: "11ty", html_url: "https://github.com/11ty" };
	importer.addDataOverride("github", "https://api.github.com/users/11ty/repos?type=owner&sort=created&direction=desc&per_page=100&page=1", [
		{ full_name: "11ty/eleventy", name: "eleventy", html_url: "https://github.com/11ty/eleventy", owner, created_at: "2017-11-01T00:00:00Z", stargazers_count: 18000 },
		{ full_name: "11ty/fork", name: "fork", fork: true, html_url: "https://github.com/11ty/fork", owner, created_at: "2020-01-01T00:00:00Z" },
		{ full_name: "11ty/empty", name: "empty", html_url: "https://github.com/11ty/empty", owner, created_at: "2016-01-01T00:00:00Z" },
	]);
	importer.addDataOverride("github", "https://api.github.com/users/11ty/repos?type=owner&sort=created&direction=desc&per_page=100&page=2", []);
	importer.addDataOverride("github", "https://api.github.com/repos/11ty/eleventy/readme", "# Eleventy");
	importer.addDataOverride("github", "https://api.github.com/repos/11ty/empty/readme", "# Empty");
	importer.addDataOverride("github", "https://api.github.com/graphql", {
		data: {
			r0: { issues: { totalCount: 1200 }, pullRequests: { totalCount: 800 } },
			r1: { issues: { totalCount: 0 }, pullRequests: { totalCount: 0 } },
		},
	});

	let [source] = importer.getSources();
	let requests = [];
	let getData = source.getData.bind(source);
	source.getData = (url, type, showErrors, fetchOptions) => {
		if(fetchOptions?.body) {
			requests.push({ url, ...fetchOptions });
		}
		return getData(url, type, showErrors, fetchOptions);
	};

	let [eleventy, empty] = await importer.getEntries({ contentType: "markdown" });
	assert.deepEqual(eleventy.counts, { stars: 18000, issues: 1200, pullRequests: 800 });
	assert.equal(empty.counts, undefined);

	// One request per page, forks are skipped
	assert.equal(requests.length, 1);
	assert.equal(requests[0].method, "POST");
	assert.equal(JSON.parse(requests[0].body).query, `{ r0: repository(owner: "11ty", name: "eleventy") { issues { totalCount } pullRequests { totalCount } } r1: repository(owner: "11ty", name: "empty") { issues { totalCount } pullRequests { totalCount } } }`);
});

test("GitHub repository issue counts are skipped when the request fails", async (t) => {
	withEnv(t, { GITHUB_TOKEN: "secret" });
	let importer = getImporter();
	importer.addSource("github", "11ty");

	let owner = { login: "11ty", html_url: "https://github.com/11ty" };
	importer.addDataOverride("github", "https://api.github.com/users/11ty/repos?type=owner&sort=created&direction=desc&per_page=100&page=1", [
		{ full_name: "11ty/eleventy", name: "eleventy", html_url: "https://github.com/11ty/eleventy", owner, created_at: "2017-11-01T00:00:00Z", stargazers_count: 18000, forks_count: 500 },
	]);
	importer.addDataOverride("github", "https://api.github.com/users/11ty/repos?type=owner&sort=created&direction=desc&per_page=100&page=2", []);
	importer.addDataOverride("github", "https://api.github.com/repos/11ty/eleventy/readme", "# Eleventy");
	importer.addDataOverride("github", "https://api.github.com/graphql", new Error("Unauthorized"));

	let [eleventy] = await importer.getEntries({ contentType: "markdown" });
	assert.deepEqual(eleventy.counts, { stars: 18000, forks: 500 });
});

test("GitHub targets", async (t) => {
	assert.deepEqual(GitHub.parseTarget("11ty/eleventy"), { owner: "11ty", repo: "eleventy" });
	assert.deepEqual(GitHub.parseTarget("https://github.com/11ty/eleventy.git"), { owner: "11ty", repo: "eleventy" });
	assert.deepEqual(GitHub.parseTarget("11ty"), { owner: "11ty", repo: undefined });
	assert.deepEqual(GitHub.parseTarget("https://github.com/ZachLeat"), { owner: "zachleat", repo: undefined });
	assert.equal(GitHubGist.getUsername("https://gist.github.com/zachleat"), "zachleat");
});

async function importPostTo(dir, content, { overwrite = false } = {}) {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setOutputFolder(dir);
	importer.setAssetReferenceType("disabled");
	importer.setSafeMode(!overwrite);

	class MySource extends DataSource {
		static TYPE = "arbitrary";

		getType() {
			return "json";
		}

		getUrl() {
			return "https://example.com/posts.json";
		}
	}

	importer.addSource(MySource);
	let [source] = importer.getSources();
	source.setDataOverride("https://example.com/posts.json", [{ url: "https://example.com/one/", content, contentType: "text" }]);
	await importer.toFiles(await importer.getEntries({ target: "fs" }));
	return importer.getCounts().files;
}

test("Unedited files are updated, locally modified files are skipped", async (t) => {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), "eleventy-import-hash-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	let postFile = path.join(dir, "one.html");
	let read = () => fs.readFileSync(postFile, "utf8");

	assert.equal(await importPostTo(dir, "One"), 1);
	assert.match(read(), /^  importHash: '?[a-f0-9]{16}'?$/m);
	assert.equal(Importer.isLocallyModified(postFile), false);

	// Unchanged upstream content isn’t rewritten (line endings are ignored)
	assert.equal(await importPostTo(dir, "One"), 0);
	fs.writeFileSync(postFile, read().replace(/\n/g, "\r\n"));
	assert.equal(await importPostTo(dir, "One"), 0);
	assert.match(read(), /\r\n/);

	// Unedited files are updated
	assert.equal(await importPostTo(dir, "Two"), 1);
	assert.match(read(), /Two\n$/);

	// Local edits are kept
	fs.writeFileSync(postFile, read().replace("Two", "Edited"));
	assert.equal(Importer.isLocallyModified(postFile), true);
	assert.equal(await importPostTo(dir, "Three"), 0);
	assert.match(read(), /Edited\n$/);

	// Unless overwritten
	assert.equal(await importPostTo(dir, "Three", { overwrite: true }), 1);
	assert.match(read(), /Three\n$/);
	assert.equal(Importer.isLocallyModified(postFile), false);

	// Files without a hash (earlier versions) are treated as edited
	fs.writeFileSync(postFile, read().replace(/^\s*importHash: .*\n/m, ""));
	assert.equal(await importPostTo(dir, "Four"), 0);
});

test("CodePen", async (t) => {
	withEnv(t, { CODEPEN_API_KEY: "cp_user_secret" });
	let importer = getImporter();
	importer.addSource("codepen", "https://codepen.io/example");

	importer.addDataOverride("codepen", "https://api.codepen.io/v2/pens?access=Public&per_page=100&page=1", [{
		id: "abcXYZ",
		title: "A Pen",
		description: "A description",
		tags: ["css"],
		access: "Public",
		editor: "Classic",
		created_at: "2024-10-01T12:00:00Z",
		updated_at: "2024-10-02T12:00:00Z",
		screenshot_urls: { large: "https://example.codepen.dev/800.jpg" },
	}]);
	importer.addDataOverride("codepen", "https://api.codepen.io/v2/pens?access=Public&per_page=100&page=2", []);
	importer.addDataOverride("codepen", "https://api.codepen.io/v2/pens/abcXYZ/files", [
		{ path: "/index.html", name: "index.html", is_binary: false, content: "<p>Hi</p>\n" },
		{ path: "/style.css", name: "style.css", is_binary: false, content: "p { color: red; }" },
		// Empty panels are skipped
		{ path: "/script.js", name: "script.js", is_binary: false, content: " " },
	]);

	let [entry] = await importer.getEntries({ contentType: "markdown" });

	assert.equal(entry.uuid, "11ty/import::codepen::abcXYZ");
	assert.equal(entry.title, "A Pen");
	assert.equal(entry.url, "https://codepen.io/example/pen/abcXYZ");
	assert.equal(entry.filePath, "abcXYZ.md");
	assert.equal(entry.description, "A description");
	assert.deepEqual(entry.tags, ["css"]);
	assert.deepEqual(entry.date, new Date("2024-10-01T12:00:00Z"));
	assert.deepEqual(entry.dateUpdated, new Date("2024-10-02T12:00:00Z"));
	assert.deepEqual(entry.authors, [{ name: "example", url: "https://codepen.io/example" }]);
	assert.deepEqual(entry.metadata, {
		id: "abcXYZ",
		editor: "Classic",
		files: ["/index.html", "/style.css"],
		media: { featuredImage: "https://example.codepen.dev/800.jpg" },
		tags: ["css"],
	});
	assert.equal(entry.content, [
		"A description",
		"",
		"## index.html",
		"",
		"```html",
		"<p>Hi</p>",
		"```",
		"",
		"## style.css",
		"",
		"```css",
		"p {",
		"  color: red;",
		"}",
		"```",
	].join("\n"));
});

test("CodePen requires an API key", async (t) => {
	withEnv(t, { CODEPEN_API_KEY: undefined });
	assert.throws(() => getImporter().addSource("codepen", "example"), /CODEPEN_API_KEY/);
});

test("--prune removes unreferenced asset files from earlier imports", async (t) => {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), "eleventy-import-prune-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

	let run = async ({ prune = true, dryRun = false } = {}) => {
		let importer = new Importer();
		importer.setVerbose(false);
		importer.setOutputFolder(dir);
		importer.setAssetReferenceType("colocate");
		importer.setPruneAssets(prune);
		importer.setDryRun(dryRun);

		class MySource extends DataSource {
			static TYPE = "arbitrary";

			getType() {
				return "json";
			}

			getUrl() {
				return "https://example.com/posts.json";
			}

			async getLocalAsset() {
				return { body: Buffer.from("png"), contentType: "image/png" };
			}
		}

		importer.addSource(MySource);
		let [source] = importer.getSources();
		source.setDataOverride("https://example.com/posts.json", [{ url: "https://example.com/one/", content: `<img src="https://example.com/new.png">`, contentType: "html" }]);
		await importer.toFiles(await importer.getEntries({ contentType: "html", target: "fs" }));
		return importer.getCounts().pruned;
	};

	await run({ prune: false });
	let postDir = path.dirname(fs.globSync("**/*.html", { cwd: dir }).map(file => path.join(dir, file))[0]);
	let list = () => fs.readdirSync(postDir).sort();
	let [newAsset] = list().filter(name => name.startsWith("new-"));

	fs.writeFileSync(path.join(postDir, "old-AAAAAAAAAAAA.png"), "old");
	fs.writeFileSync(path.join(postDir, "linked-BBBBBBBBBBBB.png"), "linked");
	fs.writeFileSync(path.join(postDir, "notes.md"), "![](linked-BBBBBBBBBBBB.png)");
	fs.writeFileSync(path.join(postDir, "handmade.png"), "handmade");
	let before = list();

	assert.equal(await run({ dryRun: true }), 1);
	assert.deepEqual(list(), before);

	assert.equal(await run(), 1);
	assert.deepEqual(list(), before.filter(name => name !== "old-AAAAAAAAAAAA.png"));
	assert.ok(list().includes(newAsset));
});

test("Letterboxd user", async (t) => {
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");
	importer.addSource("letterboxd", "@zachleat");
	importer.addDataOverride("letterboxd", "https://letterboxd.com/zachleat/rss/", Fetcher.parseXml(fs.readFileSync("./test/sources/letterboxd-user.xml", "utf8")));

	let [watch, review, rewatch, list] = await importer.getEntries({ contentType: "html" });

	assert.equal(watch.type, "letterboxd");
	assert.equal(watch.uuid, "11ty/import::letterboxd::letterboxd-watch-1535301824");
	assert.deepEqual(watch.authors, [{ name: "Zach", url: "https://letterboxd.com/zachleat/" }]);
	assert.equal(watch.metadata.rating, undefined);
	assert.equal(watch.metadata.media.featuredImage, "https://a.ltrbxd.com/resized/film-poster/1/0/2/4/5/6/2/1024562-materialists-0-600-0-900-crop.jpg?v=ae3470f333");
	assert.ok(!watch.content.includes("<img"));

	assert.equal(review.content, "<p>“Video games!!”</p>");
	assert.deepEqual(review.metadata, {
		letterboxdType: "review",
		media: { featuredImage: "https://a.ltrbxd.com/resized/film-poster/1/3/0/2/7/1/7/1302717-untitled-resident-evil-reboot-0-600-0-900-crop.jpg?v=a688bf1bc7" },
		film: { title: "Resident Evil", year: 2026, tmdbId: 1423191 },
		rating: 4,
		liked: true,
		rewatch: false,
		watchedDate: "2026-10-07",
	});

	assert.equal(rewatch.metadata.rewatch, true);
	assert.equal(rewatch.filePath, "zachleat/film/the-goonies/1.html");

	assert.deepEqual(list.metadata, { letterboxdType: "list" });
	assert.ok(list.content.includes(`<a href="https://letterboxd.com/film/edge-of-tomorrow/">Edge of Tomorrow</a>`));
});

const FLICKR_PHOTOS_URL = "https://api.flickr.com/services/rest/?method=flickr.people.getPublicPhotos&user_id=12345678%40N00&extras=description%2Cdate_upload%2Cdate_taken%2Clast_update%2Ctags%2Cgeo%2Cmedia%2Cpath_alias%2Cowner_name%2Curl_o%2Curl_k%2Curl_h%2Curl_l%2Curl_c%2Curl_z%2Cviews%2Ccount_faves%2Ccount_comments&per_page=500&page=PAGE&format=json&nojsoncallback=1&api_key=secret";

function flickrPhoto(id, extra = {}) {
	return {
		id: String(id),
		owner: "12345678@N00",
		title: `Photo ${id}`,
		description: { _content: "" },
		dateupload: "1704067200",
		lastupdate: "1704153600",
		datetaken: "2023-12-31 09:30:00",
		ownername: "Zach",
		pathalias: "zachleat",
		tags: "",
		latitude: 0,
		longitude: 0,
		media: "photo",
		url_l: `https://live.staticflickr.com/1/${id}_l.jpg`,
		...extra,
	};
}

function getFlickrImporter(t, user, pages) {
	withEnv(t, { FLICKR_API_KEY: "secret" });
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");
	importer.addSource("flickr", user);
	for(let [index, photo] of pages.entries()) {
		importer.addDataOverride("flickr", FLICKR_PHOTOS_URL.replace("PAGE", index + 1), { photos: { page: index + 1, pages: pages.length, photo }, stat: "ok" });
	}
	return importer;
}

test("Flickr user", async (t) => {
	let importer = getFlickrImporter(t, "https://www.flickr.com/photos/zachleat/", [
		[
			flickrPhoto(2, {
				description: { _content: `Line one\nwith <a href="https://example.com/">a link</a>` },
				tags: "sunset beach",
				latitude: "37.7749",
				longitude: "-122.4194",
				url_o: "https://live.staticflickr.com/1/2_o.jpg",
				views: "42",
				count_faves: "3",
				count_comments: "0",
			}),
		],
		[
			flickrPhoto(1, { media: "video", title: "" }),
		],
	]);
	importer.addDataOverride("flickr", "https://api.flickr.com/services/rest/?method=flickr.urls.lookupUser&url=https%3A%2F%2Fwww.flickr.com%2Fphotos%2Fzachleat%2F&format=json&nojsoncallback=1&api_key=secret", { user: { id: "12345678@N00" }, stat: "ok" });

	let [photo, video] = await importer.getEntries({ contentType: "html" });

	assert.equal(photo.uuid, "11ty/import::flickr::2");
	assert.deepEqual(photo.counts, { likes: 3, views: 42 });
	assert.equal(video.counts, undefined);
	assert.equal(photo.url, "https://www.flickr.com/photos/zachleat/2/");
	assert.equal(photo.title, "Photo 2");
	assert.deepEqual(photo.date, new Date("2024-01-01T00:00:00Z"));
	assert.deepEqual(photo.dateUpdated, new Date("2024-01-02T00:00:00Z"));
	assert.deepEqual(photo.authors, [{ name: "Zach", url: "https://www.flickr.com/photos/zachleat/" }]);
	assert.deepEqual(photo.tags, ["sunset", "beach"]);
	assert.equal(photo.content, `<p><img src="https://live.staticflickr.com/1/2_o.jpg" alt="Photo 2"></p>\n<p>Line one<br>\nwith <a href="https://example.com/">a link</a></p>`);
	assert.deepEqual(photo.metadata, {
		id: "2",
		slug: "2",
		media: { featuredImage: "https://live.staticflickr.com/1/2_o.jpg" },
		dateTaken: "2023-12-31 09:30:00",
		geo: { latitude: 37.7749, longitude: -122.4194 },
		tags: ["sunset", "beach"],
	});

	assert.equal(video.metadata.postType, "video");
	assert.equal(video.metadata.geo, undefined);
	assert.ok(video.content.startsWith(`<p><a href="https://www.flickr.com/photos/zachleat/1/"><img src="https://live.staticflickr.com/1/1_l.jpg"`));
	assert.equal(importer.getCounts().errors, 0);
});

test("Flickr NSID skips the user lookup", async (t) => {
	let importer = getFlickrImporter(t, "12345678@N00", [[flickrPhoto(1)]]);
	let entries = await importer.getEntries({ contentType: "html" });
	assert.equal(entries.length, 1);
});

test("Flickr requires an API key", async (t) => {
	withEnv(t, { FLICKR_API_KEY: undefined });
	assert.throws(() => new Importer().addSource("flickr", "zachleat"), /FLICKR_API_KEY/);
});

test("Flickr API key isn’t logged", async (t) => {
	withEnv(t, { FLICKR_API_KEY: "secret" });
	let importer = new Importer();
	importer.addSource("flickr", "zachleat");
	let [source] = importer.getSources();
	assert.equal(source.getLogUrl(FLICKR_PHOTOS_URL), FLICKR_PHOTOS_URL.replace("api_key=secret", "api_key=…"));
});

test("Flickr API errors throw", async (t) => {
	withEnv(t, { FLICKR_API_KEY: "secret" });
	let importer = new Importer();
	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.addSource("flickr", "12345678@N00");
	importer.addDataOverride("flickr", FLICKR_PHOTOS_URL.replace("PAGE", 1), { stat: "fail", code: 100, message: "Invalid API Key (Key has invalid format)" });
	await assert.rejects(importer.getEntries(), /Flickr API error 100/);
});
