import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { Utils } from "./Utils.js";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const UINT32_MAX = 0xffffffff;
const EOCD_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

// Read-only file access for a local folder or a `.zip` file (including zip64), paths are relative and use `/` separators
class Archive {
	#root;
	#zipEntries;

	static async open(target) {
		let archive = new Archive(target);
		await archive.init();
		return archive;
	}

	constructor(target) {
		this.#root = target;
	}

	async init() {
		let stats = await fs.promises.stat(this.#root);
		if(stats.isFile()) {
			this.#zipEntries = await Archive.readZipEntries(this.#root);
		}
	}

	async list() {
		if(this.#zipEntries) {
			return Array.from(this.#zipEntries.keys());
		}

		let files = await fs.promises.readdir(this.#root, { recursive: true, withFileTypes: true });
		return files.filter(file => file.isFile()).map(file => {
			return Utils.pathJoin(path.relative(this.#root, path.join(file.parentPath, file.name)));
		});
	}

	async read(filePath) {
		if(!this.#zipEntries) {
			return fs.promises.readFile(path.join(this.#root, filePath));
		}

		let entry = this.#zipEntries.get(filePath);
		if(!entry) {
			throw new Error(`Missing file in ${this.#root}: ${filePath}`);
		}

		return Archive.readZipEntry(this.#root, entry);
	}

	static async #readAt(handle, position, length) {
		let buffer = Buffer.alloc(length);
		let { bytesRead } = await handle.read(buffer, 0, length, position);
		return buffer.subarray(0, bytesRead);
	}

	static async readZipEntries(zipPath) {
		let handle = await fs.promises.open(zipPath, "r");
		try {
			let { size } = await handle.stat();
			let tailLength = Math.min(size, EOCD_SIZE + MAX_COMMENT_SIZE);
			let tailStart = size - tailLength;
			let tail = await Archive.#readAt(handle, tailStart, tailLength);

			let eocdIndex = -1;
			for(let j = tail.length - EOCD_SIZE; j >= 0; j--) {
				if(tail.readUInt32LE(j) === EOCD_SIGNATURE) {
					eocdIndex = j;
					break;
				}
			}
			if(eocdIndex === -1) {
				throw new Error(`Not a valid zip file: ${zipPath}`);
			}

			let count = tail.readUInt16LE(eocdIndex + 10);
			let directorySize = tail.readUInt32LE(eocdIndex + 12);
			let directoryOffset = tail.readUInt32LE(eocdIndex + 16);

			let locatorIndex = eocdIndex - 20;
			if(locatorIndex >= 0 && tail.readUInt32LE(locatorIndex) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
				let zip64Offset = Number(tail.readBigUInt64LE(locatorIndex + 8));
				let zip64 = await Archive.#readAt(handle, zip64Offset, 56);
				if(zip64.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
					throw new Error(`Invalid zip64 end of central directory: ${zipPath}`);
				}
				count = Number(zip64.readBigUInt64LE(32));
				directorySize = Number(zip64.readBigUInt64LE(40));
				directoryOffset = Number(zip64.readBigUInt64LE(48));
			}

			let directory = await Archive.#readAt(handle, directoryOffset, directorySize);
			let entries = new Map();
			let offset = 0;
			for(let j = 0; j < count; j++) {
				if(directory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
					throw new Error(`Invalid zip central directory: ${zipPath}`);
				}

				let method = directory.readUInt16LE(offset + 10);
				let compressedSize = directory.readUInt32LE(offset + 20);
				let uncompressedSize = directory.readUInt32LE(offset + 24);
				let nameLength = directory.readUInt16LE(offset + 28);
				let extraLength = directory.readUInt16LE(offset + 30);
				let commentLength = directory.readUInt16LE(offset + 32);
				let localHeaderOffset = directory.readUInt32LE(offset + 42);
				let name = directory.toString("utf8", offset + 46, offset + 46 + nameLength);

				// Zip64 extra field only has values for the fields that overflowed
				let extraStart = offset + 46 + nameLength;
				let extraEnd = extraStart + extraLength;
				while(extraStart + 4 <= extraEnd) {
					let id = directory.readUInt16LE(extraStart);
					let length = directory.readUInt16LE(extraStart + 2);
					if(id === ZIP64_EXTRA_FIELD) {
						let position = extraStart + 4;
						if(uncompressedSize === UINT32_MAX) {
							uncompressedSize = Number(directory.readBigUInt64LE(position));
							position += 8;
						}
						if(compressedSize === UINT32_MAX) {
							compressedSize = Number(directory.readBigUInt64LE(position));
							position += 8;
						}
						if(localHeaderOffset === UINT32_MAX) {
							localHeaderOffset = Number(directory.readBigUInt64LE(position));
						}
					}
					extraStart += 4 + length;
				}

				if(!name.endsWith("/")) {
					entries.set(name, { method, compressedSize, uncompressedSize, localHeaderOffset });
				}

				offset = extraEnd + commentLength;
			}

			return entries;
		} finally {
			await handle.close();
		}
	}

	static async readZipEntry(zipPath, entry) {
		let handle = await fs.promises.open(zipPath, "r");
		try {
			let header = await Archive.#readAt(handle, entry.localHeaderOffset, 30);
			if(header.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
				throw new Error(`Invalid zip local file header: ${zipPath}`);
			}

			let dataStart = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
			let data = await Archive.#readAt(handle, dataStart, entry.compressedSize);

			if(entry.method === 0) {
				return data;
			}
			if(entry.method === 8) {
				return zlib.inflateRawSync(data);
			}

			throw new Error(`Unsupported zip compression method (${entry.method}): ${zipPath}`);
		} finally {
			await handle.close();
		}
	}
}

export { Archive };
