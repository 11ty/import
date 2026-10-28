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
- **Repeatable**: updates imported content files but avoids overwriting ones you’ve edited (unless you opt-in with `--overwrite`).
	- This allows you to continue using an import source for new content while editing the already imported content.
	- Edits are detected with the `metadata.importHash` front matter value (files without it are treated as edited).
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

# Allow overwriting locally modified files
npx @11ty/import [type] [target] --overwrite

# Allow draft entries to overwrite existing files (bypasses --overwrite)
npx @11ty/import [type] [target] --overwrite-allow=drafts

# Delete unreferenced asset files (e.g. from earlier imports) in imported post folders
npx @11ty/import [type] [target] --prune

# Change local fetch cache duration (default: 24h)
npx @11ty/import [type] [target] --cacheduration=20m

# Only import the newest entries, fetching stops once reached
npx @11ty/import [type] [target] --limit=5

# Only import entries created on or before a year, date, or timestamp prefix (UTC)
# For wayback, typepad, and hobix, also only uses captures archived on or before it
npx @11ty/import [type] [target] --until=2009
npx @11ty/import [type] [target] --until=2009-08-19

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

# Change avatar reference URLs, same values as --assetrefs (default: absolute, or disabled with --assetrefs=disabled)
# Avatars are shared across posts, so the default is one root assets folder
npx @11ty/import [type] [target] --avatarrefs=relative

# WordPress post types to import (default: posts,pages)
npx @11ty/import wordpress [target] --posttypes=posts,pages,product

# Import webmention.io webmentions into post data files (requires WEBMENTION_IO_TOKEN)
npx @11ty/import webmentions example.com

```

### Service Types

- `atom` (URL)
- `bluesky` (username)
- `feed` (Atom, RSS, or JSON Feed URL, or a page URL that links to one, detected automatically)
- `fediverse` (username)
- `jsonfeed` (URL)
- `rss` (URL)
- `wordpress` (blog home page URL, discovers the site’s own REST API or falls back to the WordPress.com API, then to the site’s paged RSS feed for posts only)
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

#### Feeds

```sh
# Import posts from an Atom, RSS, or JSON Feed (detected automatically)
npx @11ty/import feed https://www.11ty.dev/blog/feed.xml

# Or a page that links to its feed (the first `<link rel="alternate">` feed)
npx @11ty/import feed https://www.11ty.dev/blog/
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

#### Fediverse

```sh
# Import Mastodon posts (via the Mastodon API)
npx @11ty/import fediverse eleventy@fosstodon.org

# An optional MASTODON_ACCESS_TOKEN from an account on the same server avoids per-IP rate limits and includes full reply threads
MASTODON_ACCESS_TOKEN=… npx @11ty/import fediverse eleventy@fosstodon.org
```

#### Bluesky

```sh
# Import Bluesky posts and threads (via the Bluesky API, with quote posts, link cards, images, and your own videos)
npx @11ty/import bluesky @11ty.dev
```

#### Experimental

