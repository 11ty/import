import path from "node:path";
import fs from "node:fs";
import TurndownService from "@zachleat/turndown";
import * as prettier from "prettier";
import prettierSync from "@prettier/sync";
import striptags from "striptags";
import * as entities from "entities";

import { Logger } from "./Logger.js";
import { DirectoryManager } from "./DirectoryManager.js";
import { WordPressApi } from "./DataSource/WordPressApi.js";
import { HostedWordPressApi } from "./DataSource/HostedWordPressApi.js";

const WORDPRESS_TO_PRISM_LANGUAGE_TRANSLATION = {
	jscript: "js",
	markup: "html",
};

const TAGS_TO_KEEP = [
	"abbr",
	"address",
	"audio",
	"cite",
	"dd",
	"del",
	"details",
	// "dialog",
	"dfn",
	// "figure",
	"form",
	"iframe",
	"ins",
	"kbd",
	"object",
	"q",
	"sub",
	"s",
	"samp",
	"svg",
	"table",
	"time",
	"var",
	"video",
	"wbr",
];

class MarkdownToHtml {
	#prettierLanguages;
	#initStarted;

	constructor() {
		this.assetsToKeep = new Set();
		this.assetsToDelete = new Set();
		this.preservedSelectors = new Set();
		this.isVerbose = true;
		this.counts = {
			cleaned: 0
		}
	}

	addPreservedSelector(selector) {
		if(!selector.startsWith(".")) {
			throw new Error("Invalid preserved selector. Only class names are supported.");
		}
		this.preservedSelectors.add(selector);
	}

	async asyncInit() {
		if(this.#initStarted) {
			return;
		}

		this.#initStarted = true;

		/* Sample output language
		{
			language: {
				linguistLanguageId: 50,
				name: 'CSS',
				type: 'markup',
				tmScope: 'source.css',
				aceMode: 'css',
				codemirrorMode: 'css',
				codemirrorMimeType: 'text/css',
				color: '#563d7c',
				extensions: [ '.css', '.wxss' ],
				parsers: [ 'css' ],
				vscodeLanguageIds: [ 'css' ]
			}
		}
		*/

		let map = {
			// extension without dot => array of parser types
		};

		let supportInfo = await prettier.getSupportInfo();
		for(let language of supportInfo.languages) {
			for(let ext of language.extensions) {
				if(language.parsers.length > 0) {
					map[ext.slice(1)] = language.parsers;
				}
			}
		}

		this.#prettierLanguages = map;
	}

	getCounts() {
		return this.counts;
	}

	setVerbose(isVerbose) {
		this.isVerbose = Boolean(isVerbose);
	}

	recontextifyRelativeAssetPath(assetPath, filePath) {
		if(path.isAbsolute(assetPath) || assetPath.startsWith("https:") || assetPath.startsWith("http:")) {
			return false;
		}

		let dir = DirectoryManager.getDirectory(filePath);
		return path.join(dir, assetPath);
	}

	// /small/jpeg/ 375w, /medium/jpeg/ 650w
	static getSrcsetUrls(srcsetAttr) {
		return (srcsetAttr || "").split(",").map(entry => {
			let [url, size] = entry.trim().split(" ");
			return url.trim();
		}).filter(url => Boolean(url)).reverse()
	}

	static getImageSrcUrls(srcsetAttr, srcAttr) {
		let s = new Set();
		for(let srcsetUrl of this.getSrcsetUrls(srcsetAttr) || []) {
			s.add(srcsetUrl);
		}
		if(srcAttr) {
			s.add(srcAttr);
		}
		return Array.from(s);
	}

	get prettierLanguages() {
		if(!this.#prettierLanguages) {
			throw new Error("Internal error: missing this.prettierLanguages—did you call asyncInit()?");
		}

		return this.#prettierLanguages;
	}

	static outputMarkdownCodeBlock(content, language) {
		return `\`\`\`${language || ""}\n${content.trim()}\n\`\`\`\n\n`
	}

