export function normalizeOpenTabUrlForComparison(value: unknown, { keepFragment = false }: { keepFragment?: boolean } = {}) {
	const trimmed = String(value || "").trim();
	// Restore matching ignores fragments, while navigation deduplication keeps
	// them so distinct in-page destinations remain independently addressable.
	const text = keepFragment ? trimmed : trimmed.replace(/#.*$/, "");
	// Scheme and host are case-insensitive. Preserve path/query casing and all
	// non-root trailing slashes because servers may treat them as distinct.
	const match = text.match(/^(https?:\/\/[^/?#]*)([\s\S]*)$/i);
	if (!match) return text;
	const rest = match[2] === "/" ? "" : match[2];
	return `${match[1].toLowerCase()}${rest}`;
}

export function applyBackgroundFocusDefault(
	params: any,
	commandName: string,
	{ learningMode = false, sourceFocusRequested = false }: { learningMode?: boolean; sourceFocusRequested?: boolean } = {},
) {
	if (!learningMode || sourceFocusRequested) return params;
	if (commandName === "navigate" && params?.newTab !== false) return { ...(params || {}), active: false };
	if (commandName === "open_pdf_in_onhand_viewer") return { ...(params || {}), active: false };
	return params;
}

export function buildEmptyHighlightTextGuardResult(toolName: string, commandName: string, params: any) {
	if (commandName !== "highlight_text") return null;
	if (String(params?.text || "").trim()) return null;
	return {
		guardrail: {
			kind: "empty_highlight_text",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"browser_highlight_text requires a non-empty exact visible or readable text span.",
				`Do not call ${toolName} with empty text.`,
				"Use a short exact heading, phrase, or sentence from browser_extract_content or browser_get_visible_text, then retry if a source marker is still needed.",
			].join(" "),
		},
	};
}
