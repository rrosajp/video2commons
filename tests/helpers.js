/**
 * Waits for an uploader to finish so tests can await an upload.
 *
 * @param {ChunkedUploader} uploader
 * @returns {Promise<{ filekey: string }>}
 * @throws {Error}
 */
function awaitDone(uploader) {
	return new Promise((resolve, reject) => {
		uploader.addEventListener("finish", (e) => {
			resolve(e.detail);
		});
		uploader.addEventListener("error", (e) => {
			reject(new Error(e.detail.message));
		});
	});
}

/**
 * Awaits the next event of a given type on a target.
 *
 * @param {EventTarget} target
 * @param {string} type
 * @returns {Promise<Event>}
 */
function awaitEvent(target, type) {
	return new Promise((resolve) => {
		target.addEventListener(type, resolve, { once: true });
	});
}

/**
 * Collect every event of `type` dispatched on `target` into an array so
 * tests can assert on count, ordering, and event fields.
 *
 * @param {EventTarget} target
 * @param {string} type
 * @returns {Event[]}
 */
function collectEvents(target, type) {
	const events = [];
	target.addEventListener(type, (e) => events.push(e));
	return events;
}

export { awaitDone, awaitEvent, collectEvents };
