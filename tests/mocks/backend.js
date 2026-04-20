import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

export const UPLOAD_ENDPOINT = "http://localhost/api/upload/upload";

export const server = setupServer();

/**
 * Build a stateful handler that mimics the video2commons chunked upload
 * endpoint.
 *
 * Tracks a per-instance offset across requests and mirrors the backend
 * contract. Continue responses are returned until the final chunk, then
 * finally a Success response. Returns the handler alongside a `requests`
 * array so tests can assert on the actual Request objects received.
 *
 * While offline (toggled via `setOffline`), new requests fail with an error
 * mirroring how a browser rejects fetches when connectivity is lost, though
 * in real scenarios this might take a moment. The server offset is
 * untouched, so an interrupted chunk can be safely resent on resume.
 *
 * @param {object}  [options]
 * @param {string}  [options.endpoint] Full URL to match.
 * @param {string}  [options.filekey]  Filekey returned to the client.
 * @returns {{
 *   handler: import("msw").HttpHandler,
 *   requests: Request[],
 *   filekey: string,
 *   setOffline: (offline: boolean) => void,
 * }}
 */
export function createUploadHandler({
	endpoint = UPLOAD_ENDPOINT,
	filekey = `test-${Math.random().toString(36).slice(2, 10)}`,
} = {}) {
	let offset = 0;
	let offline = false;
	const requests = [];

	const handler = http.post(endpoint, async ({ request }) => {
		if (offline) {
			// Simulate a network-level error. The name doesn't matter.
			// Network-level errors and 5xx HTTP errors are treated the same.
			return HttpResponse.error();
		}

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

	const setOffline = (value) => {
		offline = value;
		window.dispatchEvent(new Event(value ? "offline" : "online"));
	};

	return { handler, requests, filekey, setOffline };
}
