import { sanitizeText } from "./sanitize.js";

/** Content-Type for RFC 9457 problem documents. */
export const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=utf-8";

/** Default problem `type` as defined by RFC 9457. */
export const DEFAULT_PROBLEM_TYPE = "about:blank";

export const TITLE_MAX_LENGTH = 200;
export const DETAIL_MAX_LENGTH = 1000;
const URI_MAX_LENGTH = 2048;

/**
 * Whether a response with this status can carry a problem body: 200-599, except
 * 204, 205 and 304, which must not have a body.
 */
export function canCarryProblemBody(status: number): boolean {
	return status >= 200 && status !== 204 && status !== 205 && status !== 304;
}

/** Members defined by RFC 9457. They may not be used as extension keys. */
export const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
	"type",
	"title",
	"status",
	"detail",
	"instance",
]);

/**
 * An RFC 9457 problem document. Extension members are flattened next to the
 * standard members, as the specification requires.
 */
export interface ProblemDetails {
	type?: string;
	title: string;
	status: number;
	detail?: string;
	instance?: string;
	[extension: string]: unknown;
}

/**
 * Input for `problem()`. Extensions are passed separately so that they can be
 * checked against the reserved members before a document is built.
 */
export interface ProblemInput {
	type?: string;
	title: string;
	status: number;
	detail?: string;
	instance?: string;
	extensions?: Readonly<Record<string, unknown>>;
}

export type ProblemErrorCode = "INVALID_PROBLEM";

/** Thrown when problem details cannot be built or are invalid. Carries no input values. */
export class ProblemError extends Error {
	readonly code: ProblemErrorCode = "INVALID_PROBLEM";
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(`Invalid problem details: ${issues.join("; ")}`);
		this.name = "ProblemError";
		this.issues = issues;
	}
}

/**
 * Builds a validated problem document. Text fields are sanitized and length
 * limited; invalid input throws a `ProblemError` with code `INVALID_PROBLEM`.
 */
export function problem(input: ProblemInput): ProblemDetails {
	return normalizeProblem(input);
}

/** @internal Validates and normalizes a problem input. Shared by all helpers. */
export function normalizeProblem(input: ProblemInput): ProblemDetails {
	const issues: string[] = [];

	if (!isValidStatus(input.status)) {
		issues.push("status must be an integer between 100 and 599");
	}

	const title = typeof input.title === "string" ? sanitizeText(input.title, TITLE_MAX_LENGTH) : "";
	if (title === "") {
		issues.push("title must be a non-empty string");
	}

	const type =
		input.type === undefined ? DEFAULT_PROBLEM_TYPE : uriReference("type", input.type, issues);
	const instance =
		input.instance === undefined ? undefined : uriReference("instance", input.instance, issues);
	const detail = optionalText("detail", input.detail, DETAIL_MAX_LENGTH, issues);

	const extensions: Record<string, unknown> = {};
	if (input.extensions !== undefined) {
		if (!isRecord(input.extensions)) {
			issues.push("extensions must be a plain object");
		} else {
			for (const [key, value] of Object.entries(input.extensions)) {
				if (RESERVED_MEMBERS.has(key)) {
					issues.push(`extension key "${key}" collides with a reserved problem member`);
				} else if (key === "__proto__") {
					issues.push('extension key "__proto__" is not allowed');
				} else if (!isJsonSerializable(value)) {
					issues.push(`extension "${key}" must be JSON-serializable`);
				} else {
					extensions[key] = value;
				}
			}
		}
	}

	if (issues.length > 0) {
		throw new ProblemError(issues);
	}

	const result: ProblemDetails = { type, title, status: input.status };
	if (detail !== undefined) {
		result.detail = detail;
	}
	if (instance !== undefined) {
		result.instance = instance;
	}
	for (const [key, value] of Object.entries(extensions)) {
		result[key] = value;
	}
	return result;
}

/** @internal */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @internal */
export function isValidStatus(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}

const URI_REFERENCE_FORBIDDEN = /[\s\u0000-\u001f\u007f]/;

function uriReference(name: string, value: unknown, issues: string[]): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > URI_MAX_LENGTH ||
		URI_REFERENCE_FORBIDDEN.test(value)
	) {
		issues.push(
			`${name} must be a non-empty URI reference without whitespace or control characters (max ${URI_MAX_LENGTH} characters)`,
		);
		return "";
	}
	return value;
}

function optionalText(
	name: string,
	value: unknown,
	maxLength: number,
	issues: string[],
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		issues.push(`${name} must be a string`);
		return undefined;
	}
	const text = sanitizeText(value, maxLength);
	return text === "" ? undefined : text;
}

function isJsonSerializable(value: unknown): boolean {
	try {
		return JSON.stringify(value) !== undefined;
	} catch {
		return false;
	}
}
