// The Raindrop core imports execFile only for optional local Git enrichment,
// which the observer turns off (appGit: false). Fail any call like a missing
// binary so the SDK skips enrichment instead of breaking the trace.
export function execFile(..._args: unknown[]) {
	const callback = _args.find((arg) => typeof arg === "function") as ((error: Error) => void) | undefined;
	callback?.(new Error("child_process is unavailable in the browser extension"));
	return { kill() {} };
}
