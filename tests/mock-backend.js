import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

export const DEFAULT_UPLOAD_ENDPOINT = "http://localhost/api/upload/upload";

export const server = setupServer();

/**
 * Build a stateful handler that mimics the video2commons chunked upload
 * endpoint.
 *
 * Tracks a per-instance offset across requests and mirrors the backend
 * contract: Continue responses until the final chunk, then Success. Returns
 * the handler alongside a `requests` array so tests can assert on the actual
 * Request objects received (headers, bodies).
 *
 * @param {object}  [options]
 * @param {string}  [options.endpoint] Full URL to match.
 * @param {string}  [options.filekey]  Filekey returned to the client.
 * @returns {{ handler: import("msw").HttpHandler, requests: Request[], filekey: string }}
 */
export function createUploadHandler({
	endpoint = DEFAULT_UPLOAD_ENDPOINT,
	filekey = `test-${Math.random().toString(36).slice(2, 10)}`,
} = {}) {
	let offset = 0;
	const requests = [];

	const handler = http.post(endpoint, async ({ request }) => {
		requests.push(request.clone());

		const range = request.headers.get("Content-Range");

		// No Content-Range mean a single-shot upload, the whole file arrived.
		if (!range) {
			return HttpResponse.json({
				step: "uploaded",
				result: "Success",
				filekey,
			});
		}

		const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
		if (!match) {
			return HttpResponse.json({
				step: "error",
				error: `Bad Content-Range: ${range}`,
			});
		}

		const start = Number(match[1]);
		const end = Number(match[2]);
		const total = Number(match[3]);

		if (start !== offset) {
			return HttpResponse.json({
				step: "error",
				error: `Offset mismatch: expected ${offset}, got ${start}`,
			});
		}

		offset = end + 1;
		const done = offset >= total;

		return HttpResponse.json({
			step: "uploaded",
			result: done ? "Success" : "Continue",
			offset,
			filekey,
		});
	});

	return { handler, requests, filekey };
}
