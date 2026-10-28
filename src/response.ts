import {
	canCarryProblemBody,
	normalizeProblem,
	PROBLEM_CONTENT_TYPE,
	type ProblemDetails,
	ProblemError,
	type ProblemInput,
} from "./problem.js";

export interface ToResponseOptions {
	/** Extra headers. The Content-Type is always set to the problem media type. */
	headers?: HeadersInit;
}

/**
 * Creates a Web-standard `Response` carrying the problem as
 * `application/problem+json; charset=utf-8`. The problem is validated and
 * sanitized again before it is serialized.
 */
export function toResponse(problem: ProblemDetails, options: ToResponseOptions = {}): Response {
	const normalized = normalizeProblem(toProblemInput(problem));

	if (!canCarryProblemBody(normalized.status)) {
		throw new ProblemError([
			`status ${normalized.status} cannot be sent with a problem body (use 200-599, except 204, 205 and 304)`,
		]);
	}

	const headers = new Headers(options.headers);
	headers.set("content-type", PROBLEM_CONTENT_TYPE);

	return new Response(JSON.stringify(normalized), {
		status: normalized.status,
		headers,
	});
}

/** Converts the flattened wire shape into the input shape used for validation. */
function toProblemInput(value: ProblemDetails): ProblemInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ProblemError(["problem must be an object"]);
	}
	const { type, title, status, detail, instance, ...extensions } = value;
	return { type, title, status, detail, instance, extensions };
}
