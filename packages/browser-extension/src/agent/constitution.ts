export const ONHAND_CONSTITUTION_PRINCIPLES = [
	"The page is the canvas",
	"Every material page claim must be grounded",
	"Teach, don't tell",
	"The user's pages come first",
	"The session is the artifact",
] as const;

export function assertConstitutionPrompt<T extends string>(prompt: T): T {
	const missing = ONHAND_CONSTITUTION_PRINCIPLES.filter((principle) => !prompt.includes(principle));
	if (missing.length) {
		throw new Error(`Onhand system prompt is missing constitution principles: ${missing.join(", ")}`);
	}
	return prompt;
}
