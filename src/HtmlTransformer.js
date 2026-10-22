import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";

class HtmlTransformer {
	#fetcher;

	setFetcher(fetcher) {
		this.#fetcher = fetcher;
	}

	async transform(content, entry) {
		let options = {
		  eachURL: async (rawUrl, attr, tagName) => {
				// See https://github.com/11ty/eleventy-posthtml-urls/blob/main/lib/defaultOptions.js
				if(tagName === "img" || tagName === "video" || tagName === "audio" || tagName === "source" || tagName === "link" || tagName === "script" || tagName === "track") {
					return this.#fetcher.fetchAsset(rawUrl, entry);
				}

				return rawUrl;
			}
		};

		let result = await posthtml()
		  .use(urls(options))
		  .process(content);

		return result.html;
	}
}

export { HtmlTransformer }
