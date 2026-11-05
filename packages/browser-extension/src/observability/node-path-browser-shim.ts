// The Raindrop core imports path.resolve only for optional local Git
// enrichment, which the observer turns off (appGit: false).
export function resolve(...segments: string[]) {
	return segments.filter(Boolean).join("/");
}
