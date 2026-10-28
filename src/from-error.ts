import { normalizeProblem, type ProblemDetails } from "./problem.js";
import type { ProblemRegistry, ProblemTemplate } from "./registry.js";
import { truncate } from "./sanitize.js";

/** A class used as a registry key in `fromError`. Matched with `instanceof`. */
export type ErrorClass = abstract new (...args: never[]) => unknown;

export interface FromErrorOptions {
	/**
	 * Opt-in for unknown errors. Only when this returns `true` is the error
	 * message copied into `detail` (sanitized and length limited).
	 */
	expose?: (error: unknown) => boolean;
	/**
	 * Known errors. A `ProblemRegistry` from `defineProblems`, or a `Map` whose
	 * string keys match `error.code` and whose class keys match with `instanceof`.
	 * The first matching entry wins. Matched errors never expose their message.
	 */
	registry?: ProblemRegistry | ReadonlyMap<ErrorClass | string, ProblemTemplate>;
	/** Template for unknown errors. Defaults to status 500 and a generic title. */
	fallback?: ProblemTemplate;
	/** Request identifier. When set, `instance` becomes `urn:request:<id>`. */
	instanceFromRequestId?: string;
}

const DEFAULT_FALLBACK: ProblemTemplate = { status: 500, title: "Internal Server Error" };
const REQUEST_ID_MAX_LENGTH = 128;

/**
 * Maps any thrown value to a problem document without leaking internals.
 *
 * Unknown errors produce only the fallback (by default status 500 and a generic
 * title). Their `message`, `stack`, `cause` and `name` are never included unless
 * `expose(error)` returns `true`.
 */
export function fromError(error: unknown, options: FromErrorOptions = {}): ProblemDetails {
	const instance = instanceFor(options.instanceFromRequestId);

	const matched = findTemplate(error, options.registry);
	if (matched !== undefined) {
		return normalizeProblem({
			type: matched.type,
			title: matched.title,
			status: matched.status,
			detail: matched.detail,
			instance,
		});
	}

	const fallback = options.fallback ?? DEFAULT_FALLBACK;
	const exposed = options.expose !== undefined && isExposed(options.expose, error);
	return normalizeProblem({
		type: fallback.type,
		title: fallback.title,
		status: fallback.status,
		detail: exposed ? messageOf(error) : fallback.detail,
		instance,
	});
}

function instanceFor(requestId: string | undefined): string | undefined {
	if (requestId === undefined || requestId === "") {
		return undefined;
	}
	try {
		return `urn:request:${encodeURIComponent(truncate(requestId, REQUEST_ID_MAX_LENGTH))}`;
	} catch {
		// Lone surrogates cannot be encoded; an unusable request id is dropped, not thrown.
		return undefined;
	}
}

function findTemplate(
	error: unknown,
	registry: FromErrorOptions["registry"],
): ProblemTemplate | undefined {
	if (registry === undefined) {
		return undefined;
	}
	try {
		if (isMap(registry)) {
			for (const [matcher, template] of registry) {
				const hit =
					typeof matcher === "string"
						? readProperty(error, "code") === matcher
						: error instanceof matcher;
				if (hit) {
					return template;
				}
			}
			return undefined;
		}

		const { by, templates } = registry;
		for (const [key, template] of Object.entries(templates)) {
			const byCode = by !== "className" && readProperty(error, "code") === key;
			const byClassName = by !== "code" && constructorName(error) === key;
			if (byCode || byClassName) {
				return template;
			}
		}
		return undefined;
	} catch {
		// A throwing getter or hostile matcher must not change the response shape.
		return undefined;
	}
}

function isMap(
	registry: NonNullable<FromErrorOptions["registry"]>,
): registry is ReadonlyMap<ErrorClass | string, ProblemTemplate> {
	return registry instanceof Map;
}

function isExposed(expose: (error: unknown) => boolean, error: unknown): boolean {
	try {
		return expose(error) === true;
	} catch {
		return false;
	}
}

function messageOf(error: unknown): string | undefined {
	try {
		const message = readProperty(error, "message");
		return typeof message === "string" ? message : undefined;
	} catch {
		return undefined;
	}
}

function constructorName(value: unknown): string | undefined {
	const ctor = readProperty(value, "constructor");
	return typeof ctor === "function" ? ctor.name : undefined;
}

function readProperty(value: unknown, key: string): unknown {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) {
		return undefined;
	}
	return (value as Record<string, unknown>)[key];
}
