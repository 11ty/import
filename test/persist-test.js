import test from "node:test";
import assert from "node:assert/strict";

import { Persist } from "../src/Persist.js";

// In-memory GitHub Git Data API, `onPatchRef` can move the branch to simulate a concurrent push
function mockGitHub(t, { defaultBranch = "main", onPatchRef, failBlob } = {}) {
	let state = {
		head: "commit0",
		commits: { commit0: { sha: "commit0", tree: { sha: "tree0" }, parents: [] } },
		blobs: [],
		trees: [],
		createdCommits: [],
		refPatches: [],
		requests: [],
	};
	let id = 0;

	function json(data, status = 200) {
		return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
	}

	t.mock.method(globalThis, "fetch", async (input, options = {}) => {
		let url = new URL(input);
		let method = options.method || "GET";
		let body = options.body ? JSON.parse(options.body) : undefined;
		let pathname = url.pathname.replace("/repos/zachleat/site", "");
		state.requests.push(`${method} ${pathname}`);

		assert.equal(url.host, "api.github.com");
		assert.equal(options.headers.authorization, "Bearer FAKE_TOKEN");

		if(method === "GET" && pathname === "") {
			return json({ default_branch: defaultBranch });
		}
		if(method === "GET" && pathname.startsWith("/git/ref/heads/")) {
			return json({ object: { sha: state.head } });
		}
		if(method === "GET" && pathname.startsWith("/git/commits/")) {
			return json(state.commits[pathname.split("/").pop()]);
		}
		if(method === "POST" && pathname === "/git/blobs") {
			if(failBlob?.(body)) {
				return json({ message: "Blob failed" }, 500);
			}
			let sha = `blob${++id}`;
			state.blobs.push({ sha, ...body });
			return json({ sha }, 201);
		}
		if(method === "POST" && pathname === "/git/trees") {
			let sha = `tree${++id}`;
			state.trees.push({ sha, ...body });
			return json({ sha }, 201);
		}
		if(method === "POST" && pathname === "/git/commits") {
			let sha = `commit${++id}`;
			let commit = { sha, tree: { sha: body.tree }, parents: body.parents, message: body.message };
			state.commits[sha] = commit;
			state.createdCommits.push(commit);
			return json(commit, 201);
		}
		if(method === "PATCH" && pathname.startsWith("/git/refs/heads/")) {
			state.refPatches.push({ ref: pathname, ...body });
			onPatchRef?.(state);
			if(state.commits[body.sha].parents[0] !== state.head) {
				return json({ message: "Update is not a fast forward" }, 422);
			}
			state.head = body.sha;
			return json({ object: { sha: body.sha } });
		}

		return json({ message: "Not mocked" }, 404);
	});

	return state;
}

function getPersist(t, target = "github:zachleat/site#main") {
	process.env.GITHUB_TOKEN = "FAKE_TOKEN";
	t.mock.method(console, "log", () => {});

	let p = new Persist();
	p.setVerbose(false);
	p.setTarget(target);
	return p;
}

