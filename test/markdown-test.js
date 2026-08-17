import "dotenv/config";
import test from 'node:test';
import assert from "node:assert/strict";

import { MarkdownToHtml } from "../src/MarkdownToHtml.js";

const sampleEntry = {
	filePath: "/index.md"
};

test("Markdown Code", async (t) => {
	let md = new MarkdownToHtml();

	assert.equal(await md.toMarkdown(`&lt;div&gt;`, sampleEntry), `\\<div>`);
	assert.equal(await md.toMarkdown(`This is a &lt;div&gt;`, sampleEntry), `This is a \\<div>`);
	assert.equal(await md.toMarkdown(`<div>This is a test</div>`, sampleEntry), `This is a test`);
});

test("Markdown HTML", async (t) => {
	let md = new MarkdownToHtml();

	assert.equal(await md.toMarkdown(`This is a <del>test</del>`, sampleEntry), `This is a <del>test</del>`);
	assert.equal(await md.toMarkdown(`This is a <ins>test</ins>`, sampleEntry), `This is a <ins>test</ins>`);
	assert.equal(await md.toMarkdown(`<table><tbody><tr><td></td></tr></tbody></table>`, sampleEntry), `<table><tbody><tr><td></td></tr></tbody></table>`);
});

test("Keep <i> elements with `fa-` classes", async (t) => {
	let md = new MarkdownToHtml();

	assert.equal(await md.toMarkdown(`This is an icon  <i class="fas fa-sparkles"></i>`, sampleEntry), `This is an icon<i class="fas fa-sparkles"></i>`);
	assert.equal(await md.toMarkdown(`This is an icon <i class="fas fa-sparkles"></i>`, sampleEntry), `This is an icon<i class="fas fa-sparkles"></i>`);
	assert.equal(await md.toMarkdown(`This is an icon<i class="fas fa-sparkles"></i>`, sampleEntry), `This is an icon<i class="fas fa-sparkles"></i>`);
	assert.equal(await md.toMarkdown(`<i class="fas fa-sparkles"></i>  This is an icon`, sampleEntry), `<i class="fas fa-sparkles"></i>This is an icon`);
	assert.equal(await md.toMarkdown(`<i class="fas fa-sparkles"></i> This is an icon`, sampleEntry), `<i class="fas fa-sparkles"></i>This is an icon`);
	assert.equal(await md.toMarkdown(`<i class="fas fa-sparkles"></i>This is an icon`, sampleEntry), `<i class="fas fa-sparkles"></i>This is an icon`);
});

test("Keep <i> elements with `fa-` classes (nested) in an empty parent", async (t) => {
	let md = new MarkdownToHtml();

	assert.equal(await md.toMarkdown(`<p class="has-text-align-center has-text-color has-link-color has-x-large-font-size wp-elements-007b58a50552546af72f2ebf87b1b426" style="color:#e599f7"><i class="fas fa-sparkles"></i></p>`, sampleEntry), `<i class="fas fa-sparkles"></i>`);

	assert.equal(await md.toMarkdown(`<div><p class="has-text-align-center has-text-color has-link-color has-x-large-font-size wp-elements-007b58a50552546af72f2ebf87b1b426" style="color:#e599f7"><i class="fas fa-sparkles"></i></p></div>`, sampleEntry), `<i class="fas fa-sparkles"></i>`);
});

test("If the <i> has content, italics takes precedence", async (t) => {
	let md = new MarkdownToHtml();
	assert.equal(await md.toMarkdown(`<i class="fas fa-sparkles">Testing</i>`, sampleEntry), `_Testing_`);
});

test("Preserve other classes", async (t) => {
	let md = new MarkdownToHtml();
	md.addPreservedSelector(".c-button--primary");

	assert.equal(await md.toMarkdown(`<a href="https://www.podcastawesome.com/" class="c-button c-button--primary" class="wp-block-fontawesome-blog-icon-button"><i class="fas fa-arrow-right c-button__icon"></i>Listen to the Full Episode!</a>`, sampleEntry), `<a href="https://www.podcastawesome.com/" class="c-button c-button--primary"><i class="fas fa-arrow-right c-button__icon"></i>Listen to the Full Episode!</a>`);
});

