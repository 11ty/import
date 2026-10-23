#!/usr/bin/env node

import { parseArgs } from "node:util";

import { Importer } from "./src/Importer.js";
import { Logger } from "./src/Logger.js";
import { createRequire } from "node:module";

// "string" or "boolean" types are supported by parseArgs
// https://nodejs.org/docs/latest/api/util.html#utilparseargsconfig
let { positionals, values } = parseArgs({
	allowPositionals: true,
	strict: true,
	tokens: true,
	options: {
		type: {
			type: "string",
		},
		target: {
			type: "string",
		},
		output: {
			type: "string",
			default: ".",
		},
		quiet: {
			type: "boolean",
			default: false,
		},
		dryrun: {
			type: "boolean",
			default: false,
		},
		help: {
			type: "boolean",
			default: false,
		},
		version: {
			type: "boolean",
			default: false,
		},
		overwrite: {
			type: "boolean",
			default: false,
		},
		"overwrite-allow": {
			type: "string",
			default: "",
		},
		cacheduration: {
			type: "string",
			default: "24h",
		},
		format: {
			type: "string",
			default: "markdown",
		},
		persist: {
			type: "string",
			default: "",
		},
		assetrefs: {
			type: "string",
			default: "relative",
		},
		avatarrefs: {
			type: "string",
		},
		within: {
			type: "string",
			default: "",
		},
		preserve: {
			type: "string",
			default: "",
		},
		posttypes: {
			type: "string",
			default: "",
		},
		limit: {
			type: "string",
			default: "",
		},
		until: {
			type: "string",
			default: "",
		},
		contentselector: {
			type: "string",
			default: "",
		},
	},
});

let [ type, target ] = positionals;
let { quiet, dryrun, output, help, version, overwrite, cacheduration, format, persist, assetrefs, avatarrefs, within, preserve, posttypes, limit, until, contentselector } = values;

if(version) {
	const require = createRequire(import.meta.url);
	let pkg = require("./package.json");
	Logger.log(pkg.version);
	process.exit();
}

// If you modify this, maybe also add the instructions to README.md too?
if(help) {
	Logger.log(`Usage:

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

  # Change local fetch cache duration (default: 24h)
  npx @11ty/import [type] [target] --cacheduration=20m

  # Change output format (default: markdown)
  npx @11ty/import [type] [target] --format=html

  # Change asset reference URLs: relative (default), absolute, colocate, disabled
  npx @11ty/import [type] [target] --assetrefs=relative
  npx @11ty/import [type] [target] --assetrefs=absolute
  npx @11ty/import [type] [target] --assetrefs=colocate
  npx @11ty/import [type] [target] --assetrefs=disabled

  # Change avatar reference URLs: absolute (default), relative, colocate, disabled (default when --assetrefs=disabled)
  npx @11ty/import [type] [target] --avatarrefs=relative

  # WordPress post types to import (default: posts,pages)
  npx @11ty/import wordpress [target] --posttypes=posts,pages,product
  npx @11ty/import wordpressxml [file] --posttypes=posts,pages,product

  # Only the newest entries (stops fetching once reached)
  npx @11ty/import [type] [target] --limit=5

  # Only entries created on or before a year, date, or timestamp prefix (wayback, typepad, and hobix also limit captures)
  npx @11ty/import [type] [target] --until=2009

  # Content element for archived pages, pages without a match are skipped (wayback, typepad, hobix)
  npx @11ty/import wayback [target] --contentselector=div.entry

  # Import webmention.io webmentions into post data files (requires WEBMENTION_IO_TOKEN)
  npx @11ty/import webmentions example.com

  # Import Instagram posts and reels (requires INSTAGRAM_ACCESS_TOKEN)
  npx @11ty/import instagram zachleat

  # Import npm packages for a user or organization (one page per package README)
  npx @11ty/import npm zachleat
  npx @11ty/import npm @11ty

  # Import GitHub releases for a repository, repositories for a user or organization, or public gists for a user (optional GITHUB_TOKEN)
  npx @11ty/import github 11ty/eleventy
  npx @11ty/import github 11ty
  npx @11ty/import github-gist zachleat

  # Import your public CodePen pens with their source files (requires CODEPEN_API_KEY)
  npx @11ty/import codepen zachleat
`);

	process.exit();
}

// Input checking
if(!type || !target) {
	console.error("Expected usage: npx @11ty/import [type] [target]");
	process.exit(1);
} else if(format !== "markdown" && format !== "html") {
	console.error("Invalid --format, expected `markdown` or `html`");
	process.exit(1);
}

let importer = new Importer();

importer.setOutputFolder(output);
importer.setCacheDuration(cacheduration);
importer.setVerbose(!quiet);
importer.setSafeMode(!overwrite);
importer.setDryRun(dryrun);
try {
	importer.addSource(type, posttypes || limit || until || contentselector ? {
		url: target,
		postTypes: posttypes || undefined,
		limit: limit || undefined,
		until: until || undefined,
		contentSelector: contentselector || undefined,
	} : target);
} catch(e) {
	console.error(e.message);
	process.exit(1);
}

// TODO wire these up to CLI
importer.setDraftsFolder("drafts");
importer.setAssetsFolder("assets");
importer.setAssetReferenceType(assetrefs);
if(avatarrefs) {
	importer.setAvatarReferenceType(avatarrefs);
}

// CSS selectors to preserve on markdown conversion
if(preserve) {
	importer.addPreserved(preserve);
}

if(persist) {
	importer.setPersistTarget(persist);
}

importer.setOverwriteAllow(values['overwrite-allow']);

let entries = await importer.getEntries({
	contentType: format,
	within,
	// Pperformance improvement to avoids parsing html and fetching assets for documents outside of --within (and overwrite rules)
	target: "fs",
});

await importer.toFiles(entries);

importer.logResults();

