import fs from "node:fs";
import { createHash } from "node:crypto";
import kleur from "kleur";
import { XMLParser } from "fast-xml-parser";

import EleventyFetch from "@11ty/eleventy-fetch";
import { DirectoryManager } from "./DirectoryManager.js";
import { Logger } from "./Logger.js";
import { Utils } from "./Utils.js";

// 255 total (hash + url + extension)
const HASH_FILENAME_MAXLENGTH = 12;
const MAXIMUM_URL_FILENAME_SIZE = 30;

// TODO use `type: "parsed-xml" type from Eleventy Fetch
const xmlParser = new XMLParser({
	attributeNamePrefix : "@_",
	ignoreAttributes: false,
	allowBooleanAttributes: true,
	parseAttributeValue: true,
	processEntities: false, // disable this, was causing inconsistencies in Bluesky entries
	// htmlEntities: true,
});

class Fetcher {
	#cacheDuration = "0s";
	#directoryManager;
	#assetsFolder = "assets";
	#persistManager;
	#outputFolder = ".";
	#downloadAssets = true;

	static USER_AGENT = "Eleventy Import v1.0.0";

	static getContextPathname(url) {
		if(url) {
			let u = (new URL(url)).pathname.split("/").filter(entry => Boolean(entry));
			// pop off the top folder
			u.pop();
			return u.join("/");
		}
		return "";
	}

	static getFilenameFromSrc(src, contentType = "") {
		let {pathname} = new URL(src);
		let hash = this.createHash(src);

		let filename = decodeURIComponent(pathname.split("/").pop());
		let lastDot = filename.lastIndexOf(".");

		if(lastDot > -1) {
			let filenameWithoutExtension = filename.slice(0, Math.min(lastDot, MAXIMUM_URL_FILENAME_SIZE));
			let extension = filename.slice(lastDot + 1);
			return `${filenameWithoutExtension}-${hash}.${extension}`;
		}

		let [, fileExtensionFallback] = contentType.split("/");

		// No known file extension
		return `${filename.slice(0, MAXIMUM_URL_FILENAME_SIZE)}-${hash}${fileExtensionFallback ? `.${fileExtensionFallback}` : ""}`;
	}

	static createHash(str) {
		let base64Hash = createHash("sha256").update(str).digest("base64");

		return base64Hash.replace(/[^A-Z0-9]/gi, "").slice(0, HASH_FILENAME_MAXLENGTH);
	}

	static parseXml(content) {
		return xmlParser.parse(content);
	}

	constructor() {
		this.fetchedUrls = new Set();
		this.writtenAssetFiles = new Set();
		this.errors = new Set();
		this.isVerbose = true;
		this.dryRun = false;
		this.safeMode = true;
		this.useRelativeAssets = true;
		this.counts = {
			assets: 0,
		};
	}

	setVerbose(isVerbose) {
		this.isVerbose = Boolean(isVerbose);
	}

	setDryRun(isDryRun) {
		this.dryRun = Boolean(isDryRun);
	}

	setSafeMode(safeMode) {
		this.safeMode = Boolean(safeMode);
	}

	setAssetsFolder(folder) {
		this.#assetsFolder = folder;
	}

	setDownloadAssets(download) {
		this.#downloadAssets = Boolean(download);
	}

	setUseRelativeAssetPaths(use) {
		this.useRelativeAssets = Boolean(use);
	}

	setOutputFolder(dir) {
		this.#outputFolder = dir;
	}

	getCounts() {
		return {
			assets: this.counts.assets,
			errors: this.errors.size,
		}
	}

	setCacheDuration(duration) {
		this.#cacheDuration = duration;
	}

	setDirectoryManager(manager) {
		this.#directoryManager = manager;
	}

	setPersistManager(manager) {
		this.#persistManager = manager;
	}

