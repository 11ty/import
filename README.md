# `@11ty/import`

A small utility (and CLI) to import content files from various content sources. Requires Node 20.19 or newer.

## Features

- **Compatible**: Works with a bunch of different data sources (see below) and more to come.
	- Export your entire WordPress site statically in a single command. Related [video on YouTube](https://www.youtube.com/watch?v=WuH5QYCdh6w) and [docs on 11ty.dev](https://www.11ty.dev/docs/migrate/wordpress/).
	- Show recent Bluesky or Mastodon posts on your own web site without an expensive third party embed component.
	- Make anything on the web into a CMS for your web site using [Indieweb PESOS](https://indieweb.org/PESOS).
- **Clean**: Converts imported content to markdown files in your repository (`--format=html` to use raw HTML).
- **Standalone**: downloads all referenced assets (images, videos, stylesheets, scripts, etc) in content and co-locates assets with the content.
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

# EXPERIMENTAL: Persist *new* non-draft content
# - `github` persist type requires a `GITHUB_TOKEN` environment variable.
npx @11ty/import [type] [target] --persist=github:zachleat/wp-awesome
```

### Service Types

- `atom` (URL)
- `bluesky` (username)
- `fediverse` (username)
- `rss` (URL)
- `wordpress` (blog home page URL)
- `youtubeuser` (user id)

#### YouTube

```sh
# Import recent YouTube Videos for one user
npx @11ty/import youtubeuser UCskGTioqrMBcw8pd14_334A
```

#### WordPress

```sh
# Import *all* posts from the WordPress API
# Draft posts available when WORDPRESS_USERNAME and WORDPRESS_PASSWORD environment
# variables are supplied, read more: https://www.11ty.dev/docs/environment-vars/
npx @11ty/import wordpress https://blog.fontawesome.com
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
# Import recent Mastodon posts (via RSS)
npx @11ty/import fediverse eleventy@fosstodon.org
```

#### Bluesky

```sh
# Import recent Bluesky posts (via RSS)
npx @11ty/import bluesky @11ty.dev
```

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

// Simple CSS selector (class names only) for preserved elements in Markdown conversion
importer.addPreserved(".save-this-class-name");

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