- `blogger` (blog URL, custom domains too, links to other imported posts point to their files)
- `buttondown` (username or newsletter URL, custom domains too, an alias for `rss`)
- `codepen` (your CodePen username, public pens with their source files, requires a `CODEPEN_API_KEY` environment variable from [CodePen API settings](https://codepen.io/settings/api))
- `devto` (DEV username or organization)
- `flickr` (username, NSID, or profile URL, public photos and videos as still images, requires a `FLICKR_API_KEY` environment variable from the [Flickr App Garden](https://www.flickr.com/services/apps/create/))
- `ghost` (site URL)
- `hackernews` (origin, URL, or domain, the most popular Hacker News stories linking to it, 100 by default or `--limit` up to 500, from the [Algolia Hacker News API](https://hn.algolia.com/api))
- `github` (`owner/repo` or repository URL for releases, `owner` or profile URL for a user’s or organization’s repositories, an optional `GITHUB_TOKEN` environment variable raises the rate limit and includes draft releases)
- `github-gist` (GitHub username, public gists)
- `instagram` (username of a business or creator account, requires an `INSTAGRAM_ACCESS_TOKEN` environment variable for that account from the [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login))
- `kickstarter` (project URL or `creator/project`, the 10 most recent public updates from the project’s Atom feed)
- `letterboxd` (username, recent diary entries, reviews, and lists from the public RSS feed, with film, rating, and watched date metadata)
- `linktree` (Linktree username or profile URL)
- `medium` (extracted Medium export folder path)
- `npm` (npm username for the releases they published or approved, including trusted publishing to packages they’ve published to, or `@scope` organization for its packages’ releases)
- `opencollective` (account slug or URL, contributions the account made to others, one entry per contribution with amounts, tier, and recipient metadata)
- `squarespace` (collection, post, or page URL, e.g. a blog home page)
- `substack` (publication URL, custom domains too, or a `*.substack.com` subdomain name)
- `typepad` (Typepad blog URL or domain, optionally with a path, from the Wayback Machine)
- `hobix` (Hobix blog URL or domain, from the Wayback Machine)
- `tumblr` (blog name, domain, or URL, public posts and reblogs, requires a `TUMBLR_API_KEY` environment variable, the OAuth consumer key from [registering an app](https://www.tumblr.com/oauth/apps), `--posttypes` filters by `text`, `photo`, `quote`, `link`, `chat`, `audio`, `video`, or `answer`)
- `twitter` (Twitter/X archive `.zip` file or extracted folder path)
- `wayback` (site URL or domain, optionally with a path, from the Internet Archive’s Wayback Machine, links to other imported pages point to their files)
- `webmentions` (domain or site URL, data files only, see [Webmentions](#webmentions))

```sh
# Import all posts (paid posts are previews unless a subscriber’s `substack.sid` cookie value is supplied in a SUBSTACK_SID environment variable)
npx @11ty/import substack https://www.lennysnewsletter.com
npx @11ty/import substack example

# Import public Buttondown archive posts (via RSS)
npx @11ty/import buttondown zachleat

# Import all posts from a Squarespace blog (or another collection like events or products)
npx @11ty/import squarespace https://engineering.squarespace.com/blog

# Import a single Squarespace page or post
npx @11ty/import squarespace https://engineering.squarespace.com/about

# Import all posts and pages from the Content API
# The public key is found on the site (from Ghost’s built-in search) or supplied in a GHOST_CONTENT_API_KEY environment variable
npx @11ty/import ghost https://www.404media.co

# Import all posts and pages
npx @11ty/import blogger https://blog.chromium.org

# Import all published articles for a user or organization
npx @11ty/import devto ben

# Import a profile’s links as a single page
npx @11ty/import linktree @linktree

# Import posts and drafts from an extracted Medium export (Settings → Security and apps → Download your information)
npx @11ty/import medium ./medium-export

# Recent posts are also available via RSS
npx @11ty/import rss https://medium.com/feed/@zachleat

# Import a page for each package version a user published
npx @11ty/import npm zachleat

# Import a page for each package version in an organization
npx @11ty/import npm @11ty

# Import releases for a repository
npx @11ty/import github 11ty/eleventy

# Import a page for each repository (README, language, and topics) a user or organization owns, without forks
npx @11ty/import github 11ty

# Import public gists for a user
npx @11ty/import github-gist zachleat

# Import posts and reels with media (requires INSTAGRAM_ACCESS_TOKEN)
npx @11ty/import instagram zachleat

# Import tweets (not retweets or replies to others) with media from your archive, threads are comments on the first tweet (Settings → Your account → Download an archive of your data)
npx @11ty/import twitter ./twitter-2026-01-01.zip

# Import the latest archived copy of every HTML page on a site (or under a path) from the Wayback Machine, with archived assets
npx @11ty/import wayback example.com
npx @11ty/import wayback https://example.com/blog/

# Only captures on or before a year, date, or timestamp prefix (2022, 2022-11-20, 20221120), e.g. before the domain was parked
npx @11ty/import wayback example.com --until=2022

# Same, using a Wayback Machine URL
npx @11ty/import wayback https://web.archive.org/web/2022/https://example.com/

# Use a specific content element (tag, id, and/or class names), pages without a match are skipped
npx @11ty/import wayback example.com --contentselector=div.entry

# Import posts and pages with comments from a Typepad blog (offline since September 30, 2025) via the Wayback Machine
npx @11ty/import typepad sethgodin.typepad.com/seths_blog/

# Import posts with comments from a Hobix blog (e.g. _why’s RedHanded) via the Wayback Machine
npx @11ty/import hobix redhanded.hobix.com --until=2009
```

### Comments

Comments are imported by default to a [template data file](https://www.11ty.dev/docs/data-template-dir/) next to each post (e.g. `my-post.md` and `my-post.json`) with a `comments` array. Each comment has `id`, `parentId` (`0` for top-level), `url`, `author` (`name`, `url`, `avatarUrl`), `date`, HTML `content`, and `via` (the source type).

The data file can also have `likes`, `reposts`, `bookmarks`, and `rsvps` arrays, each item with `id`, `url`, `author`, `date`, and `via` (RSVPs also have `rsvp`: `yes`, `no`, `maybe`, or `interested`).

Sources share the data file: a source only replaces its own items (matching `via`) and other keys are kept. Items are sorted by date.

Some sources also add a `counts` object (e.g. `{ "likes": 12, "reposts": 3, "comments": 4, "via": "bluesky" }`, zeros are omitted). Counts are replaced on every import of an unedited post.

- `bluesky`, `fediverse`: `likes`, `reposts`, `comments`, `quotes`
- `youtubeuser`: `likes`, `views`
- `flickr`: `likes` (faves), `comments`, `views`
- `devto`: `likes` (reactions), `comments`
- `npm`: `downloads` (of the package in the previous year, on every release)
- `substack`: `likes` (reactions), `reposts` (restacks), `comments`
- `instagram`: `likes` (unless hidden), `comments`
- `hackernews`: `points`, `comments`
- `tumblr`: `notes` (likes, reblogs, and replies combined)
- `twitter`: `likes`, `reposts` (as of the archive download)
- `github` (repositories): `stars`, `forks`, `issues` and `pullRequests` (all-time totals), `openIssues` and `openPullRequests` (these four require a `GITHUB_TOKEN` environment variable)
- `github` (releases): `reactions` (all emoji reactions), `thumbsUp`, `thumbsDown`, `laugh`, `hooray`, `confused`, `heart`, `rocket`, `eyes`

Comments deleted upstream are removed when a post is reimported (`--overwrite`). If a comment request fails, existing comments are kept and fetched ones are updated.

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
- `typepad`: comments in the latest archived copy of each post
- `hobix`: comments in the latest archived copy of each post (commenter names only)
- `twitter`: your own replies in a thread, as comments on its first tweet (with local media)
- `rss`, `atom`, `feed`: per-post comment feeds (`wfw:commentRss` or `<link rel="replies">`), when available

Skip comments with `importer.addSource(type, { url, comments: false })`.

#### Webmentions

Import [webmention.io](https://webmention.io/) webmentions for a domain into the data file of each mentioned URL (protocol, `www.`, and trailing slashes are ignored), whether or not the post was imported. Requires a `WEBMENTION_IO_TOKEN` environment variable ([API token](https://webmention.io/settings)).

```sh
npx @11ty/import webmentions example.com
```

- Replies and mentions are added to `comments` with `type: "reply"` or `type: "mention"` (third-party content is not downloaded).
- Likes, reposts, bookmarks, and RSVPs are added to `likes`, `reposts`, `bookmarks`, and `rsvps`.
- Webmentions are always rewritten (no `--overwrite` needed), so mentions deleted upstream are removed.
- Webmentions of a comment another source imported (e.g. replies backfed by Bridgy) are skipped.
- Avatars are downloaded (see `--avatarrefs`).

### Programmatic API

Don’t forget to install this into your project: `npm install @11ty/import`

```js
import { Importer } from "@11ty/import";

let importer = new Importer();

importer.setOutputFolder("."); // --output
importer.setCacheDuration("24h"); // --cacheduration
importer.setFetchTimeout("30s"); // milliseconds or a duration, 0 to disable
importer.setAssetFetchTimeout("5m"); // same, for asset downloads (including the body)
importer.setFetchRetries(2); // for timeouts, network errors, 408, 429, and 5xx responses, 0 to disable
importer.setFetchRetryDelay(1000); // milliseconds before the first retry, doubled after (`Retry-After` and `x-ratelimit-reset` take precedence)
importer.setOriginLimit("https://mastodon.social", { concurrency: 2 }); // p-queue options for requests to an origin (cache hits skip it)
importer.setVerbose(true); // --quiet
importer.setSafeMode(false); // --overwrite
importer.setDryRun(false); // --dryrun
importer.setPruneAssets(false); // --prune
importer.setDraftsFolder("drafts");
importer.setAssetsFolder("assets");
importer.setAssetReferenceType("relative"); // --assetrefs
importer.setAvatarReferenceType("absolute"); // --avatarrefs

// Sources (one or more)
importer.addSource("bluesky", "@11ty.dev");
// Comments are imported by default
importer.addSource("wordpress", { url: "https://blog.fontawesome.com", comments: false });
// Front matter only, no content or comments (e.g. for cross links)
importer.addSource("youtubeUser", { id: "UCskGTioqrMBcw8pd14_334A", content: false });
// Don’t download assets for this source, or only some media types (`image`, `audio`, `video`)
importer.addSource("rss", { url: "https://feeds.buzzsprout.com/2092855.rss", assets: false });
importer.addSource("rss", { url: "https://feeds.buzzsprout.com/2092855.rss", assets: ["image"] });


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
