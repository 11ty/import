import * as entities from "entities";

import { DataSource } from "../DataSource.js";

// Contributions an account made to others via the GraphQL API (https://graphql-docs-v2.opencollective.com)
export class OpenCollective extends DataSource {
	static TYPE = "opencollective";
	static TYPE_FRIENDLY = "Open Collective";
	static DECODE_HTML = false;
	static API = "https://api.opencollective.com/graphql/v2";
	static WEBSITE = "https://opencollective.com";
	static PER_PAGE = 100;
	// Newest first, cancelled recurring contributions are kept for what they paid
	static QUERY = `query($slug: String, $limit: Int, $offset: Int) { account(slug: $slug) { slug orders(filter: OUTGOING, limit: $limit, offset: $offset, status: [ACTIVE, PAID, CANCELLED], orderBy: { field: CREATED_AT, direction: DESC }) { nodes { id legacyId description status frequency createdAt amount { value currency } totalDonations { value currency } tier { name } fromAccount { name slug type imageUrl } toAccount { name slug type } } } } }`;

	constructor(slug) {
		super();
		if(!slug) {
			throw new Error("Open Collective requires an account slug (e.g. 11ty).");
		}
		this.slug = OpenCollective.parseSlug(slug);
	}

	// Slug, `@slug`, or account URL
	static parseSlug(slug) {
		if(slug.startsWith("https://") || slug.startsWith("http://")) {
			slug = new URL(slug).pathname.split("/").filter(Boolean)[0] || "";
		}
		return slug.replace(/^@/, "").toLowerCase();
	}

	// GET requests need a JSON content type (CSRF protection)
	getHeaders(url) {
		if(!url?.startsWith(OpenCollective.API)) {
			return {};
		}
		return { "Content-Type": "application/json" };
	}

	getType() {
		return "json";
	}

	getUrl() {
		return pageNumber => {
			let url = new URL(OpenCollective.API);
			url.searchParams.set("query", OpenCollective.QUERY);
			url.searchParams.set("variables", JSON.stringify({
				slug: this.slug,
				limit: OpenCollective.PER_PAGE,
				offset: (pageNumber - 1) * OpenCollective.PER_PAGE,
			}));
			return url.toString();
		};
	}

	// Contributions that never paid anything are skipped
	getEntriesFromData(data) {
		if(data?.errors?.length) {
			throw new Error(`Open Collective API error: ${data.errors.map(error => error.message).join(", ")}`);
		}
		if(!data?.data?.account) {
			throw new Error(`Open Collective account not found: ${this.slug}`);
		}

		return (data.data.account.orders?.nodes || []).filter(order => order.toAccount?.slug && order.totalDonations?.value > 0);
	}

	getUniqueIdFromEntry(order) {
		return `${DataSource.UUID_PREFIX}::${OpenCollective.TYPE}::${order.id}`;
	}

	getRawEntryDates(order) {
		return {
			created: this.toDateObj(order.createdAt),
		};
	}

	// Contributions have no page of their own, so `{recipient}/{id}`
	static getFilePath(url, entry) {
		let recipient = new URL(url).pathname.split("/").filter(Boolean)[0];
		return entry?.metadata?.legacyId ? `${recipient}/${entry.metadata.legacyId}` : recipient;
	}

	static getAccountUrl(account) {
		return `${OpenCollective.WEBSITE}/${account.slug}`;
	}

	static getAccount(account) {
		return {
			name: account.name || account.slug,
			url: OpenCollective.getAccountUrl(account),
			type: account.type,
		};
	}

	static getAmount(amount) {
		if(amount?.currency) {
			return { value: amount.value, currency: amount.currency };
		}
	}

	cleanEntry(order) {
		let { created } = this.getRawEntryDates(order);
		let from = order.fromAccount || { slug: this.slug };
		let to = order.toAccount;

		let author = {
			name: from.name || from.slug,
			url: OpenCollective.getAccountUrl(from),
		};
		if(from.imageUrl) {
			author.avatarUrl = from.imageUrl;
		}

		let metadata = {
			id: order.id,
			legacyId: order.legacyId,
			status: order.status,
			frequency: order.frequency,
			amount: OpenCollective.getAmount(order.amount),
			total: OpenCollective.getAmount(order.totalDonations),
			tier: order.tier?.name,
			from: OpenCollective.getAccount(from),
			to: OpenCollective.getAccount(to),
		};

		return {
			uuid: this.getUniqueIdFromEntry(order),
			type: OpenCollective.TYPE,
			title: `${author.name} → ${to.name || to.slug}`,
			url: OpenCollective.getAccountUrl(to),
			authors: [author],
			date: created,
			content: order.description ? `<p>${entities.escapeUTF8(order.description)}</p>` : "",
			contentType: "html",
			metadata: Object.fromEntries(Object.entries(metadata).filter(([key, value]) => value !== undefined && value !== null)),
		};
	}
}
