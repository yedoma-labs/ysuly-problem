const WHITESPACE_RUNS = /\s+/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Makes free text safe for a human-readable problem field: every whitespace run
 * (tabs, line breaks, Unicode line separators) becomes one space, other control
 * characters are removed, surrounding whitespace is trimmed and the result is
 * cut to `maxLength` code points.
 */
export function sanitizeText(value: string, maxLength: number): string {
	const cleaned = value.replace(WHITESPACE_RUNS, " ").replace(CONTROL_CHARS, "").trim();
	return truncate(cleaned, maxLength);
}

/** Cuts a string to at most `maxLength` code points, ending with an ellipsis if cut. */
export function truncate(value: string, maxLength: number): string {
	// A string never has more code points than code units, so this is a cheap pre-check.
	if (value.length <= maxLength) {
		return value;
	}
	const chars = Array.from(value);
	if (chars.length <= maxLength) {
		return value;
	}
	return `${chars.slice(0, maxLength - 1).join("")}…`;
}
