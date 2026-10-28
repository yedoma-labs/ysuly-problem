import { describe, expect, it } from "vitest";
import { isProblemDetails, parseProblem } from "../src/index.js";

const VALID = { type: "about:blank", title: "Not found", status: 404 };
const LIMIT = 64 * 1024;

function jsonResponse(body: string, contentType: string): Response {
	return new Response(body, { status: 404, headers: { "content-type": contentType } });
}

function streamedResponse(body: string, contentType: string): Response {
	const bytes = new TextEncoder().encode(body);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
	return new Response(stream, { status: 404, headers: { "content-type": contentType } });
}

describe("isProblemDetails()", () => {
	it("accepts a minimal problem", () => {
		expect(isProblemDetails({ title: "x", status: 400 })).toBe(true);
	});

	it("accepts a full problem with extensions", () => {
		expect(
			isProblemDetails({
				type: "https://example.com/t",
				title: "x",
				status: 422,
				detail: "d",
				instance: "/i",
				balance: 3,
			}),
		).toBe(true);
	});

	it.each([null, undefined, "string", 42, [], { title: "x" }, { status: 400 }])(
		"rejects non-problem value %j",
		(value) => {
			expect(isProblemDetails(value)).toBe(false);
		},
	);

	it("rejects an empty title", () => {
		expect(isProblemDetails({ title: "", status: 400 })).toBe(false);
	});

	it.each([99, 600, 400.5, "400", null])("rejects status %j", (status) => {
		expect(isProblemDetails({ title: "x", status })).toBe(false);
	});

	it.each([
		{ title: "x", status: 400, type: 1 },
		{ title: "x", status: 400, detail: 1 },
		{ title: "x", status: 400, instance: null },
	])("rejects wrong optional member types %j", (value) => {
		expect(isProblemDetails(value)).toBe(false);
	});
});

describe("parseProblem()", () => {
	it("parses an application/problem+json response", async () => {
		const response = jsonResponse(JSON.stringify(VALID), "application/problem+json");
		expect(await parseProblem(response)).toEqual(VALID);
	});

	it("accepts a charset parameter and mixed case media type", async () => {
		const response = jsonResponse(JSON.stringify(VALID), "Application/Problem+JSON; charset=utf-8");
		expect(await parseProblem(response)).toEqual(VALID);
	});

	it("parses application/json when title and status are present", async () => {
		const response = jsonResponse(JSON.stringify(VALID), "application/json");
		expect(await parseProblem(response)).toEqual(VALID);
	});

	it("returns undefined for application/json without a title", async () => {
		const response = jsonResponse(
			JSON.stringify({ error: "nope", status: 400 }),
			"application/json",
		);
		expect(await parseProblem(response)).toBeUndefined();
	});

	it("returns undefined for other content types even with a valid problem body", async () => {
		const response = jsonResponse(JSON.stringify(VALID), "text/plain");
		expect(await parseProblem(response)).toBeUndefined();
	});

	it("returns undefined when the content type is missing", async () => {
		const response = new Response(JSON.stringify(VALID), { status: 404 });
		response.headers.delete("content-type");
		expect(await parseProblem(response)).toBeUndefined();
	});

	it("returns undefined for malformed JSON without throwing", async () => {
		const response = jsonResponse("{ not json", "application/problem+json");
		await expect(parseProblem(response)).resolves.toBeUndefined();
	});

	it("returns undefined for a valid JSON body that is not a problem", async () => {
		const response = jsonResponse(
			JSON.stringify({ title: "x", status: 42 }),
			"application/problem+json",
		);
		expect(await parseProblem(response)).toBeUndefined();
	});

	it("returns undefined for an empty body", async () => {
		const response = new Response(null, {
			status: 404,
			headers: { "content-type": "application/problem+json" },
		});
		expect(await parseProblem(response)).toBeUndefined();
	});

	it("returns undefined for a body larger than 64 KiB, judged by Content-Length", async () => {
		const padding = "a".repeat(LIMIT + 10);
		const body = JSON.stringify({ ...VALID, detail: padding });
		const response = new Response(body, {
			status: 404,
			headers: {
				"content-type": "application/problem+json",
				"content-length": String(body.length),
			},
		});
		expect(await parseProblem(response)).toBeUndefined();
	});

	it("returns undefined for a streamed body larger than 64 KiB without Content-Length", async () => {
		const body = JSON.stringify({ ...VALID, detail: "b".repeat(LIMIT + 10) });
		const response = streamedResponse(body, "application/problem+json");
		expect(await parseProblem(response)).toBeUndefined();
	});

	it("parses a body just under the 64 KiB limit", async () => {
		const detail = "c".repeat(LIMIT - 200);
		const body = JSON.stringify({ ...VALID, detail });
		expect(body.length).toBeLessThan(LIMIT);
		const response = streamedResponse(body, "application/problem+json");
		expect((await parseProblem(response))?.detail).toBe(detail);
	});

	it("returns undefined instead of throwing when the body was already consumed", async () => {
		const response = jsonResponse(JSON.stringify(VALID), "application/problem+json");
		await response.text();
		await expect(parseProblem(response)).resolves.toBeUndefined();
	});

	it("returns extension members of a valid problem", async () => {
		const body = { ...VALID, balance: 30 };
		const response = jsonResponse(JSON.stringify(body), "application/problem+json");
		expect(await parseProblem(response)).toEqual(body);
	});
});
