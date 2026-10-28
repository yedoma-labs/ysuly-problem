import { normalizeProblem, ProblemError } from "./problem.js";

/** A problem definition that can be reused for errors of a known kind. */
export interface ProblemTemplate {
	type?: string;
	title: string;
	status: number;
	detail?: string;
}

export type ProblemTemplates = Readonly<Record<string, ProblemTemplate>>;

/**
 * How registry keys are matched against errors:
 * - `code`: `error.code === key` (default, survives minification)
 * - `className`: `error.constructor.name === key`
 * - `both`: either of the two
 */
export type MatchBy = "code" | "className" | "both";

export interface DefineProblemsOptions {
	by?: MatchBy;
}

export interface ProblemRegistry<T extends ProblemTemplates = ProblemTemplates> {
	readonly templates: T;
	readonly by: MatchBy;
}

const MATCH_MODES: ReadonlySet<string> = new Set(["code", "className", "both"]);

/**
 * Defines named problem templates for `fromError`. Every template is validated
 * immediately, so invalid definitions fail at startup instead of per request.
 *
 * @example
 * const problems = defineProblems({
 *   NotFound: { status: 404, title: "Not found", type: "https://example.com/problems/not-found" },
 * });
 * fromError(error, { registry: problems });
 */
export function defineProblems<const T extends ProblemTemplates>(
	templates: T,
	options: DefineProblemsOptions = {},
): ProblemRegistry<T> {
	const by = options.by ?? "code";
	const issues: string[] = [];

	if (!MATCH_MODES.has(by)) {
		issues.push('by must be "code", "className" or "both"');
	}

	for (const [key, template] of Object.entries(templates)) {
		if (key === "") {
			issues.push("template keys must be non-empty");
			continue;
		}
		try {
			normalizeProblem({ ...template, extensions: undefined });
		} catch (error) {
			if (error instanceof ProblemError) {
				issues.push(`${key}: ${error.issues.join("; ")}`);
			} else {
				throw error;
			}
		}
	}

	if (issues.length > 0) {
		throw new ProblemError(issues);
	}

	return Object.freeze({ templates: Object.freeze({ ...templates }), by });
}
