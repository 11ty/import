import "dotenv/config";
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

	importer.addSource("youtubeUser", "UCskGTioqrMBcw8pd14_334A");

	let stubContent = fs.readFileSync("./test/sources/youtube-user.xml");
	importer.addDataOverride("youtube", "https://www.youtube.com/feeds/videos.xml?channel_id=UCskGTioqrMBcw8pd14_334A", Fetcher.parseXml(stubContent.toString("utf8")));

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 15);

	let [post] = entries;

	assert.deepEqual(Object.keys(post).sort(), ["authors", "content", "contentType", "date", "dateUpdated", "filePath", "outputContentType", "title", "type", "url", "uuid"]);
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

test("WordPress import", async (t) => {

	let importer = new Importer();

	importer.setVerbose(false);
	importer.setDryRun(true);
	importer.setAssetReferenceType("disabled");

	importer.addSource("wordpress", "https://blog.fontawesome.com/");

	if(process.env.WORDPRESS_USERNAME) {
		importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/posts/?page=1&per_page=100&status=publish%2Cdraft", require("./sources/blog-awesome-posts.json"));
		importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/posts/?page=2&per_page=100&status=publish%2Cdraft", []);
	} else {
		importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/posts/?page=1&per_page=100", require("./sources/blog-awesome-posts.json"));
		importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/posts/?page=2&per_page=100", []);
	}

	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/categories/1", require("./sources/blog-awesome-categories.json"));
	importer.addDataOverride("wordpress", "https://blog.fontawesome.com/wp-json/wp/v2/users/155431370", require("./sources/blog-awesome-author.json"));

	importer.addPreserved(".c-button--primary");

	let entries = await importer.getEntries({ contentType: "markdown" });
	assert.equal(entries.length, 1);

	let [post] = entries;
	assert.deepEqual(Object.keys(post).sort(), ["authors", "content", "contentType", "date", "dateUpdated", "filePath", "metadata", "outputContentType", "status", "title", "type", "url", "uuid"]);

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