test("newlines in <img alt>", async (t) => {
	let md = new MarkdownToHtml();

	assert.equal(await md.toMarkdown(`<img data-recalc-dims="1" loading="lazy" decoding="async" width="720" height="236" data-attachment-id="8293" data-permalink="https://blog.fontawesome.com/?attachment_id=8293" data-orig-file="https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2025/03/v7-announce-plans-1.png?fit=1920%2C630&amp;ssl=1" data-orig-size="1920,630" data-comments-opened="1" data-image-meta="{&quot;aperture&quot;:&quot;0&quot;,&quot;credit&quot;:&quot;&quot;,&quot;camera&quot;:&quot;&quot;,&quot;caption&quot;:&quot;&quot;,&quot;created_timestamp&quot;:&quot;0&quot;,&quot;copyright&quot;:&quot;&quot;,&quot;focal_length&quot;:&quot;0&quot;,&quot;iso&quot;:&quot;0&quot;,&quot;shutter_speed&quot;:&quot;0&quot;,&quot;title&quot;:&quot;&quot;,&quot;orientation&quot;:&quot;0&quot;}" data-image-title="v7-announce-plans" data-image-description="" data-image-caption="" data-medium-file="https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2025/03/v7-announce-plans-1.png?fit=1%2C1&amp;ssl=1" data-large-file="https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2025/03/v7-announce-plans-1.png?fit=1%2C1&amp;ssl=1" src="https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2025/03/v7-announce-plans-1.png?resize=720%2C236&#038;ssl=1" alt="Graphic of new Pro+ plans:\n\nPro Lite+: Everything in our online-only Pro Lite plan plus all our Pro+ icons and more custom icons, Kits,\nand pageviews.\n\nPro+: Everything in our Pro plan plus all our Pro+  icons and more custom icons, Kits, pageviews,\nand bandwidth.\n\nPro Max+: Everything in our Pro Max plan plus all our Pro+ icons, and even more pageviews and bandwidth." class="wp-image-8293" srcset="https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2025/03/v7-announce-plans-1.png?w=1920&amp;ssl=1 1920w, https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2025/03/v7-announce-plans-1.png?w=1440&amp;ssl=1 1440w" sizes="auto, (max-width: 720px) 100vw, 720px" />`, sampleEntry), `![Graphic of new Pro+ plans: Pro Lite+: Everything in our online-only Pro Lite plan plus all our Pro+ icons and more custom icons, Kits, and pageviews. Pro+: Everything in our Pro plan plus all our Pro+  icons and more custom icons, Kits, pageviews, and bandwidth. Pro Max+: Everything in our Pro Max plan plus all our Pro+ icons, and even more pageviews and bandwidth.](https://i0.wp.com/blog.fontawesome.com/wp-content/uploads/2025/03/v7-announce-plans-1.png?w=1440&ssl=1)`);
});