test("Persist batches files into one commit", async (t) => {
	let p = getPersist(t);
	let state = mockGitHub(t);

	p.persistFile("./blog/post/index.md", "# Hello", { url: "https://example.com/post/", type: "post", source: "wordpress" });
	p.persistFile("blog/post/comments.json", "[]", { url: "https://example.com/post/", type: "comments", source: "wordpress" });
	p.persistFile("blog/post/assets/image.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]), { type: "asset", source: "wordpress" });

	assert.equal(p.getCounts().persist, 3);
	assert.equal(state.requests.length, 0);

	let result = await p.flush();

	assert.deepEqual(result.failures, []);
	assert.equal(result.files, 3);
	assert.equal(result.commits.length, 1);
	assert.equal(state.head, result.commits[0]);

	assert.equal(state.blobs.length, 3);
	let png = state.blobs.find(blob => blob.encoding === "base64");
	assert.deepEqual(Buffer.from(png.content, "base64"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
	assert.deepEqual(state.blobs.find(blob => blob.content === "# Hello").encoding, "utf-8");

	assert.equal(state.trees.length, 1);
	assert.equal(state.trees[0].base_tree, "tree0");
	assert.deepEqual(state.trees[0].tree.map(entry => entry.path), [
		"blog/post/assets/image.png",
		"blog/post/comments.json",
		"blog/post/index.md",
	]);
	assert.ok(state.trees[0].tree.every(entry => entry.mode === "100644" && entry.type === "blob"));

	let [commit] = state.createdCommits;
	assert.deepEqual(commit.parents, ["commit0"]);
	assert.equal(commit.message, `@11ty/import: 3 files (1 post, 1 comments, 1 asset)

Sources:
- wordpress: 3 files

Imported from:
- https://example.com/post/`);

	assert.deepEqual(state.refPatches.map(({ ref, force }) => ({ ref, force })), [{ ref: "/git/refs/heads/main", force: false }]);
});

test("Persist looks up the default branch", async (t) => {
	let p = getPersist(t, "github:zachleat/site");
	let state = mockGitHub(t, { defaultBranch: "trunk" });

	p.persistFile("index.md", "Hi", { type: "post" });
	let result = await p.flush();

	assert.equal(result.files, 1);
	assert.equal(state.requests[0], "GET ");
	assert.ok(state.requests.includes("GET /git/ref/heads/trunk"));
	assert.equal(state.refPatches[0].ref, "/git/refs/heads/trunk");
});

test("Persist splits large runs into multiple commits", async (t) => {
	let p = getPersist(t);
	let state = mockGitHub(t);
	p.setLimits({ maxFilesPerCommit: 2, maxBytesPerCommit: 10 });

	p.persistFile("a.md", "aaaa", { type: "post" });
	p.persistFile("b.md", "bbbb", { type: "post" });
	p.persistFile("c.md", "cccc", { type: "post" });
	// exceeds maxBytesPerCommit alongside c.md
	p.persistFile("d.md", "dddddddd", { type: "post" });

	let result = await p.flush();

	assert.equal(result.files, 4);
	assert.equal(result.commits.length, 3);
	assert.deepEqual(state.trees.map(tree => tree.tree.map(entry => entry.path)), [["a.md", "b.md"], ["c.md"], ["d.md"]]);
	assert.deepEqual(state.createdCommits.map(commit => commit.message.split("\n")[0]), [
		"@11ty/import: 2 files (2 posts) [1/3]",
		"@11ty/import: 1 file (1 post) [2/3]",
		"@11ty/import: 1 file (1 post) [3/3]",
	]);

	// Each commit builds on the previous one
	assert.deepEqual(state.createdCommits[1].parents, [state.createdCommits[0].sha]);
	assert.equal(state.trees[1].base_tree, state.trees[0].sha);
	assert.equal(state.head, result.commits[2]);
});

test("Persist retries from the new head when the ref moved", async (t) => {
	let p = getPersist(t);
	let moved = false;
	let state = mockGitHub(t, {
		onPatchRef(state) {
			if(!moved) {
				moved = true;
				state.commits.external = { sha: "external", tree: { sha: "treeExternal" }, parents: [state.head] };
				state.head = "external";
			}
		}
	});

	p.persistFile("index.md", "Hi", { type: "post" });
	let result = await p.flush();

	assert.deepEqual(result.failures, []);
	assert.equal(result.commits.length, 1);
	assert.equal(state.refPatches.length, 2);
	// Blobs are reused, tree and commit are rebuilt on the new head
	assert.equal(state.blobs.length, 1);
	assert.equal(state.trees[1].base_tree, "treeExternal");
	assert.deepEqual(state.commits[result.commits[0]].parents, ["external"]);
	assert.equal(state.head, result.commits[0]);
});

test("Persist reports failures when the ref keeps moving", async (t) => {
	let p = getPersist(t);
	p.setLimits({ refRetries: 1 });
	let state = mockGitHub(t, {
		onPatchRef(state) {
			let sha = `external${state.refPatches.length}`;
			state.commits[sha] = { sha, tree: { sha: "treeExternal" }, parents: [state.head] };
			state.head = sha;
		}
	});

	p.persistFile("index.md", "Hi", { type: "post" });
	let errors = [];
	t.mock.method(console, "log", (...args) => errors.push(args.join(" ")));
	let result = await p.flush();

	assert.equal(result.commits.length, 0);
	assert.equal(result.failures.length, 1);
	assert.equal(result.failures[0].path, "index.md");
	assert.equal(state.refPatches.length, 2);
	assert.ok(errors.some(line => line.includes("Failed to persist 1 file")));
});

test("Persist reports blob failures and commits the rest", async (t) => {
	let p = getPersist(t);
	let state = mockGitHub(t, { failBlob: body => body.content === "bad" });

	p.persistFile("good.md", "good", { type: "post" });
	p.persistFile("bad.md", "bad", { type: "post" });
	let result = await p.flush();

	assert.equal(result.files, 1);
	assert.deepEqual(result.failures.map(failure => failure.path), ["bad.md"]);
	assert.deepEqual(state.trees[0].tree.map(entry => entry.path), ["good.md"]);
});

test("Persist skips everything in dry run mode", async (t) => {
	let p = getPersist(t);
	let state = mockGitHub(t);
	p.setDryRun(true);

	p.persistFile("index.md", "Hi", { type: "post" });
	let result = await p.flush();

	assert.equal(p.getCounts().persist, 0);
	assert.equal(result.files, 0);
	assert.equal(state.requests.length, 0);
});

test("Persist file mode writes one commit per file", async (t) => {
	let p = getPersist(t);
	p.setMode("file");
	let requests = [];
	t.mock.method(globalThis, "fetch", async (input, options = {}) => {
		requests.push(`${options.method || "GET"} ${new URL(input).pathname}`);
		return new Response(JSON.stringify({ content: { sha: `sha${requests.length}` } }), { status: 201 });
	});

	p.persistFile("a.md", "a", { type: "post", url: "https://example.com/a/" });
	p.persistFile("b.md", "b", { type: "post", url: "https://example.com/b/" });
	let result = await p.flush();

	assert.deepEqual(requests, [
		"PUT /repos/zachleat/site/contents/a.md",
		"PUT /repos/zachleat/site/contents/b.md",
	]);
	assert.equal(result.files, 2);
	assert.equal(result.commits.length, 2);
});

test("Persist invalid mode", async (t) => {
	let p = new Persist();
	assert.throws(() => p.setMode("tree"), { message: "Invalid persist mode: tree (expected batch or file)" });
});

test("Persist normalizePath", async (t) => {
	assert.equal(Persist.normalizePath("./dist/a//b.md"), "dist/a/b.md");
	assert.equal(Persist.normalizePath("/a.md"), "a.md");
	assert.throws(() => Persist.normalizePath("../a.md"));
});
