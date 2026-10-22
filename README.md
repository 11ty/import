# `@11ty/import`

A small utility (and CLI) to import content files from various content sources. Requires Node 20.19 or newer.

## Features

- **Compatible**: Works with a bunch of different data sources (see below) and more to come.
	- Export your entire WordPress site statically in a single command. Related [video on YouTube](https://www.youtube.com/watch?v=WuH5QYCdh6w) and [docs on 11ty.dev](https://www.11ty.dev/docs/migrate/wordpress/).
	- Show recent Bluesky or Mastodon posts on your own web site without an expensive third party embed component.
	- Make anything on the web into a CMS for your web site using [Indieweb PESOS](https://indieweb.org/PESOS).
- **Clean**: Converts imported content to markdown files in your repository (`--format=html` to use raw HTML).
- **Standalone**: downloads all referenced assets (images, videos, stylesheets, scripts, etc) in content and co-locates assets with the content.
	- WordPress: also downloads linked uploads (e.g. PDFs) and makes links to the site root-relative.
- **Resumable**: Can stop and resume a large import later, reusing a local cache (with configurable cache duration)
- **Repeatable**: avoids overwriting existing content files (unless you opt-in with `--overwrite`).
	- This allows you to continue using an import source for new content while editing the already imported content.
	- Use `--dryrun` for testing without writing any files.

## Usage

Published to [npm](https://www.npmjs.com/package/@11ty/import). These commands do not require separate installation.

```sh
npx @11ty/import --help
npx @11ty/import --version

# Import content
npx @11ty/import [type] [target]

# Dry run (don’t write files)
npx @11ty/import [type] [target] --dryrun

# Quietly (limit console output)
npx @11ty/import [type] [target] --quiet

# Change the output folder (default: ".")
npx @11ty/import [type] [target] --output=dist

# Allow overwriting existing files
npx @11ty/import [type] [target] --overwrite

# Allow draft entries to overwrite existing files (bypasses --overwrite)
npx @11ty/import [type] [target] --overwrite-allow=drafts

# Change local fetch cache duration (default: 24h)
npx @11ty/import [type] [target] --cacheduration=20m

# Only import entries created (or updated) within a duration (default: *)
# Same syntax as --cacheduration
npx @11ty/import [type] [target] --within=7d

# Change output format (default: markdown)
npx @11ty/import [type] [target] --format=html

# Change asset reference URLs: relative (default), absolute, colocate, disabled
# slug.md and assets/asset.png with <img src="assets/asset.png">
npx @11ty/import [type] [target] --assetrefs=relative
# slug.md and assets/asset.png with <img src="/assets/asset.png">
npx @11ty/import [type] [target] --assetrefs=absolute
# slug/index.md and slug/asset.png with <img src="asset.png">
npx @11ty/import [type] [target] --assetrefs=colocate
# Don’t download any assets
npx @11ty/import [type] [target] --assetrefs=disabled

# WordPress post types to import (default: posts,pages)
npx @11ty/import wordpress [target] --posttypes=posts,pages,product

# EXPERIMENTAL: Persist *new* non-draft content
# - `github` persist type requires a `GITHUB_TOKEN` environment variable.
npx @11ty/import [type] [target] --persist=github:zachleat/wp-awesome
```

### Service Types

- `atom` (URL)
- `bluesky` (username)
- `fediverse` (username)
- `jsonfeed` (URL)
- `rss` (URL)
- `squarespace` (collection, post, or page URL, e.g. a blog home page)
- `wordpress` (blog home page URL, discovers the site’s own REST API or falls back to the WordPress.com API)
- `wordpressxml` (WordPress export file path or URL)
- `youtubeuser` (user id)

#### YouTube

```sh
# Import recent YouTube Videos for one user
npx @11ty/import youtubeuser UCskGTioqrMBcw8pd14_334A
```

#### WordPress

```sh
# Import *all* posts and pages from the WordPress API
# Draft posts available when WORDPRESS_USERNAME and WORDPRESS_PASSWORD environment
# variables are supplied, read more: https://www.11ty.dev/docs/environment-vars/
npx @11ty/import wordpress https://blog.fontawesome.com

# Import posts, pages, and a custom post type (must be available in the REST API)
npx @11ty/import wordpress https://blog.fontawesome.com --posttypes=posts,pages,product

# WordPress.com sites (including custom domains) work the same way
# Draft posts available when a WORDPRESSDOTCOM_TOKEN (OAuth2 access token) environment variable is supplied
npx @11ty/import wordpress https://en.blog.wordpress.com

# Import published and draft posts and pages from a WordPress export file (Tools → Export)
npx @11ty/import wordpressxml ./example.WordPress.2024-01-01.xml --posttypes=posts,pages,product
```

#### Squarespace

```sh
# Import all posts from a Squarespace blog (or another collection like events or products)
npx @11ty/import squarespace https://engineering.squarespace.com/blog

# Import a single page or post
npx @11ty/import squarespace https://engineering.squarespace.com/about
```

#### JSON Feed

```sh
# Import JSON Feed posts (follows `next_url` paging)
npx @11ty/import jsonfeed https://www.manton.org/feed.json
```

#### Atom Feeds

```sh
# Import Atom feed posts
npx @11ty/import atom https://www.11ty.dev/blog/feed.xml

# Import GitHub releases (via Atom)
npx @11ty/import atom https://github.com/11ty/eleventy/releases.atom
```

#### RSS Feeds

```sh
# Import RSS feed posts
npx @11ty/import rss https://fosstodon.org/users/eleventy.rss
```

#### Aliases

Some services are aliases for another source type.

- `buttondown` (username or newsletter URL, custom domains too): `rss`

```sh
# Import public Buttondown archive posts (via RSS)
npx @11ty/import buttondown zachleat
```

#### Fediverse

```sh
# Import recent Mastodon posts (via RSS)
npx @11ty/import fediverse eleventy@fosstodon.org
```

#### Bluesky

```sh
# Import recent Bluesky posts (via RSS)
npx @11ty/import bluesky @11ty.dev
```

#### Experimental

- `blogger` (blog URL, custom domains too)
- `devto` (DEV username or organization)
- `ghost` (site URL)
- `medium` (extracted Medium export folder path)
- `substack` (publication URL, custom domains too, or a `*.substack.com` subdomain name)
- `twitter` (Twitter/X archive `.zip` file or extracted folder path)

```sh
# Import all posts (paid posts are previews unless a subscriber’s `substack.sid` cookie value is supplied in a SUBSTACK_SID environment variable)
npx @11ty/import substack https://www.lennysnewsletter.com
npx @11ty/import substack example

# Import all posts and pages from the Content API
# The public key is found on the site (from Ghost’s built-in search) or supplied in a GHOST_CONTENT_API_KEY environment variable
npx @11ty/import ghost https://www.404media.co

# Import all posts and pages
npx @11ty/import blogger https://blog.chromium.org

# Import all published articles for a user or organization
npx @11ty/import devto ben

# Import posts and drafts from an extracted Medium export (Settings → Security and apps → Download your information)
npx @11ty/import medium ./medium-export

# Recent posts are also available via RSS
npx @11ty/import rss https://medium.com/feed/@zachleat

# Import tweets (not retweets or replies to others) with media from your archive, threads are comments on the first tweet (Settings → Your account → Download an archive of your data)
npx @11ty/import twitter ./twitter-2026-01-01.zip
```

### Comments

Comments are imported by default to a [template data file](https://www.11ty.dev/docs/data-template-dir/) next to each post (e.g. `my-post.md` and `my-post.json`) with a `comments` array. Each comment has `id`, `parentId` (`0` for top-level), `url`, `author` (`name`, `url`, `avatarUrl`), `date`, and HTML `content`.

Comments with content warnings or from authors that opted out of wider distribution have `private: true` and only `id`, `parentId`, `url`, and `date` (link to them instead).

- `wordpress`, `wordpressxml`: approved comments (no commenter emails or IP addresses)
- `squarespace`: approved comments on collection items (commenter names only)
- `substack`: comments on posts you can read
- `ghost`: native Ghost comments (commenter names and avatars)
- `blogger`: published comments
- `devto`: comments (deleted and hidden comments are skipped)
- `youtubeuser`: requires a `YOUTUBE_API_KEY` environment variable ([YouTube Data API](https://developers.google.com/youtube/v3/getting-started))
- `bluesky`: replies (private when labeled or the author discourages showing their account to logged-out users)
- `fediverse`: public and unlisted replies known to the user’s server (private when unlisted, marked sensitive, or the author opted out of search engine indexing)
- `twitter`: your own replies in a thread, as comments on its first tweet (with local media)
- `rss`, `atom`: per-post comment feeds (`wfw:commentRss` or `<link rel="replies">`), when available

Skip comments with `importer.addSource(type, { url, comments: false })`.

### Programmatic API

Don’t forget to install this into your project: `npm install @11ty/import`

```js
import { Importer } from "@11ty/import";

let importer = new Importer();

importer.setOutputFolder("."); // --output
importer.setCacheDuration("24h"); // --cacheduration
importer.setVerbose(true); // --quiet
importer.setSafeMode(false); // --overwrite
importer.setDryRun(false); // --dryrun
importer.setDraftsFolder("drafts");
importer.setAssetsFolder("assets");
importer.setAssetReferenceType("relative"); // --assetrefs

// Sources (one or more)
importer.addSource("bluesky", "@11ty.dev");
// Comments are imported by default
importer.addSource("wordpress", { url: "https://blog.fontawesome.com", comments: false });

// Simple CSS selector (class names only) for preserved elements in Markdown conversion
importer.addPreserved(".save-this-class-name");

// Third-party embeds kept as HTML in Markdown conversion (class name and optional script URL)
// Built-in: instagram, twitter, tiktok, bluesky
importer.addEmbed("my-embed", { selector: ".my-embed", script: "https://example.com/embed.js" });
importer.removeEmbed("twitter");
// Convert embeds to a permalink instead (options merge into existing embeds)
importer.addEmbed("instagram", { output: "link" });

// Allow draft entries to overwrite (independent of Safe Mode value)
importer.setOverwriteAllow("drafts");

let entries = await importer.getEntries({
	within: "*", // date or last updated date must be within this recent duration (e.g. 24h, 7d, 1y)

	// v1.0.20 and newer:
	limit: 0, // limit number of entires (happens before asset import and processing)
	outputContentType: "markdown", // --format (use `contentType` prior to v1.0.20)
	inputContentType: undefined, // this overrides content type detection to determine eligibility for markdown output (one of: "html", "text")
});

await importer.toFiles(entries);

importer.logResults();
```