	// Supports .className selectors
	static hasClass(node, className) {
		if(className.startsWith(".")) {
			className = className.slice(1);
		}
		return this.hasAttribute(node, "class", className);
	}

	static matchAttributeEntry(value, expected) {
		// https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors#attrvalue_3
		if(expected.startsWith("|=")) {
			let actual = expected.slice(2);
			// |= is equal to or starts with (and a hyphen)
			return value === actual || value.startsWith(`${actual}-`);
		}

		return value === expected;
	}

	static hasAttribute(node, attrName, attrValueMatch) {
		if(node._attrKeys?.includes(`|${attrName}`)) {
			let attrValue = node._attrsByQName?.[attrName]?.data;
			// [class] is special, space separated values
			if(attrName === "class") {
				return attrValue.split(" ").find(entry => {
					return this.matchAttributeEntry(entry, attrValueMatch);
				});
			}

			// not [class]
			return attrValue === attrValueMatch;
		}

		return false;
	}

	getTurndownService(options = {}) {
		let { filePath, type } = options;
		let isFromWordPress = type === WordPressApi.TYPE || type === HostedWordPressApi.TYPE;

		let ts = new TurndownService({
			headingStyle: "atx",
			bulletListMarker: "-",
			codeBlockStyle: "fenced",

			// Workaround to keep icon elements
			blankReplacement(content, node) {
				if(node.localName === "i") {
					if(MarkdownToHtml.hasClass(node, "|=fa")) {
						return node.outerHTML;
					}
				}

				if(node.localName === "svg") {
					let iconName = node._attrsByQName?.["data-icon"]?.data;
					let iconPrefix = node._attrsByQName?.["data-prefix"]?.data;

					if(MarkdownToHtml.hasClass(node, "svg-inline--fa") && iconName && iconPrefix) {
						return `<i class="${iconPrefix} fa-${iconName}"></i>`
					}
				}

				// content will be empty unless it has a preserved child, e.g. <p><i class="fa-"></i></p>
				return node.isBlock ? `\n\n${content}\n\n` : content;
			},

			// Intentionally opt-out
			// preformattedCode: true,
		});

		ts.keep(TAGS_TO_KEEP); // tags run through `keepReplacement` function if match

		// A markdown code span can only hold literal text, so any code containing markup is kept
		// as HTML e.g. <code><a href="…">&lt;wa-time-input&gt;</a></code>
		// https://github.com/11ty/import/issues/48
		ts.addRule("keep-code-as-html", {
			filter: (node) => {
				// <code> inside of <pre> is a code block, handled below
				if(node.localName !== "code" || node.parentNode?.localName === "pre") {
					return false;
				}

				return Boolean(node.firstElementChild);
			},
			replacement: (content, node) => {
				return node.outerHTML;
			}
		});

		if(this.preservedSelectors.size > 0) {
			let preserved = Array.from(this.preservedSelectors);
			ts.addRule("keep-via-classes", {
				filter: function(node) {
					return preserved.find(cls => MarkdownToHtml.hasClass(node, cls));
				},
				replacement: (content, node) => {
					return node.outerHTML;
				}
			});
		}

		ts.addRule("pre-without-code-to-fenced-codeblock", {
			filter: ["pre"],
			replacement: (content, node) => {
				try {
					let cls = node.getAttribute("class") || "";
					let clsSplit = cls.split(" ");
					let isPreformattedWordPressBlock = clsSplit.includes("wp-block-preformatted");
					if(isPreformattedWordPressBlock && isFromWordPress) {
						return content;
					}

					let languageClass = clsSplit.find(className => className.startsWith("language-"));
					let language;
					if(languageClass) {
						language = languageClass.slice("language-".length).trim();
					} else if(isFromWordPress) {
						// WordPress specific
						let brush = cls.split(";").filter(entry => entry.startsWith("brush:"));
						language = (brush[0] || ":").split(":")[1].trim();
					}

					let finalLanguage = language;

					// WordPress-only options
					if(isFromWordPress) {
						finalLanguage = WORDPRESS_TO_PRISM_LANGUAGE_TRANSLATION[language] || language;

						// TODO customizable
						// Questionable default: for code blocks unnecessarily bookended with `
						let trimmed = content.trim();
						if(trimmed.startsWith("`") && trimmed.endsWith("`")) {
							content = trimmed.slice(1, -1);
						}
					}

					try {
						if(isFromWordPress && language === "markup" && !content.trimStart().startsWith("<")) {
							// This code block was mislabeled as "markup" (hi WordPress), so we do nothing
						} else if(this.prettierLanguages[finalLanguage]) {
							// Attempt to format the code with Prettier
							let parserName = this.prettierLanguages[finalLanguage][0];
							content = prettierSync.format(content, { parser: parserName });
						} else {
							// preserve \n
							content = entities.decodeHTML(striptags(""+node.innerHTML));
						}
					} catch(e) {
						console.error(`Error running code formatting on code block from ${filePath}${language ? ` (${language})` : ""}. Returning unformatted code:\n\n${content}`, e);
					}

					return MarkdownToHtml.outputMarkdownCodeBlock(content, finalLanguage);
				} catch(e) {
					// Otherwise errors get swallowed without feedback by Turndown
					console.error(`Error processing code block from ${filePath}`, e);

					return MarkdownToHtml.outputMarkdownCodeBlock(content);
				}
			}
		});

		// ts.addRule("picture-unsupported", {
		// 	filter: ["picture"],
		// 	replacement: (content, node) => {
		// 		Logger.warning( `<picture> node found, but not yet supported in markdown import.` );
		// 		return "";
		// 	}
		// });

		ts.addRule("source-cleanup", {
			filter: ["source"],
			replacement: (content, node) => {
				try {
					let srcset = node.getAttribute("srcset");
					if(node.parentNode.localName === "picture" && srcset) {
						let urls = MarkdownToHtml.getImageSrcUrls(srcset);
						for(let asset of urls) {
							this.assetsToDelete.add(this.recontextifyRelativeAssetPath(asset, filePath));
						}
					}
					return content;
				} catch(e) {
					// Otherwise errors get swallowed without feedback by Turndown
					console.error(`Error processing <source> on ${filePath}`, e);
					return content;
				}
			}
		});

		ts.addRule("prefer-highest-resolution-images", {
			filter: ["img"],
			replacement: (content, node, options) => {
				try {
					// prefer highest-resolution (first) srcset
					let [src, ...remainingUrls] = MarkdownToHtml.getImageSrcUrls(node.getAttribute("srcset"), node.getAttribute("src"));

					this.assetsToKeep.add(this.recontextifyRelativeAssetPath(src, filePath));

					for(let asset of remainingUrls) {
						this.assetsToDelete.add(this.recontextifyRelativeAssetPath(asset, filePath));
					}

					// New lines are stripped by markdown-it anyway when encoding back to HTML
					let altString = (node.getAttribute("alt") || "").replace(/\n+/gi, " ");
					return `![${entities.escapeAttribute(altString)}](${src})`;
				} catch(e) {
					// Otherwise errors get swallowed without feedback by Turndown
					console.error(`Error processing high-resolution images on ${filePath}`, e);
					return content;
				}
			}
		});

		return ts;
	}

	// Removes unnecessarily downloaded <picture> and `srcset` assets that didn’t end up in the markdown simplification
	cleanup() {
		// Don’t delete assets that are in both Sets
		for(let asset of this.assetsToKeep) {
			if(asset) {
				this.assetsToDelete.delete(asset);
			}
		}

		for(let asset of this.assetsToDelete) {
			if(!asset) {
				continue;
			}

			if(fs.existsSync(asset)) {
				if(this.isVerbose) {
					Logger.cleanup("unused asset", asset);
				}

				this.counts.cleaned++;
				fs.unlinkSync(asset);
			}
		}
	}

	async toMarkdown(html, entry) {
		let ts = this.getTurndownService({
			type: entry.type,
			filePath: entry.filePath,
		});

		return ts.turndown(html);
	}
}

export { MarkdownToHtml }