	getAssetLocation(assetUrl, assetContentType, contextEntry) {
		let filename = Fetcher.getFilenameFromSrc(assetUrl, assetContentType);
		let assetUrlLocation = Utils.pathJoin(this.#assetsFolder, filename);
		// root /assets folder
		if(!this.useRelativeAssets) {
			return {
				url: `/${assetUrlLocation}`,
				filePath: Utils.pathJoin(this.#outputFolder, assetUrlLocation),
			};
		}

		let contextPathname;
		if(contextEntry.filePath) {
			contextPathname = DirectoryManager.getDirectory(contextEntry.filePath);
		} else {
			// backwards compatibility
			contextPathname = Fetcher.getContextPathname(contextEntry.url);
		}

		return {
			url: assetUrlLocation,
			// filePath: Utils.pathJoin(this.#outputFolder, contextPathname, assetUrlLocation),
			filePath: Utils.pathJoin(contextPathname, assetUrlLocation),
		}
	}

	async fetchAsset(assetUrl, contextEntry) {
		if(!this.#downloadAssets) {
			return assetUrl;
		}

		// Adds protocol from original page URL if a protocol relative URL
		if(assetUrl.startsWith("//") && contextEntry.url) {
			let contextUrl = new URL(contextEntry.url);
			if(contextUrl.protocol) {
				assetUrl = `${contextUrl.protocol}${assetUrl}`;
			}
		}

		// TODO move this upstream as a Fetch `alias` feature.
		return this.fetch(assetUrl, {
			type: "buffer",
			returnType: "response",
		},
		{
			verbose: true,
			showErrors: true,
		}).then(result => {
			let { url: urlValue, filePath: fullOutputLocation } = this.getAssetLocation(assetUrl, result.headers?.["content-type"], contextEntry);

			if(this.writtenAssetFiles.has(fullOutputLocation)) {
				return urlValue;
			}

			this.writtenAssetFiles.add(fullOutputLocation);

			// TODO compare file contents and skip
			if(this.safeMode && fs.existsSync(fullOutputLocation)) {
				if(this.isVerbose) {
					Logger.skipping("asset", fullOutputLocation, assetUrl);
				}
				return urlValue;
			}

			if(this.#directoryManager) {
				this.#directoryManager.createDirectoryForPath(fullOutputLocation);
			}

			if(this.isVerbose) {
				Logger.importing("asset", fullOutputLocation, assetUrl, {
					size: result.body.length,
					dryRun: this.dryRun
				});
			}

			if(!this.dryRun) {
				this.counts.assets++;

				fs.writeFileSync(fullOutputLocation, result.body);
			}

			// Don’t persist (e.g. back to GitHub) assets if upstream post is a draft
			if(contextEntry.status !== "draft" && this.#persistManager.canPersist()) {
				this.#persistManager.persistFile(fullOutputLocation, result.body, {
					assetUrl,
					type: "asset",
				});
			}

			return urlValue;
		}, error => {
			// Error logging happens in .fetch() upstream
			// Fetching the asset failed but we don’t want to fail the upstream document promise
			return assetUrl;
		});
	}

	// For expected errors (e.g. paging past the last page)
	clearError(url) {
		this.errors.delete(url);
	}

	async fetch(url, options = {}, verbosity = {}) {
		let { verbose, showErrors } = Object.assign({
			verbose: true, // whether to log the initial fetch request
			showErrors: true, // whether to show if a request has an error.
		}, verbosity);

		let opts = Object.assign({
			duration: this.#cacheDuration,
			type: "text",
			verbose: false, // don’t use Fetch logging—we’re handling it ourself
			fetchOptions: {},
		}, options);

		if(!opts.fetchOptions.headers) {
			opts.fetchOptions.headers = {};
		}
		Object.assign(opts.fetchOptions.headers, {
			"user-agent": Fetcher.USER_AGENT
		});

		if(!this.fetchedUrls.has(url) && this.isVerbose && verbose) {
			let logAdds = [];
			if(Boolean(options?.fetchOptions?.headers?.Authorization)) {
				logAdds.push(kleur.blue("Auth"));
			}
			if(opts.duration) {
				logAdds.push(kleur.green(`(${opts.duration} cache)`));
			}

			Logger.log(kleur.gray("Fetching"), url, logAdds.join(" ") );
		}

		this.fetchedUrls.add(url);

		return EleventyFetch(url, opts).then(result => {
			if(opts.type === "xml") {
				return Fetcher.parseXml(result);
			}

			return result;
		}, error => {
			if(!this.errors.has(url)) {
				this.errors.add(url);

				if(this.isVerbose && showErrors) {
					Logger.log(kleur.red(`Error fetching`), url, kleur.red(error.message));
				}
			}

			return Promise.reject(error);
		});
	}
}

export { Fetcher };
