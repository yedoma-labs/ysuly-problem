import { describe, expect, it } from "vitest";
import { ProblemError, problem } from "../src/index.js";

function expectInvalid(fn: () => unknown): ProblemError {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(ProblemError);
		const problemError = error as ProblemError;
		expect(problemError.code).toBe("INVALID_PROBLEM");
		return problemError;
	}
	throw new Error("expected problem() to throw");
}

describe("problem()", () => {
	it("builds a document with type defaulting to about:blank", () => {
		expect(problem({ title: "Not found", status: 404 })).toEqual({
			type: "about:blank",
			title: "Not found",
			status: 404,
		});
	});

	it("keeps type, detail and instance when given", () => {
		const result = problem({
			type: "https://example.com/problems/out-of-stock",
			title: "Out of stock",
			status: 409,
			detail: "Item 42 is sold out.",
			instance: "/orders/42",
		});
		expect(result).toEqual({
			type: "https://example.com/problems/out-of-stock",
			title: "Out of stock",
			status: 409,
			detail: "Item 42 is sold out.",
			instance: "/orders/42",
		});
	});

	it("flattens extensions next to the standard members", () => {
		const result = problem({
			title: "Insufficient funds",
			status: 422,
			extensions: { balance: 30, accounts: ["a", "b"] },
		});
		expect(result).toEqual({
			type: "about:blank",
			title: "Insufficient funds",
			status: 422,
			balance: 30,
			accounts: ["a", "b"],
		});
		expect(result).not.toHaveProperty("extensions");
	});

	it("omits optional members that are not given", () => {
		const result = problem({ title: "Gone", status: 410 });
		expect(Object.keys(result).sort()).toEqual(["status", "title", "type"]);
	});

	describe("status validation", () => {
		it.each([99, 600, 1000, 200.5, Number.NaN, Number.POSITIVE_INFINITY, -1])(
			"rejects status %s",
			(status) => {
				const error = expectInvalid(() => problem({ title: "x", status }));
				expect(error.issues).toContain("status must be an integer between 100 and 599");
			},
		);

		it("accepts the boundaries 100 and 599", () => {
			expect(problem({ title: "x", status: 100 }).status).toBe(100);
			expect(problem({ title: "x", status: 599 }).status).toBe(599);
		});

		it("rejects a status given as string", () => {
			expectInvalid(() => problem({ title: "x", status: "404" as unknown as number }));
		});
	});

	describe("title validation", () => {
		it.each(["", "   ", "\n\t", "\u0000\u0007"])("rejects empty title %j", (title) => {
			const error = expectInvalid(() => problem({ title, status: 400 }));
			expect(error.issues).toContain("title must be a non-empty string");
		});

		it("rejects a non-string title", () => {
			expectInvalid(() => problem({ title: 42 as unknown as string, status: 400 }));
		});
	});

	describe("type and instance validation", () => {
		it.each(["", " ", "has space", "tab\there", "bad\u0000char"])(
			"rejects invalid type %j",
			(type) => {
				expectInvalid(() => problem({ type, title: "x", status: 400 }));
			},
		);

		it("rejects an instance with whitespace", () => {
			expectInvalid(() => problem({ title: "x", status: 400, instance: "/a b" }));
		});

		it("rejects an empty instance", () => {
			expectInvalid(() => problem({ title: "x", status: 400, instance: "" }));
		});

		it("rejects a type longer than 2048 characters", () => {
			expectInvalid(() => problem({ type: "a".repeat(2049), title: "x", status: 400 }));
		});
	});

	describe("extension validation", () => {
		it.each(["type", "title", "status", "detail", "instance"])(
			"rejects reserved extension key %s",
			(key) => {
				const error = expectInvalid(() =>
					problem({ title: "x", status: 400, extensions: { [key]: "value" } }),
				);
				expect(error.issues[0]).toContain(`extension key "${key}" collides`);
			},
		);

		it("rejects __proto__ as extension key", () => {
			const extensions = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
			expectInvalid(() => problem({ title: "x", status: 400, extensions }));
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		});

		it("rejects values that cannot be serialized to JSON", () => {
			const circular: Record<string, unknown> = {};
			circular.self = circular;
			expectInvalid(() => problem({ title: "x", status: 400, extensions: { circular } }));
			expectInvalid(() => problem({ title: "x", status: 400, extensions: { big: 10n } }));
			expectInvalid(() => problem({ title: "x", status: 400, extensions: { fn: () => 1 } }));
			expectInvalid(() => problem({ title: "x", status: 400, extensions: { u: undefined } }));
		});

		it("rejects extensions that are not a plain object", () => {
			expectInvalid(() =>
				problem({
					title: "x",
					status: 400,
					extensions: [1, 2] as unknown as Record<string, unknown>,
				}),
			);
		});
	});

	describe("sanitization", () => {
		it("removes control characters from title and detail", () => {
			const result = problem({
				title: "Bad\u0000 \u0007input\u001b",
				status: 400,
				detail: "line\u0085one\u007f",
			});
			expect(result.title).toBe("Bad input");
			expect(result.detail).toBe("lineone");
		});

		it("turns line breaks and tabs into single spaces", () => {
			const result = problem({
				title: "First\r\nSecond\tThird Fourth",
				status: 400,
				detail: "a\n\n\nb",
			});
			expect(result.title).toBe("First Second Third Fourth");
			expect(result.detail).toBe("a b");
		});

		it("trims surrounding whitespace", () => {
			expect(problem({ title: "  Padded  ", status: 400 }).title).toBe("Padded");
		});

		it("drops a detail that is empty after sanitization", () => {
			const result = problem({ title: "x", status: 400, detail: "\u0000\n" });
			expect(result).not.toHaveProperty("detail");
		});

		it("does not accept control characters in type or instance", () => {
			expectInvalid(() => problem({ title: "x", status: 400, instance: "/a\u0001" }));
		});
	});

	describe("length limits", () => {
		it("cuts the title to 200 characters and ends it with an ellipsis", () => {
			const result = problem({ title: "a".repeat(500), status: 400 });
			expect(Array.from(result.title)).toHaveLength(200);
			expect(result.title.endsWith("…")).toBe(true);
		});

		it("keeps a title of exactly 200 characters unchanged", () => {
			const title = "b".repeat(200);
			expect(problem({ title, status: 400 }).title).toBe(title);
		});

		it("cuts the detail to 1000 characters", () => {
			const result = problem({ title: "x", status: 400, detail: "c".repeat(1500) });
			expect(Array.from(result.detail ?? "")).toHaveLength(1000);
		});

		it("never splits surrogate pairs when cutting", () => {
			const result = problem({ title: "\u{1F600}".repeat(250), status: 400 });
			expect(Array.from(result.title)).toHaveLength(200);
			expect(result.title).not.toMatch(/[\uD800-\uDBFF]$/);
		});
	});

	describe("errors", () => {
		it("reports every issue at once", () => {
			const error = expectInvalid(() => problem({ title: "", status: 50 }));
			expect(error.issues).toHaveLength(2);
			expect(error.name).toBe("ProblemError");
		});

		it("does not echo input values into the error message", () => {
			const secret = "sk_live_super_secret_value";
			const error = expectInvalid(() =>
				problem({
					title: "",
					status: 400,
					instance: `/${secret} bad`,
					detail: 42 as unknown as string,
				}),
			);
			expect(error.message).not.toContain(secret);
		});
	});
});
