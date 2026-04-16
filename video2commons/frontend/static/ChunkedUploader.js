/** @typedef {"idle"|"sending"|"paused"|"done"|"error"|"aborted"} UploadState */
/** @typedef {"online"|"offline"|"progress"|"finish"|"error"|"retry"} UploadEvent */

const DEFAULT_CHUNK_SIZE = 4_000_000;
const DEFAULT_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 5_000;
const DEFAULT_CHUNK_TIMEOUT = 120_000;

/**
 * An error thrown during chunk upload that carries a retryable flag.
 *
 * Network-level failures (fetch rejections, timeouts) are not fatal errors and
 * are always treated as retryable by the retry loop.
 */
class UploadError extends Error {
	/**
	 * @param {string} message
	 * @param {{ retryable?: boolean }} options
	 */
	constructor(message, { retryable = false } = {}) {
		super(message);
		this.name = "UploadError";
		this.retryable = retryable;
	}
}

/**
 * Thrown when the upload is interrupted by a state change (offline or abort).
 */
class UploadInterrupted extends Error {
	constructor(message) {
		super(message);
		this.name = "UploadInterrupted";
	}
}

/**
 * Uploads a file in sequential chunks to the video2commons backend.
 *
 * Uses the backend's Content-Range and filekey fields for chunked uploads,
 * and sends small files (<= chunkSize) as a single request without
 * Content-Range.
 *
 * Adapted and inspired from huge-uploader (BSD 3-Clause)
 * https://github.com/Buzut/huge-uploader
 *
 * @fires ChunkedUploader#progress
 * @fires ChunkedUploader#finish
 * @fires ChunkedUploader#error
 * @fires ChunkedUploader#retry
 * @fires ChunkedUploader#online
 * @fires ChunkedUploader#offline
 */
// biome-ignore lint/correctness/noUnusedVariables: loaded via <script>, used by video2commons.js
class ChunkedUploader extends EventTarget {
	/**
	 * @param {object} config
	 * @param {string} config.endpoint  Upload URL (e.g. "api/upload/upload")
	 * @param {File}   config.file      File to upload
	 * @param {string} config.csrfToken CSRF token for the session
	 * @param {number} [config.chunkSize=4000000]   Bytes per chunk
	 * @param {number} [config.retries=5]           Per-chunk retry budget
	 * @param {number} [config.retryDelay=5000]     Ms between retries
	 * @param {number} [config.chunkTimeout=120000] Ms before a chunk request times out
	 */
	constructor({
		endpoint,
		file,
		csrfToken,
		chunkSize = DEFAULT_CHUNK_SIZE,
		retries = DEFAULT_RETRIES,
		retryDelay = DEFAULT_RETRY_DELAY,
		chunkTimeout = DEFAULT_CHUNK_TIMEOUT,
	}) {
		super();

		this._endpoint = endpoint;
		this._file = file;
		this._csrfToken = csrfToken;
		this._chunkSize = chunkSize;
		this._retries = retries;
		this._retryDelay = retryDelay;
		this._chunkTimeout = chunkTimeout;

		this._totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
		this._chunkIndex = 0;
		this._filekey = "";

		/** @type {UploadState} */
		this._uploadState = "idle";

		// Aborts in-flight fetch requests and window online/offline
		// listeners once the upload reaches a final state.
		this._controller = new AbortController();
	}

	/**
	 * Begin uploading the file.
	 *
	 * This method can only be called once, and results are delivered via
	 * finish/error events rather than through a promise.
	 */
	start() {
		if (this._uploadState !== "idle") throw new Error("Upload already started");

		this._transition("sending");

		const opts = { signal: this._controller.signal };
		window.addEventListener("online", this._onNetworkOnline.bind(this), opts);
		window.addEventListener("offline", this._onNetworkOffline.bind(this), opts);

		this._upload();
	}

	/**
	 * Cancels the upload if one is active.
	 *
	 * Aborts any in-flight request, removes window listeners, and emits
	 * an error event. No-op if the upload already finished or was
	 * already aborted.
	 */
	abort() {
		if (this._uploadState !== "sending" && this._uploadState !== "paused") {
			return;
		}

		this._transition("aborted");

		this._emit("error", {
			message: "Upload aborted",
			chunk: this._chunkIndex,
		});
	}

	/**
	 * Transition to a new state. Aborts in-flight fetches and window
	 * listeners when the upload reaches a finalized state.
	 *
	 * @param {UploadState} to
	 */
	_transition(to) {
		this._uploadState = to;

		const finalized = to === "done" || to === "error" || to === "aborted";
		if (finalized) {
			this._controller.abort();
		}
	}

	/**
	 * @param {UploadEvent} type
	 * @param {object} [detail] Optional event payload.
	 */
	_emit(type, detail) {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}

	/**
	 * Sleep for ms, resolving early if the controller is aborted.
	 *
	 * @param {number} ms
	 * @returns {Promise<void>}
	 */
	_sleep(ms) {
		return new Promise((resolve) => {
			if (this._controller.signal.aborted) {
				resolve();
				return;
			}

			const onAbort = () => {
				clearTimeout(timeoutId);
				resolve();
			};
			const timeoutId = setTimeout(() => {
				this._controller.signal.removeEventListener("abort", onAbort);
				resolve();
			}, ms);
			this._controller.signal.addEventListener("abort", onAbort, {
				once: true,
			});
		});
	}

	/**
	 * Emit a progress event with the current upload position.
	 */
	_emitProgress() {
		const loaded = Math.min(
			this._chunkIndex * this._chunkSize,
			this._file.size,
		);
		this._emit("progress", {
			percent:
				this._file.size === 0
					? 100
					: Math.round((loaded / this._file.size) * 100),
			loaded,
			total: this._file.size,
		});
	}

