import test from 'node:test';
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

import { Importer } from "../src/Importer.js";
import { DataSource } from "../src/DataSource.js";
import { Persist } from "../src/Persist.js";
import { Fetcher } from "../src/Fetcher.js";

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

function getWordPressPagedUrl(restBase, pageNumber) {
	let status = process.env.WORDPRESS_USERNAME ? "&status=publish%2Cdraft" : "";
	return `https://blog.fontawesome.com/wp-json/wp/v2/${restBase}/?page=${pageNumber}&per_page=100&_embed=wp%3Afeaturedmedia${status}`;
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

	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/types/", {
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

test("Hosted WordPress with a custom domain and post types, issue #16", async (t) => {
	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpress-hosted", {
		url: "https://example.com/",
		postTypes: "posts,pages",
	});

	let post = {
		ID: 1,
		guid: "https://example.com/?p=1",
		URL: "https://example.com/2025/06/hello/",
		type: "post",
		slug: "hello",
		title: "Hello",
		content: "<p>Hello</p>",
		date: "2025-06-11T00:00:00+00:00",
		modified: "2025-06-11T00:00:00+00:00",
		status: "publish",
		author: { name: "Zach", profile_URL: "https://example.com/zach", avatar_URL: "" },
		categories: { News: {} },
		tags: {},
	};
	let page = {
		...post,
		ID: 2,
		guid: "https://example.com/?page_id=2",
		URL: "https://example.com/about/",
		type: "page",
		slug: "about",
		title: "About",
		categories: undefined,
		tags: undefined,
	};

	let getUrl = (type, pageNumber) => `https://public-api.wordpress.com/rest/v1.1/sites/example.com/posts/?type=${type}&page=${pageNumber}&number=100`;
	importer.addDataOverride("wordpressapi-hosted", getUrl("post", 1), { posts: [post] });
	importer.addDataOverride("wordpressapi-hosted", getUrl("post", 2), { posts: [] });
	importer.addDataOverride("wordpressapi-hosted", getUrl("page", 1), { posts: [page] });
	importer.addDataOverride("wordpressapi-hosted", getUrl("page", 2), { posts: [] });

	let entries = await importer.getEntries({ contentType: "html" });
	assert.deepEqual(entries.map(entry => entry.metadata.postType), ["post", "page"]);
	assert.deepEqual(entries.map(entry => entry.title), ["Hello", "About"]);
	assert.deepEqual(entries[0].metadata.categories, ["News"]);
	assert.deepEqual(entries[1].metadata.categories, []);
});

test("postTypes is not supported by other source types", async (t) => {
	let importer = new Importer();

	assert.throws(() => {
		importer.addSource("rss", { url: "https://example.com/feed.xml", postTypes: "pages" });
	});
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
