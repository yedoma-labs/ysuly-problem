# @yedoma-labs/ysuly-problem

<picture>
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/yedoma-labs/assets/main/resized/banner-resized-mobile.png">
  <img src="https://raw.githubusercontent.com/yedoma-labs/assets/main/resized/banner-resized.png" alt="Project Header">
</picture>

[![CI](https://github.com/yedoma-labs/ysuly-problem/actions/workflows/ci.yml/badge.svg)](https://github.com/yedoma-labs/ysuly-problem/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@yedoma-labs/ysuly-problem.svg)](https://www.npmjs.com/package/@yedoma-labs/ysuly-problem)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **ысулы** (*ysuly*) — Yakutian (Sakha) for "(noch zu bestätigen)"

Type-safe [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details for TypeScript, with a mapping from arbitrary thrown errors that never leaks internals. Zero runtime dependencies. Uses only Web-standard APIs (`Response`, `Headers`, `JSON`), so it runs on Node 20+, Bun, Deno and edge runtimes.

## The problem

API error responses are inconsistent. One endpoint returns plain text, another `{ error: "..." }`, a third `{ message, stack }`. The last shape is the dangerous one: stack traces, internal file paths and SQL error messages end up in the browser.

RFC 9457 (which obsoletes RFC 7807) defines a standard shape for error responses: `application/problem+json` with `type`, `title`, `status`, `detail` and `instance`. This library gives you:

- **Builders** that validate and sanitize problem documents.
- **A safe mapping** from any thrown value to a problem. Unknown errors become a generic 500. Nothing from the error object is copied unless you explicitly allow it.
- **Framework-free helpers.** `toResponse` returns a standard `Response`. There are no imports from Express, Hono, Fastify or similar. Adapters are one-line functions you write yourself (see below).
- **Client helpers** to recognize and parse problem responses.

## Install

```sh
pnpm add @yedoma-labs/ysuly-problem
```

## Quickstart

```ts
import { defineProblems, fromError, problem, toResponse } from "@yedoma-labs/ysuly-problem";

// A problem you construct yourself
const notEnough = problem({
	type: "https://example.com/problems/insufficient-funds",
	title: "Insufficient funds",
	status: 422,
	detail: "The account balance is lower than the requested amount.",
	instance: "/transfers/97",
	extensions: { balance: 30, requested: 50 },
});

// Known errors, mapped by their `code` property
const problems = defineProblems({
	NOT_FOUND: {
		type: "https://example.com/problems/not-found",
		title: "Not found",
		status: 404,
		detail: "The requested resource does not exist.",
	},
});

// Any thrown value: `error.message` and `error.stack` are never copied by default
export async function handle(request: Request): Promise<Response> {
	try {
		return await route(request); // your routing
	} catch (error) {
		return toResponse(
			fromError(error, {
				registry: problems,
				instanceFromRequestId: request.headers.get("x-request-id") ?? undefined,
			}),
		);
	}
}
```

`toResponse` returns a `Response` with `Content-Type: application/problem+json; charset=utf-8` and a JSON body.

## Framework adapters

The library has no framework imports. An adapter is a few lines in your own code. For Express, inside an error middleware `(err, req, res, next)`:

```ts
const p = fromError(err, { registry: problems });
res.status(p.status).type("application/problem+json").json(p);
```

For Web-standard runtimes, `toResponse` is the adapter.

## API

### `problem(input)`

Builds a validated `ProblemDetails`. Invalid input throws a `ProblemError` with `code === "INVALID_PROBLEM"` and an `issues` array.

- `status`: integer from 100 to 599 (required).
- `title`: required, sanitized, at most 200 characters.
- `type`: URI reference, defaults to `"about:blank"`.
- `detail`: optional, sanitized, at most 1000 characters.
- `instance`: optional URI reference.
- `extensions`: optional object. Keys `type`, `title`, `status`, `detail` and `instance` are rejected. Values must be JSON-serializable. Extensions are flattened into the output.

Text fields lose control characters, line breaks and tabs become single spaces, and over-long text is cut at a code point boundary with an ellipsis.

### `toResponse(problem, { headers? })`

Returns a `Response`. The problem is validated and sanitized again. Custom headers are merged, but `Content-Type` is always the problem media type. Statuses that cannot carry a body (1xx, 204, 205, 304) throw `ProblemError`.

### `fromError(error, options?)`

Maps any value to a `ProblemDetails`. Options:

- `registry`: a `defineProblems` result, or a `Map` whose string keys match `error.code` and whose class keys match with `instanceof`. The first matching entry wins.
- `expose(error) => boolean`: opt-in for unknown errors. Only when this returns `true` is `error.message` copied into `detail`, sanitized and truncated.
- `fallback`: template for unknown errors. Default: `{ status: 500, title: "Internal Server Error" }`.
- `instanceFromRequestId`: sets `instance` to `urn:request:<id>`.

### `defineProblems(templates, { by? })`

Defines named problem templates and validates them immediately. A template whose status cannot carry a body (any 1xx, 204, 205 and 304) is rejected here, so `toResponse` cannot fail later on a request. Each key is matched against `error.code` (default), against the error's constructor name (`by: "className"`), or against either (`by: "both"`). Matching never looks at `message`.

### `isProblemDetails(value)`

Type guard. `title` must be a non-empty string, `status` an integer from 100 to 599, and the optional members must have the right types.

### `parseProblem(response)`

Returns `Promise<ProblemDetails | undefined>`. It returns a problem only if the media type is `application/problem+json` or `application/json` and the body is a valid problem. Bodies over 64 KiB, malformed JSON and read errors return `undefined`. The function never throws. It consumes the response body, so call `response.clone()` first if you need the body later.

```ts
const response = await fetch("/api/transfers/97", { method: "POST", body });
if (!response.ok) {
	const problem = await parseProblem(response);
	console.error(problem?.title ?? response.statusText);
}
```

## Security rules

1. **Unknown errors are opaque.** Without a registry match and without `expose`, the response contains only the fallback status and title. No `message`, `stack`, `cause`, `name` or file paths.
2. **Registry matches use only the template.** The title, status, type and detail come from the template. `error.message` is never used for a matched error, even with `expose`.
3. **Exposure is an explicit opt-in per error.** Only `expose(error) === true` copies a message, and it is sanitized and truncated first.
4. **Matching is explicit.** Registry keys are matched against `code` or the constructor name, never against the message text.
5. **Errors from `problem()` carry no input values.** `ProblemError.message` lists the problems, not the offending data.
6. **Reserved members cannot be overridden through extensions.** `__proto__` is rejected as well.
7. **Client parsing is bounded.** `parseProblem` reads at most 64 KiB and never throws.

Limits of the library: it cannot tell which messages are sensitive. If you pass `expose: () => true`, every message reaches the client, so do that only for error types you have reviewed. Extensions are sent exactly as you give them. Do not put secrets in them.

## Comparison with http-problem-details

[`http-problem-details`](https://www.npmjs.com/package/http-problem-details) is an existing small package for the same standard. This library is intentionally slimmer and its main difference is the default error mapping:

- Unknown errors become a generic 500 by default. Messages are copied only after an explicit `expose` decision.
- Registry templates are validated when they are defined. Matching is explicit (`code`, class name, or both), never by message text.
- Only Web-standard APIs are used, with zero runtime dependencies.

I have not audited the full feature set of `http-problem-details` for this comparison. Check its API against your needs before choosing one.

## Runtime support

Node 20 and newer, Bun, Deno and edge runtimes that provide `Response`, `Headers`, `ReadableStream` and `TextDecoder`.

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
