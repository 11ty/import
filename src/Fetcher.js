import fs from "node:fs";
import { createHash } from "node:crypto";
import kleur from "kleur";
import { XMLParser } from "fast-xml-parser";
import PQueue from "p-queue";

import EleventyFetch, { createFetch } from "@11ty/eleventy-fetch";
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
	#timeout = "30s";
	#retries = 2;
	#retryDelay = 1000;
	#originQueues = new Map();
	// Origin to the timestamp its requests wait for (rate limits)
	#originPauses = new Map();
	// Eleventy Fetch returns the same response object for repeated requests in a process
	#seenResponses = new WeakSet();
	#directoryManager;
	#assetsFolder = "assets";
	#outputFolder = ".";
	#downloadAssets = true;

	static USER_AGENT = "Eleventy Import v1.0.0";
	static RETRY_STATUSES = [408, 429, 500, 502, 503, 504];
	// Longest wait for a rate limit (Mastodon uses 5 minute windows)
	static MAX_RETRY_DELAY = 5 * 60 * 1000;
	// Requests are spread out until the reset once `x-ratelimit-remaining` drops to this fraction of `x-ratelimit-limit`
	static RATE_LIMIT_LOW = 0.1;
	// Only longer waits are logged
	static LOG_WAIT_MINIMUM = 10 * 1000;

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

		// Spaces and other URL-unsafe characters would break Markdown and HTML references
		let filename = decodeURIComponent(pathname.split("/").pop()).replace(/[^\p{L}\p{N}._-]+/gu, "-");
		let lastDot = filename.lastIndexOf(".");

		if(lastDot > -1) {
			let filenameWithoutExtension = Fetcher.trimFilename(filename.slice(0, lastDot));
			let extension = filename.slice(lastDot + 1);
			return `${filenameWithoutExtension}-${hash}.${extension}`;
		}

		let [, fileExtensionFallback] = contentType.split("/");

		// No known file extension
		return `${Fetcher.trimFilename(filename)}-${hash}${fileExtensionFallback ? `.${fileExtensionFallback}` : ""}`;
	}

	// Matches filenames from getFilenameFromSrc
	static isAssetFilename(filename) {
		return new RegExp(`-[A-Za-z0-9]{${HASH_FILENAME_MAXLENGTH}}(\\.[^.]+)?$`).test(filename);
	}

	static trimFilename(filename) {
		return filename.slice(0, MAXIMUM_URL_FILENAME_SIZE).replace(/-+$/, "");
	}

	static createHash(str) {
		let base64Hash = createHash("sha256").update(str).digest("base64");

		return base64Hash.replace(/[^A-Z0-9]/gi, "").slice(0, HASH_FILENAME_MAXLENGTH);
	}

	static parseXml(content) {
		return xmlParser.parse(content);
	}

	// Timeouts, network errors, rate limits, and server errors
	static isRetryable(error) {
		let cause = error?.cause;
		if(cause instanceof Response) {
			return Fetcher.RETRY_STATUSES.includes(cause.status);
		}
		return cause?.name === "TimeoutError" || cause instanceof TypeError;
	}

	// Plain object (cached response metadata) or `Headers`
	static getHeader(headers, name) {
		return typeof headers?.get === "function" ? headers.get(name) : headers?.[name];
	}

	// Milliseconds until `x-ratelimit-reset`: an ISO date (Mastodon), epoch seconds (GitHub), or seconds from now
	static getRateLimitResetDelay(headers) {
		let reset = Fetcher.getHeader(headers, "x-ratelimit-reset");
		if(!reset) {
			return;
		}

		let delay;
		if(/^\d+(\.\d+)?$/.test(reset)) {
			let seconds = Number(reset);
			delay = seconds > 1e9 ? seconds * 1000 - Date.now() : seconds * 1000;
		} else {
			delay = Date.parse(reset) - Date.now();
		}

		return delay > 0 ? delay : undefined;
	}

	// `Retry-After` (seconds or a date) or `x-ratelimit-reset` on a 429 (capped), otherwise exponential backoff with jitter
	static getRetryDelay(error, attempt, baseDelay, maxDelay = Fetcher.MAX_RETRY_DELAY) {
		let headers = error?.cause?.headers;
		let retryAfter = Fetcher.getHeader(headers, "retry-after");
		let delay;
		if(retryAfter) {
			let seconds = Number(retryAfter) || (Date.parse(retryAfter) - Date.now()) / 1000;
			if(seconds > 0) {
				delay = seconds * 1000;
			}
		}
		if(!delay && error?.cause?.status === 429) {
			delay = Fetcher.getRateLimitResetDelay(headers);
		}
		if(delay) {
			return Math.min(delay, maxDelay);
		}
		return baseDelay * 2 ** attempt + Math.random() * baseDelay / 4;
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

	getAssetsFolder() {
		return this.#assetsFolder;
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

	// Milliseconds or a duration string (e.g. `30s`), `0` disables it
	setFetchTimeout(timeout) {
		this.#timeout = timeout;
	}

	// Retries after the first attempt, `0` disables them
	setFetchRetries(retries) {
		this.#retries = retries;
	}

	// Per-origin p-queue options (e.g. `{ concurrency: 2 }`), unlimited by default (Eleventy Fetch caps all requests at 10)
	setOriginLimit(origin, options) {
		this.#originQueues.set(new URL(origin).origin, new PQueue(options));
	}

	hasOriginLimit(origin) {
		return this.#originQueues.has(new URL(origin).origin);
	}

	// Cache hits skip the queue
	#queue(url, opts) {
		let request = () => EleventyFetch(url, opts);
		if(this.#isCached(url, opts)) {
			return request();
		}

		let origin = new URL(url).origin;
		let task = () => this.#waitForOrigin(origin).then(request);
		let queue = this.#originQueues.get(origin);
		return queue ? queue.add(task) : task();
	}

	#isCached(url, opts) {
		let instance = createFetch(url, opts);
		if(typeof instance?.isCacheValid !== "function") {
			// Invalid sources return a rejected promise, the error is thrown by the request instead
			instance?.catch?.(() => {});
			return false;
		}
		return instance.isCacheValid();
	}

	async #waitForOrigin(origin) {
		let delay = (this.#originPauses.get(origin) || 0) - Date.now();
		if(delay > 0) {
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}

	// Pauses all requests to an origin, returns whether it was extended by at least a second (for logging)
	#pauseOrigin(origin, delay) {
		let until = Date.now() + delay;
		let current = this.#originPauses.get(origin) || Date.now();
		if(until > current) {
			this.#originPauses.set(origin, until);
		}
		return until - current >= 1000;
	}

	#logWait(origin, delay, reason) {
		if(this.isVerbose) {
			Logger.log(kleur.yellow(`${reason}, waiting ${Math.ceil(delay / 1000)}s`), origin);
		}
	}

	// Spreads out the remaining requests until the reset
	#slowDown(origin, headers) {
		let remaining = Number(Fetcher.getHeader(headers, "x-ratelimit-remaining"));
		let limit = Number(Fetcher.getHeader(headers, "x-ratelimit-limit"));
		let resetDelay = Fetcher.getRateLimitResetDelay(headers);
		if(!Number.isFinite(remaining) || !limit || !resetDelay || remaining > limit * Fetcher.RATE_LIMIT_LOW) {
			return;
		}

		let delay = Math.min(resetDelay / (remaining + 1), Fetcher.MAX_RETRY_DELAY);
		if(this.#pauseOrigin(origin, delay) && delay >= Fetcher.LOG_WAIT_MINIMUM) {
			this.#logWait(origin, delay, `Rate limit almost reached (${remaining} of ${limit} remaining)`);
		}
	}

	// Milliseconds before the first retry, doubled for each one after
	setFetchRetryDelay(delay) {
		this.#retryDelay = delay;
	}

	setDirectoryManager(manager) {
		this.#directoryManager = manager;
	}

	// `refType` overrides the asset reference type: relative, colocate, absolute, or disabled (e.g. for avatars)
	getAssetLocation(assetUrl, assetContentType, contextEntry, refType) {
		let filename = Fetcher.getFilenameFromSrc(assetUrl, assetContentType);
		let assetUrlLocation = Utils.pathJoin(refType === "colocate" ? "" : this.#assetsFolder, filename);
		// root /assets folder
		if(refType ? refType === "absolute" : !this.useRelativeAssets) {
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

	async fetchAsset(assetUrl, contextEntry, refType) {
		if(refType ? refType === "disabled" : !this.#downloadAssets) {
			return assetUrl;
		}

		// Adds protocol from original page URL if a protocol relative URL
		if(assetUrl.startsWith("//") && contextEntry.url) {
			let contextUrl = new URL(contextEntry.url);
			if(contextUrl.protocol) {
				assetUrl = `${contextUrl.protocol}${assetUrl}`;
			}
		}

		let localAsset = await contextEntry.source?.getLocalAsset(assetUrl);

		// TODO move this upstream as a Fetch `alias` feature.
		let request = localAsset ? Promise.resolve(localAsset) : this.fetch(assetUrl, {
			type: "buffer",
			returnType: "response",
		},
		{
			verbose: true,
			showErrors: true,
		}).then(result => ({ body: result.body, contentType: result.headers?.["content-type"] }));

		return request.then(result => {
			let { url: urlValue, filePath: fullOutputLocation } = this.getAssetLocation(assetUrl, result.contentType, contextEntry, refType);

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
		let { verbose, showErrors, logUrl = url } = Object.assign({
			verbose: true, // whether to log the initial fetch request
			showErrors: true, // whether to show if a request has an error.
		}, verbosity);

		let { retries = this.#retries, retryDelay = this.#retryDelay, ...fetchOpts } = options;
		let opts = Object.assign({
			duration: this.#cacheDuration,
			timeout: this.#timeout,
			type: "text",
			verbose: false, // don’t use Fetch logging—we’re handling it ourself
			fetchOptions: {},
		}, fetchOpts);

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

			Logger.log(kleur.gray("Fetching"), logUrl, logAdds.join(" ") );
		}

		this.fetchedUrls.add(url);

		let isGet = !opts.fetchOptions.method || opts.fetchOptions.method.toUpperCase() === "GET";
		let returnResponse = opts.returnType === "response";
		// Headers are needed for rate limits
		opts.returnType = "response";
		let origin = new URL(url).origin;
		for(let attempt = 0; ; attempt++) {
			try {
				// Retry delays happen outside of the queue
				let result = await this.#queue(url, opts);
				if(result.cache === "miss" && !this.#seenResponses.has(result)) {
					this.#seenResponses.add(result);
					this.#slowDown(origin, result.headers);
				}
				let body = returnResponse ? result : result.body;
				return opts.type === "xml" ? Fetcher.parseXml(body) : body;
			} catch(error) {
				if(!isGet || attempt >= retries || !Fetcher.isRetryable(error)) {
					this.#logError(url, logUrl, error, showErrors);
					throw error;
				}

				let delay = Fetcher.getRetryDelay(error, attempt, retryDelay);
				if(error.cause?.status === 429) {
					// Other requests to the origin wait too
					if(this.#pauseOrigin(origin, delay)) {
						this.#logWait(origin, delay, "Rate limited (429)");
					}
				} else if(this.isVerbose && verbose) {
					Logger.log(kleur.gray(`Retrying in ${Math.ceil(delay / 1000)}s`), logUrl, kleur.gray(error.message.split(url).join(logUrl)));
				}
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	#logError(url, logUrl, error, showErrors) {
		if(!this.errors.has(url)) {
			this.errors.add(url);

			if(this.isVerbose && showErrors) {
				Logger.log(kleur.red(`Error fetching`), logUrl, kleur.red(error.message.split(url).join(logUrl)));
			}
		}
	}
}

export { Fetcher };