	/**
	 * Resume sending if the upload was paused by a connectivity loss.
	 */
	_onNetworkOnline() {
		if (this._uploadState !== "paused") return;

		this._transition("sending");
		this._emit("online");
		this._upload();
	}

	/**
	 * Pause sending when the browser loses connectivity.
	 */
	_onNetworkOffline() {
		if (this._uploadState !== "sending") return;

		this._transition("paused");
		this._emit("offline");
	}

	/**
	 * Assert that the server's reported offset matches what we expect
	 * after sending a chunk.
	 *
	 * @param {object} data The parsed "Continue" response.
	 */
	_validateOffset(data) {
		const expectedOffset = Math.min(
			(this._chunkIndex + 1) * this._chunkSize,
			this._file.size,
		);
		if (data.offset !== expectedOffset) {
			throw new UploadError(
				`Offset mismatch: expected ${expectedOffset}, got ${data.offset}`,
				{ retryable: false },
			);
		}
	}

	/**
	 * Slice the file for a given chunk index.
	 *
	 * @param {number} index
	 * @returns {Blob}
	 */
	_getChunkAtIndex(index) {
		const start = index * this._chunkSize;
		const end = Math.min(start + this._chunkSize, this._file.size);

		return this._file.slice(start, end);
	}

	/**
	 * POST a single chunk to the backend.
	 *
	 * @param {Blob}   chunk
	 * @param {number} index
	 * @returns {Promise<object>} Parsed JSON response body.
	 */
	async _uploadChunk(chunk, index) {
		const body = new FormData();
		body.append("file", chunk, this._file.name);
		body.append("_csrf_token", this._csrfToken);

		if (this._filekey) {
			body.append("filekey", this._filekey);
		}

		const headers = {};
		if (this._totalChunks > 1) {
			const start = index * this._chunkSize;
			const end = Math.min(start + this._chunkSize, this._file.size) - 1;
			headers["Content-Range"] = `bytes ${start}-${end}/${this._file.size}`;
		}

		const signal = AbortSignal.any([
			this._controller.signal,
			AbortSignal.timeout(this._chunkTimeout),
		]);

		const response = await fetch(this._endpoint, {
			method: "POST",
			headers,
			body,
			signal,
		});

		return this._parseResponse(response);
	}

	/**
	 * Parse a fetch Response into the backend's JSON envelope.
	 *
	 * The backend always returns 200 for both success and application errors.
	 * Non-200 status codes come from infrastructure (nginx, reverse proxy):
	 * 5xx are retryable, 4xx are not.
	 *
	 * @param {Response} response
	 * @returns {Promise<object>}
	 */
	async _parseResponse(response) {
		if (!response.ok) {
			throw new UploadError(`Server error (${response.status})`, {
				retryable: response.status >= 500,
			});
		}

		let data;
		try {
			data = await response.json();
		} catch {
			throw new UploadError("Invalid response from server", {
				retryable: true,
			});
		}

		if (data.step === "error") {
			throw new UploadError(data.error || "Server error", {
				retryable: false,
			});
		}

		return data;
	}

	/**
	 * Try to send a chunk, retrying on transient failures up to a limit.
	 *
	 * @param {Blob}   chunk
	 * @param {number} index
	 * @returns {Promise<object>}
	 */
	async _uploadChunkWithRetries(chunk, index) {
		let retriesLeft = this._retries;

		while (true) {
			try {
				return await this._uploadChunk(chunk, index);
			} catch (error) {
				// Assume errors that aren't our custom UploadError are
				// transient network related errors, which are retryable.
				const retryable = error instanceof UploadError ? error.retryable : true;
				if (!retryable || retriesLeft === 0) {
					throw error;
				}
				retriesLeft--;

				this._emit("retry", {
					chunk: index,
					retriesLeft,
					error: error.message,
				});

				// Wait before retrying to give time for issues to resolve.
				// Resolves early if the controller is aborted (user abort).
				await this._sleep(this._retryDelay);

				// Bail if the upload was aborted or paused during the delay.
				if (this._uploadState !== "sending") {
					throw new UploadInterrupted("Upload interrupted during retry");
				}
			}
		}
	}

	/**
	 * Core upload method that sends chunks sequentially.
	 *
	 * Emit progress after each chunk is uploaded. Bail out (without error)
	 * when the state leaves "sending" as the online handler will re-enter
	 * later if appropriate.
	 */
	async _upload() {
		try {
			while (this._chunkIndex < this._totalChunks) {
				// Upload the next chunk of the file.
				//
				// Throws UploadInterrupted if the upload is paused or aborted
				// during a retry delay. If the loop is exited due to going
				// offline, _onNetworkOnline will re-invoke _upload later.
				const data = await this._uploadChunkWithRetries(
					this._getChunkAtIndex(this._chunkIndex),
					this._chunkIndex,
				);
				if (data.filekey) {
					this._filekey = data.filekey;
				}
				if (data.result === "Continue") {
					this._validateOffset(data);
				}

				this._chunkIndex++;
				this._emitProgress();
			}

			this._transition("done");
			this._emit("finish", { filekey: this._filekey });
		} catch (error) {
			// Treat UploadInterrupted as a non-fatal error that doesn't
			// prevent the uploader from resuming at a later time.
			if (error instanceof UploadInterrupted) return;

			this._transition("error");
			this._emit("error", { message: error.message, chunk: this._chunkIndex });
		}
	}
}
