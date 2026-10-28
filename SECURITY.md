# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

Until 1.0.0 only the latest published minor release receives security fixes.

## Security Model

`@yedoma-labs/ysuly-problem` turns errors into HTTP error responses. The security goal is that **internal information never reaches the client by default**. The library assumes:

- **Thrown errors are untrusted for output.** Their messages, stacks and causes can contain SQL, file paths, secrets or user data.
- **Registry definitions and fallback templates are trusted** (developer code).
- **Extensions and `detail` passed to `problem()` are the developer's responsibility.** They are validated and sanitized, but not checked for secrets.
- **Response bodies from remote servers are untrusted** when read with `parseProblem`.

## Security Features

1. **Opaque mapping of unknown errors**
   - Without a registry match and without `expose(error) === true`, `fromError` returns only the fallback status and title.
   - `message`, `stack`, `cause`, `name` and paths are never copied.

2. **Template-only output for known errors**
   - Registry matches use the template's title, status, type and detail.
   - `error.message` is never used for a registry match, even when `expose` returns `true`.

3. **Explicit exposure**
   - Messages are copied only when `expose(error)` returns exactly `true`. Exceptions thrown by `expose` count as `false`.
   - Copied messages are sanitized (control characters and line breaks removed) and truncated to 1000 characters.

4. **Explicit matching**
   - Registry keys match `error.code` or the constructor name. Matching never inspects `message`.
   - Inspecting an error never throws out of `fromError`. A throwing getter results in the fallback.

5. **Validated input**
   - Status must be an integer from 100 to 599. Titles and details are sanitized and length limited.
   - `type` and `instance` must be URI references without whitespace or control characters.
   - Extension keys `type`, `title`, `status`, `detail` and `instance` are rejected, as is `__proto__`. Extension values must be JSON-serializable.
   - Invalid input throws `ProblemError` (`code: "INVALID_PROBLEM"`). The error message lists the problems, not the input values.

6. **Bounded client parsing**
   - `parseProblem` reads at most 64 KiB, returns `undefined` for anything that is not a valid problem, and never throws.

7. **No runtime dependencies**
   - Only Web-standard APIs are used, which reduces the supply-chain surface.

## Known Limitations

- **Opt-in exposure is only as safe as the decision behind it.** `expose: () => true` sends every message to the client. Use it only for error types you have reviewed.
- **Message sanitization is not secret detection.** A message that contains a secret will still contain it after sanitization, minus control characters.
- **Extensions are sent as given.** Do not put secrets or internal identifiers in extensions or in `detail` you create yourself.
- **Stack traces are never produced by this library.** Log them server side, not in the response.

## Reporting Vulnerabilities

If you discover a security vulnerability in `@yedoma-labs/ysuly-problem`, please open a GitHub issue.

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to respond within 48 hours and will coordinate disclosure.

## Security Best Practices

1. **Keep the default mapping.** Use `expose` only for specific, reviewed error classes.

   ```ts
   // BAD: leaks every message, including SQL errors
   fromError(error, { expose: () => true });

   // GOOD: expose only your own validation errors
   fromError(error, { expose: (e) => e instanceof ValidationError });
   ```

2. **Map known errors through a registry.** The template is the only text the client receives.

   ```ts
   const problems = defineProblems({
   	NOT_FOUND: { status: 404, title: "Not found" },
   });
   ```

3. **Log the original error on the server.** The response carries only the problem.

4. **Do not put secrets into problem fields.** `title`, `detail` and extensions are visible to every client that receives them.

5. **Validate `parseProblem` results before displaying them.** Treat `title` and `detail` from remote servers as untrusted text.

## License

MIT - See [LICENSE](LICENSE) for details.
