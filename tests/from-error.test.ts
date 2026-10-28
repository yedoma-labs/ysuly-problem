import { describe, expect, it } from "vitest";
import {
	defineProblems,
	type ErrorClass,
	fromError,
	ProblemError,
	type ProblemTemplate,
	toResponse,
} from "../src/index.js";

const SECRET = "sk_live_9f8e7d6c";
const LEAKY_MESSAGE =
	`SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email (password=${SECRET}) ` +
	"at /home/deploy/app/src/db/query.ts:42:17 via /var/lib/secret/config.json";

class NotFoundError extends Error {
	readonly code = "NOT_FOUND";
}

class ConflictError extends Error {}

function leakyError(): Error {
	const error = new Error(LEAKY_MESSAGE);
	error.stack = `Error: ${LEAKY_MESSAGE}\n    at /home/deploy/app/src/index.ts:1:1`;
	return error;
}

describe("fromError() safe defaults", () => {
	it("maps an unknown error to a generic 500 without message, stack, cause or name", () => {
		const error = new Error(LEAKY_MESSAGE, { cause: new Error(`inner ${SECRET}`) });
		const result = fromError(error);

		expect(result).toEqual({
			type: "about:blank",
			title: "Internal Server Error",
			status: 500,
		});
		expect(result).not.toHaveProperty("detail");
		expect(result).not.toHaveProperty("stack");
		expect(result).not.toHaveProperty("cause");
		expect(result).not.toHaveProperty("name");
	});

	it("never serializes a secret or path from the error message", async () => {
		const result = fromError(leakyError());
		const json = JSON.stringify(result);
		const response = toResponse(result);
		const body = await response.text();

		for (const output of [json, body]) {
			expect(output).not.toContain(SECRET);
			expect(output).not.toContain("SQLITE_CONSTRAINT");
			expect(output).not.toContain("/home/deploy");
			expect(output).not.toContain("/var/lib/secret");
			expect(output).not.toContain("query.ts");
			expect(output).not.toContain("at /");
		}
	});

	it("keeps the secret out of JSON.stringify even when the message is long and nested", () => {
		const error = new Error(`${"x".repeat(5000)} ${SECRET}`);
		expect(JSON.stringify(fromError(error))).not.toContain(SECRET);
	});

	it("handles thrown non-Error values with the fallback", () => {
		for (const thrown of ["plain string", 42, null, undefined, { message: SECRET }, [SECRET]]) {
			const result = fromError(thrown);
			expect(result.status).toBe(500);
			expect(result.title).toBe("Internal Server Error");
			expect(JSON.stringify(result)).not.toContain(SECRET);
		}
	});

	it("does not treat a status property on the error as a mapping", () => {
		const error = Object.assign(new Error("boom"), { status: 404 });
		expect(fromError(error).status).toBe(500);
	});

	it("does not match registry entries by message", () => {
		const registry = defineProblems({ NotFound: { status: 404, title: "Not found" } });
		const result = fromError(new Error("NotFound"), { registry });
		expect(result.status).toBe(500);
	});

	it("uses a custom fallback template", () => {
		const result = fromError(new Error(SECRET), {
			fallback: { status: 503, title: "Service unavailable", detail: "Try later." },
		});
		expect(result).toEqual({
			type: "about:blank",
			title: "Service unavailable",
			status: 503,
			detail: "Try later.",
		});
	});

	it("falls back instead of throwing when error inspection fails", () => {
		const hostile = new Proxy(
			{},
			{
				get() {
					throw new Error(`getter exploded ${SECRET}`);
				},
			},
		);
		const registry = defineProblems({ Boom: { status: 400, title: "Boom" } });
		const result = fromError(hostile, { registry, expose: () => true });
		expect(result.status).toBe(500);
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	it("adds instance from a request id as urn:request", () => {
		const result = fromError(new Error("x"), { instanceFromRequestId: "req 42/a" });
		expect(result.instance).toBe("urn:request:req%2042%2Fa");
	});

	it("omits instance for an empty request id", () => {
		expect(fromError(new Error("x"), { instanceFromRequestId: "" })).not.toHaveProperty("instance");
	});

	it("truncates an overlong request id and still produces a valid document", () => {
		const result = fromError(new Error("x"), { instanceFromRequestId: "r".repeat(10_000) });
		expect(result.instance?.length).toBeLessThan(2048);
	});

	it("drops a request id that cannot be encoded instead of throwing", () => {
		const result = fromError(new Error("x"), { instanceFromRequestId: "\uD800" });
		expect(result).not.toHaveProperty("instance");
	});
});

describe("fromError() with expose", () => {
	it("copies the sanitized message when expose returns true", () => {
		const result = fromError(new Error("Name is\n  required\u0000"), { expose: () => true });
		expect(result.status).toBe(500);
		expect(result.detail).toBe("Name is required");
	});

	it("truncates an exposed message to 1000 characters", () => {
		const result = fromError(new Error("m".repeat(3000)), { expose: () => true });
		expect(Array.from(result.detail ?? "")).toHaveLength(1000);
	});

	it("passes the error to expose", () => {
		const error = new Error("visible");
		let seen: unknown;
		fromError(error, {
			expose: (value) => {
				seen = value;
				return false;
			},
		});
		expect(seen).toBe(error);
	});

	it("exposes nothing when expose returns false", () => {
		expect(fromError(leakyError(), { expose: () => false })).not.toHaveProperty("detail");
	});

	it("exposes nothing when expose returns a truthy value that is not true", () => {
		expect(fromError(leakyError(), { expose: () => 1 as unknown as boolean })).not.toHaveProperty(
			"detail",
		);
	});

	it("exposes nothing when expose throws", () => {
		const result = fromError(leakyError(), {
			expose: () => {
				throw new Error("broken callback");
			},
		});
		expect(result).not.toHaveProperty("detail");
	});

	it("does not expose the message of a registry match even when expose returns true", () => {
		const registry = defineProblems({ NOT_FOUND: { status: 404, title: "Not found" } });
		const result = fromError(new NotFoundError(LEAKY_MESSAGE), {
			registry,
			expose: () => true,
		});
		expect(result).not.toHaveProperty("detail");
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	it("exposes an empty message as no detail", () => {
		expect(fromError(new Error(""), { expose: () => true })).not.toHaveProperty("detail");
	});
});

describe("fromError() with a registry", () => {
	const problems = defineProblems({
		NOT_FOUND: {
			type: "https://example.com/problems/not-found",
			title: "Not found",
			status: 404,
			detail: "The requested resource does not exist.",
		},
		CONFLICT: { title: "Conflict", status: 409 },
	});

	it("uses the template title, status, type and detail for a code match", () => {
		const error = Object.assign(new Error(LEAKY_MESSAGE), { code: "NOT_FOUND" });
		expect(fromError(error, { registry: problems })).toEqual({
			type: "https://example.com/problems/not-found",
			title: "Not found",
			status: 404,
			detail: "The requested resource does not exist.",
		});
	});

	it("never uses error.message for a registry match", () => {
		const error = Object.assign(new Error(LEAKY_MESSAGE), { code: "CONFLICT" });
		const result = fromError(error, { registry: problems });
		expect(result.detail).toBeUndefined();
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	it("matches by class name with by: className", () => {
		const registry = defineProblems(
			{ NotFoundError: { status: 404, title: "Not found" } },
			{ by: "className" },
		);
		expect(fromError(new NotFoundError("x"), { registry }).status).toBe(404);
	});

	it("does not match by class name when by is code", () => {
		const registry = defineProblems({ NotFoundError: { status: 404, title: "Not found" } });
		expect(fromError(new NotFoundError("x"), { registry }).status).toBe(500);
	});

	it("matches a code with by: both", () => {
		const registry = defineProblems(
			{ NOT_FOUND: { status: 404, title: "Not found" } },
			{ by: "both" },
		);
		expect(fromError(new NotFoundError("x"), { registry }).status).toBe(404);
		expect(fromError(new ConflictError("x"), { registry }).status).toBe(500);
	});

	it("uses the first matching entry", () => {
		const registry = defineProblems(
			{
				FIRST: { status: 400, title: "First" },
				SECOND: { status: 422, title: "Second" },
			},
			{ by: "code" },
		);
		const error = Object.assign(new Error("x"), { code: "SECOND" });
		expect(fromError(error, { registry }).title).toBe("Second");
	});

	it("falls back for an error with no matching code", () => {
		expect(fromError(new Error("x"), { registry: problems }).status).toBe(500);
	});

	it("ignores codes that are not strings", () => {
		const error = Object.assign(new Error("x"), { code: 404 });
		expect(fromError(error, { registry: problems }).status).toBe(500);
	});

	it("maps by class with a Map using instanceof", () => {
		const registry = new Map<ErrorClass | string, ProblemTemplate>([
			[NotFoundError, { status: 404, title: "Not found" }],
		]);
		expect(fromError(new NotFoundError("secret"), { registry }).status).toBe(404);
		expect(fromError(new ConflictError("x"), { registry }).status).toBe(500);
	});

	it("maps by code with a Map using string keys", () => {
		const registry = new Map<ErrorClass | string, ProblemTemplate>([
			["RATE_LIMITED", { status: 429, title: "Too many requests" }],
		]);
		const error = Object.assign(new Error("x"), { code: "RATE_LIMITED" });
		expect(fromError(error, { registry }).status).toBe(429);
	});

	it("respects Map insertion order for class and code keys", () => {
		const registry = new Map<ErrorClass | string, ProblemTemplate>([
			[Error, { status: 400, title: "Generic" }],
			["NOT_FOUND", { status: 404, title: "Not found" }],
		]);
		const error = Object.assign(new NotFoundError("x"), { code: "NOT_FOUND" });
		expect(fromError(error, { registry }).title).toBe("Generic");
	});

	it("produces a valid response for a registry match", async () => {
		const error = Object.assign(new Error(LEAKY_MESSAGE), { code: "NOT_FOUND" });
		const response = toResponse(fromError(error, { registry: problems }));
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain(SECRET);
	});
});

describe("defineProblems()", () => {
	it("returns the templates and the default match mode", () => {
		const registry = defineProblems({ NotFound: { status: 404, title: "Not found" } });
		expect(registry.by).toBe("code");
		expect(registry.templates.NotFound).toEqual({ status: 404, title: "Not found" });
	});

	it("returns a frozen registry", () => {
		const registry = defineProblems({ NotFound: { status: 404, title: "Not found" } });
		expect(Object.isFrozen(registry)).toBe(true);
		expect(Object.isFrozen(registry.templates)).toBe(true);
	});

	it("rejects invalid templates at definition time with all issues", () => {
		let caught: unknown;
		try {
			defineProblems({
				Bad: { status: 42, title: "" },
				Worse: { status: 404, title: "ok", type: "has space" },
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ProblemError);
		const issues = (caught as ProblemError).issues;
		expect(issues.some((issue) => issue.startsWith("Bad:"))).toBe(true);
		expect(issues.some((issue) => issue.startsWith("Worse:"))).toBe(true);
	});

	it("rejects an unknown match mode", () => {
		expect(() =>
			defineProblems(
				{ NotFound: { status: 404, title: "Not found" } },
				{
					by: "message" as unknown as "code",
				},
			),
		).toThrow(ProblemError);
	});

	it("rejects an empty template key", () => {
		expect(() => defineProblems({ "": { status: 400, title: "x" } })).toThrow(ProblemError);
	});
});
