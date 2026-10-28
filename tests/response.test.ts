import { describe, expect, it } from "vitest";
import { ProblemError, problem, toResponse } from "../src/index.js";

describe("toResponse()", () => {
	it("returns a Response with the problem media type and charset", () => {
		const response = toResponse(problem({ title: "Not found", status: 404 }));
		expect(response).toBeInstanceOf(Response);
		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
	});

	it("serializes the problem as JSON body", async () => {
		const response = toResponse(
			problem({
				type: "https://example.com/problems/limit",
				title: "Rate limited",
				status: 429,
				detail: "Try again later.",
				extensions: { retryAfter: 30 },
			}),
		);
		expect(await response.json()).toEqual({
			type: "https://example.com/problems/limit",
			title: "Rate limited",
			status: 429,
			detail: "Try again later.",
			retryAfter: 30,
		});
	});

	it("merges custom headers", () => {
		const response = toResponse(problem({ title: "x", status: 503 }), {
			headers: { "retry-after": "120", "x-request-id": "abc" },
		});
		expect(response.headers.get("retry-after")).toBe("120");
		expect(response.headers.get("x-request-id")).toBe("abc");
	});

	it("does not let custom headers override the Content-Type", () => {
		const response = toResponse(problem({ title: "x", status: 400 }), {
			headers: { "Content-Type": "text/html" },
		});
		expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
	});

	it("validates again and sanitizes a hand-made problem object", async () => {
		const response = toResponse({
			title: "Broken\u0000 title",
			status: 400,
			detail: "x".repeat(1200),
		});
		const body = (await response.json()) as { title: string; detail: string; type: string };
		expect(body.title).toBe("Broken title");
		expect(body.detail.length).toBe(1000);
		expect(body.type).toBe("about:blank");
	});

	it("throws for a hand-made object that is not a valid problem", () => {
		expect(() => toResponse({ title: "", status: 400 })).toThrow(ProblemError);
		expect(() => toResponse({ title: "x", status: 700 })).toThrow(ProblemError);
	});

	it("throws for a non-object input", () => {
		expect(() => toResponse(null as never)).toThrow(ProblemError);
		expect(() => toResponse("oops" as never)).toThrow(ProblemError);
	});

	it.each([100, 101, 103, 150, 199, 204, 205, 304])(
		"rejects status %i, which cannot carry a problem body",
		(status) => {
			expect(() => toResponse({ title: "x", status })).toThrow(ProblemError);
		},
	);

	it("accepts 200 and 599 as the outer bounds", () => {
		expect(toResponse({ title: "x", status: 200 }).status).toBe(200);
		expect(toResponse({ title: "x", status: 599 }).status).toBe(599);
	});
});