test("Keep <code> with any nested HTML as is https://github.com/11ty/import/issues/48", async (t) => {
	let md = new MarkdownToHtml();

	// Each pair below is the same markup with and without entities in the code text—entities make
	// no difference, nested markup is kept as HTML either way.

	assert.equal(await md.toMarkdown(`<code><a href="https://webawesome.com/docs/components/time-input/">&lt;wa-time-input&gt;</a></code>`, sampleEntry), `<code><a href="https://webawesome.com/docs/components/time-input/">&lt;wa-time-input&gt;</a></code>`);
	assert.equal(await md.toMarkdown(`<code><a href="https://webawesome.com/docs/components/time-input/">wa-time-input</a></code>`, sampleEntry), `<code><a href="https://webawesome.com/docs/components/time-input/">wa-time-input</a></code>`);

	assert.equal(await md.toMarkdown(`<p>Use <code><a href="/url">&lt;wa-time-input&gt;</a></code> for that.</p>`, sampleEntry), `Use <code><a href="/url">&lt;wa-time-input&gt;</a></code> for that.`);
	assert.equal(await md.toMarkdown(`<p>Use <code><a href="/url">wa-time-input</a></code> for that.</p>`, sampleEntry), `Use <code><a href="/url">wa-time-input</a></code> for that.`);

	assert.equal(await md.toMarkdown(`<code><a href="/url">a &amp; b</a></code>`, sampleEntry), `<code><a href="/url">a &amp; b</a></code>`);
	assert.equal(await md.toMarkdown(`<code><a href="/url">a and b</a></code>`, sampleEntry), `<code><a href="/url">a and b</a></code>`);

	assert.equal(await md.toMarkdown(`<code><a href="/url">plain text</a></code>`, sampleEntry), `<code><a href="/url">plain text</a></code>`);
	// the & in the href is re-escaped on the way out
	assert.equal(await md.toMarkdown(`<code><a href="/search?a=1&amp;b=2">plain text</a></code>`, sampleEntry), `<code><a href="/search?a=1&amp;b=2">plain text</a></code>`);
	assert.equal(await md.toMarkdown(`<code><a href="/search?a=1">plain text</a></code>`, sampleEntry), `<code><a href="/search?a=1">plain text</a></code>`);

	// other nested markup is kept too—markdown inside a code span renders literally
	assert.equal(await md.toMarkdown(`<code><strong>bold</strong> code</code>`, sampleEntry), `<code><strong>bold</strong> code</code>`);
	assert.equal(await md.toMarkdown(`<code><kbd>Ctrl</kbd></code>`, sampleEntry), `<code><kbd>Ctrl</kbd></code>`);

	// text-only code is always a code span, entities or not
	assert.equal(await md.toMarkdown(`<code>&lt;wa-time-input&gt;</code>`, sampleEntry), "`<wa-time-input>`");
	assert.equal(await md.toMarkdown(`<code>wa-time-input</code>`, sampleEntry), "`wa-time-input`");

	assert.equal(await md.toMarkdown(`<p>Use <code>&lt;wa-time-input&gt;</code> today.</p>`, sampleEntry), "Use `<wa-time-input>` today.");
	assert.equal(await md.toMarkdown(`<code>a &amp; b</code>`, sampleEntry), "`a & b`");
	assert.equal(await md.toMarkdown(`<code>caf&eacute;</code>`, sampleEntry), "`café`");

	// no href, but still markup
	assert.equal(await md.toMarkdown(`<code><a>no href</a></code>`, sampleEntry), `<code><a>no href</a></code>`);

	// unaffected: already nested the way markdown wants
	assert.equal(await md.toMarkdown(`<a href="/url"><code>&lt;wa-time-input&gt;</code></a>`, sampleEntry), "[`<wa-time-input>`](/url)");
	assert.equal(await md.toMarkdown(`<a href="/url"><code>wa-time-input</code></a>`, sampleEntry), "[`wa-time-input`](/url)");
});

test("Keep <svg> icons too", async (t) => {
	let md = new MarkdownToHtml();

	assert.equal(await md.toMarkdown(`<svg aria-hidden=\"true\" focusable=\"false\" data-prefix=\"fas\" data-icon=\"wrench\" class=\"svg-inline--fa fa-wrench \" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path fill=\"currentColor\" d=\"M352 320c88.4 0 160-71.6 160-160c0-15.3-2.2-30.1-6.2-44.2c-3.1-10.8-16.4-13.2-24.3-5.3l-76.8 76.8c-3 3-7.1 4.7-11.3 4.7H336c-8.8 0-16-7.2-16-16V118.6c0-4.2 1.7-8.3 4.7-11.3l76.8-76.8c7.9-7.9 5.4-21.2-5.3-24.3C382.1 2.2 367.3 0 352 0C263.6 0 192 71.6 192 160c0 19.1 3.4 37.5 9.5 54.5L19.9 396.1C7.2 408.8 0 426.1 0 444.1C0 481.6 30.4 512 67.9 512c18 0 35.3-7.2 48-19.9L297.5 310.5c17 6.2 35.4 9.5 54.5 9.5zM80 408a24 24 0 1 1 0 48 24 24 0 1 1 0-48z\"></path></svg>`, sampleEntry), `<i class="fas fa-wrench"></i>`);
});

