import { isRecord, isValidStatus, type ProblemDetails } from "./problem.js";

/** Largest problem body that `parseProblem` will read. */
const PARSE_MAX_BYTES = 64 * 1024;

/**
 * Type guard for problem documents: `title` is a non-empty string, `status` is
 * an integer between 100 and 599, and `type`, `detail`, `instance` are strings
 * when present. Extension members are not inspected.
 */
export function isProblemDetails(value: unknown): value is ProblemDetails {
	if (!isRecord(value)) {
		return false;
	}
	const { type, title, status, detail, instance } = value;
	return (
		typeof title === "string" &&
		title.length > 0 &&
		isValidStatus(status) &&
		(type === undefined || typeof type === "string") &&
		(detail === undefined || typeof detail === "string") &&
		(instance === undefined || typeof instance === "string")
	);
}

/**
 * Reads a problem document from a `Response`. Returns `undefined` unless the
 * media type is `application/problem+json` or `application/json` and the body is
 * a valid problem. Bodies over 64 KiB, malformed JSON and read errors also
 * yield `undefined`; this function never throws.
 *
 * The response body is consumed. Call `response.clone()` first if it is needed later.
 */
export async function parseProblem(response: Response): Promise<ProblemDetails | undefined> {
	try {
		const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
		if (mediaType !== "application/problem+json" && mediaType !== "application/json") {
			return undefined;
		}

		const declared = Number(response.headers.get("content-length"));
		if (Number.isFinite(declared) && declared > PARSE_MAX_BYTES) {
			await response.body?.cancel();
			return undefined;
		}

		const bytes = await readLimited(response.body, PARSE_MAX_BYTES);
		if (bytes === undefined) {
			return undefined;
		}

		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
		return isProblemDetails(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** Reads a stream up to `limit` bytes. Resolves to `undefined` if the limit is exceeded. */
async function readLimited(
	body: ReadableStream<Uint8Array> | null,
	limit: number,
): Promise<Uint8Array | undefined> {
	if (body === null) {
		return undefined;
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
