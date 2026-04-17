import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./mocks/backend.js";

// ChunkedUploader listens for window online/offline events. An EventTarget
// with no DOM attached is enough. Tests dispatch connectivity events directly
// when exercising those code paths.
globalThis.window = new EventTarget();

beforeAll(() => {
	server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});
