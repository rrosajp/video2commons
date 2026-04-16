import { describe, expect, it } from "vitest";
import { ChunkedUploader } from "../video2commons/frontend/static/ChunkedUploader.js";
import {
	createUploadHandler,
	DEFAULT_UPLOAD_ENDPOINT,
	server,
} from "./mock-backend.js";

/**
 * Resolve with the `finish` detail, reject on `error`. Lets tests `await` an
 * upload with natural error propagation.
 */
function awaitDone(uploader) {
	return new Promise((resolve, reject) => {
		uploader.addEventListener("finish", (e) => resolve(e.detail));
		uploader.addEventListener("error", (e) =>
			reject(new Error(e.detail.message)),
		);
	});
}

describe("ChunkedUploader", () => {
	it("uploads a small single-chunk file without a Content-Range header", async () => {
		const { handler, requests, filekey } = createUploadHandler({
			endpoint: DEFAULT_UPLOAD_ENDPOINT,
		});
		server.use(handler);

		const file = new File([new Uint8Array(100)], "tiny.bin");
		const uploader = new ChunkedUploader({
			endpoint: DEFAULT_UPLOAD_ENDPOINT,
			file,
			csrfToken: "csrf",
			chunkSize: 1000,
		});

		const progress = [];
		uploader.addEventListener("progress", (e) => progress.push(e.detail));

		uploader.start();
		const result = await awaitDone(uploader);

		expect(result.filekey).toBe(filekey);
		expect(requests).toHaveLength(1);
		expect(requests[0].headers.get("Content-Range")).toBeNull();
		expect(progress).toHaveLength(1);
		expect(progress[0]).toEqual({ percent: 100, loaded: 100, total: 100 });
	});

	it("uploads a three-chunk file with correct Content-Range sequencing", async () => {
		const { handler, requests, filekey } = createUploadHandler({
			endpoint: DEFAULT_UPLOAD_ENDPOINT,
		});
		server.use(handler);

		// 250 bytes at 100 bytes/chunk in chunks of 100, 100, 50.
		const file = new File([new Uint8Array(250)], "multi.bin");
		const uploader = new ChunkedUploader({
			endpoint: DEFAULT_UPLOAD_ENDPOINT,
			file,
			csrfToken: "csrf",
			chunkSize: 100,
		});

		const progress = [];
		uploader.addEventListener("progress", (e) => progress.push(e.detail));

		uploader.start();
		const result = await awaitDone(uploader);

		expect(result.filekey).toBe(filekey);
		expect(requests).toHaveLength(3);
		expect(requests[0].headers.get("Content-Range")).toBe("bytes 0-99/250");
		expect(requests[1].headers.get("Content-Range")).toBe("bytes 100-199/250");
		expect(requests[2].headers.get("Content-Range")).toBe("bytes 200-249/250");
		expect(progress.map((e) => e.loaded)).toEqual([100, 200, 250]);
		expect(progress.at(-1).percent).toBe(100);
	});
});
