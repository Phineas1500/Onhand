import { readFile } from "node:fs/promises";

export const TRAJECTORY_SCHEMA_VERSION = 1;
export const DEFAULT_PASS_SCORE = 0.9;

const PROFILE_VALUES = new Set(["legacy", "full-agent", "guided-agent"]);
const COMPLETION_VALUES = new Set(["answer", "honest-limitation"]);
const MUTATION_VALUES = new Set(["forbidden", "annotations-allowed", "interaction-required"]);

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function isObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, path) {
	assert(typeof value === "string" && value.trim(), `${path} must be a non-empty string`);
}

function requireNonNegativeNumber(value, path) {
	assert(Number.isFinite(value) && value >= 0, `${path} must be a non-negative number`);
}

function uniqueIds(items, path) {
	const ids = new Set();
	for (const [index, item] of items.entries()) {
		requireString(item?.id, `${path}[${index}].id`);
		assert(!ids.has(item.id), `${path} contains duplicate id ${item.id}`);
		ids.add(item.id);
	}
	return ids;
}

function validateBounds(expectations, path) {
	for (const key of [
		"minAnnotations",
		"maxAnnotations",
		"maxModelCalls",
		"maxToolCalls",
		"maxToolErrors",
		"maxDuplicateSources",
		"maxFocusChanges",
		"maxLatencyMs",
	]) {
		if (expectations[key] != null) requireNonNegativeNumber(expectations[key], `${path}.${key}`);
	}
	if (expectations.minAnnotations != null && expectations.maxAnnotations != null) {
		assert(expectations.minAnnotations <= expectations.maxAnnotations, `${path}.minAnnotations cannot exceed maxAnnotations`);
	}
}

export function validateTrajectoryCase(testCase, index = 0) {
	const path = `cases[${index}]`;
	assert(isObject(testCase), `${path} must be an object`);
	requireString(testCase.id, `${path}.id`);
	requireString(testCase.description, `${path}.description`);
	assert(Array.isArray(testCase.profiles) && testCase.profiles.length, `${path}.profiles must be a non-empty array`);
	for (const profile of testCase.profiles) assert(PROFILE_VALUES.has(profile), `${path}.profiles contains unsupported profile ${profile}`);
	assert(new Set(testCase.profiles).size === testCase.profiles.length, `${path}.profiles cannot contain duplicates`);

	assert(isObject(testCase.turn), `${path}.turn must be an object`);
	requireString(testCase.turn.prompt, `${path}.turn.prompt`);
	assert(testCase.turn.mode === "answer" || testCase.turn.mode === "learning", `${path}.turn.mode must be answer or learning`);

	assert(isObject(testCase.workspace), `${path}.workspace must be an object`);
	assert(Array.isArray(testCase.workspace.tabs) && testCase.workspace.tabs.length, `${path}.workspace.tabs must be a non-empty array`);
	const tabIds = uniqueIds(testCase.workspace.tabs, `${path}.workspace.tabs`);
	requireString(testCase.workspace.activeTabId, `${path}.workspace.activeTabId`);
	assert(tabIds.has(testCase.workspace.activeTabId), `${path}.workspace.activeTabId must reference a tab`);
	for (const [tabIndex, tab] of testCase.workspace.tabs.entries()) {
		requireString(tab.title, `${path}.workspace.tabs[${tabIndex}].title`);
		requireString(tab.url, `${path}.workspace.tabs[${tabIndex}].url`);
	}

	const resources = Array.isArray(testCase.workspace.resources) ? testCase.workspace.resources : [];
	const resourceIds = uniqueIds(resources, `${path}.workspace.resources`);
	const passageIds = new Set();
	const passageOwners = new Map();
	for (const [resourceIndex, resource] of resources.entries()) {
		assert(tabIds.has(resource.tabId), `${path}.workspace.resources[${resourceIndex}].tabId must reference a tab`);
		if (resource.parentSourceId != null) {
			assert(resourceIds.has(resource.parentSourceId), `${path}.workspace.resources[${resourceIndex}].parentSourceId is unknown`);
			assert(resource.parentSourceId !== resource.id, `${path}.workspace.resources[${resourceIndex}] cannot be its own parent`);
		}
		assert(Array.isArray(resource.passages), `${path}.workspace.resources[${resourceIndex}].passages must be an array`);
		for (const [passageIndex, passage] of resource.passages.entries()) {
			requireString(passage?.id, `${path}.workspace.resources[${resourceIndex}].passages[${passageIndex}].id`);
			assert(!passageIds.has(passage.id), `${path} contains duplicate passage id ${passage.id}`);
			requireString(passage.text, `${path}.workspace.resources[${resourceIndex}].passages[${passageIndex}].text`);
			passageIds.add(passage.id);
			passageOwners.set(passage.id, resource.id);
		}
	}

	assert(isObject(testCase.expectations), `${path}.expectations must be an object`);
	const expectations = testCase.expectations;
	assert(COMPLETION_VALUES.has(expectations.completion), `${path}.expectations.completion is invalid`);
	assert(MUTATION_VALUES.has(expectations.mutations), `${path}.expectations.mutations is invalid`);
	validateBounds(expectations, `${path}.expectations`);

	const evidenceSlots = Array.isArray(expectations.evidenceSlots) ? expectations.evidenceSlots : [];
	uniqueIds(evidenceSlots, `${path}.expectations.evidenceSlots`);
	for (const [slotIndex, slot] of evidenceSlots.entries()) {
		requireString(slot.description, `${path}.expectations.evidenceSlots[${slotIndex}].description`);
		assert(Array.isArray(slot.acceptableEvidence) && slot.acceptableEvidence.length, `${path}.expectations.evidenceSlots[${slotIndex}].acceptableEvidence must be non-empty`);
		for (const [evidenceIndex, evidence] of slot.acceptableEvidence.entries()) {
			assert(resourceIds.has(evidence.sourceId), `${path}.expectations.evidenceSlots[${slotIndex}].acceptableEvidence[${evidenceIndex}].sourceId is unknown`);
			assert(Array.isArray(evidence.passageIds) && evidence.passageIds.length, `${path}.expectations.evidenceSlots[${slotIndex}].acceptableEvidence[${evidenceIndex}].passageIds must be non-empty`);
			for (const passageId of evidence.passageIds) {
				assert(passageIds.has(passageId), `${path}.expectations.evidenceSlots[${slotIndex}] references unknown passage ${passageId}`);
				assert(passageOwners.get(passageId) === evidence.sourceId, `${path}.expectations.evidenceSlots[${slotIndex}] passage ${passageId} belongs to another source`);
			}
		}
	}

	const requiredToolGroups = expectations.requiredToolGroups || [];
	uniqueIds(requiredToolGroups, `${path}.expectations.requiredToolGroups`);
	for (const [groupIndex, group] of requiredToolGroups.entries()) {
		requireString(group?.id, `${path}.expectations.requiredToolGroups[${groupIndex}].id`);
		assert(Array.isArray(group.anyOf) && group.anyOf.length, `${path}.expectations.requiredToolGroups[${groupIndex}].anyOf must be non-empty`);
		for (const toolName of group.anyOf) requireString(toolName, `${path}.expectations.requiredToolGroups[${groupIndex}].anyOf`);
	}
	for (const toolName of expectations.forbiddenTools || []) requireString(toolName, `${path}.expectations.forbiddenTools`);

	return testCase;
}

export function validateTrajectorySuite(payload) {
	assert(isObject(payload), "trajectory suite must be an object");
	assert(payload.schemaVersion === TRAJECTORY_SCHEMA_VERSION, `schemaVersion must be ${TRAJECTORY_SCHEMA_VERSION}`);
	requireString(payload.suiteId, "suiteId");
	assert(Array.isArray(payload.cases) && payload.cases.length, "cases must be a non-empty array");
	uniqueIds(payload.cases, "cases");
	payload.cases.forEach((testCase, index) => validateTrajectoryCase(testCase, index));
	return payload;
}

export async function loadTrajectorySuite(path) {
	const payload = JSON.parse(await readFile(path, "utf8"));
	return validateTrajectorySuite(payload);
}

export function validateTrajectoryTrace(trace, index = 0) {
	const path = `traces[${index}]`;
	assert(isObject(trace), `${path} must be an object`);
	requireString(trace.caseId, `${path}.caseId`);
	requireString(trace.profile, `${path}.profile`);
	assert(PROFILE_VALUES.has(trace.profile), `${path}.profile is invalid`);
	requireString(trace.model, `${path}.model`);
	requireNonNegativeNumber(trace.iteration, `${path}.iteration`);
	assert(Number.isInteger(trace.iteration) && trace.iteration >= 1, `${path}.iteration must be a positive integer`);
	assert(typeof trace.completed === "boolean", `${path}.completed must be a boolean`);
	assert(Array.isArray(trace.toolCalls), `${path}.toolCalls must be an array`);
	assert(Array.isArray(trace.evidenceUses), `${path}.evidenceUses must be an array`);
	assert(Array.isArray(trace.annotations), `${path}.annotations must be an array`);
	for (const [toolIndex, toolCall] of trace.toolCalls.entries()) {
		requireString(toolCall?.name, `${path}.toolCalls[${toolIndex}].name`);
		assert(["complete", "error", "blocked", "recovered"].includes(toolCall.state), `${path}.toolCalls[${toolIndex}].state is invalid`);
	}
	for (const [evidenceIndex, evidence] of trace.evidenceUses.entries()) {
		requireString(evidence?.slotId, `${path}.evidenceUses[${evidenceIndex}].slotId`);
		requireString(evidence?.sourceId, `${path}.evidenceUses[${evidenceIndex}].sourceId`);
		requireString(evidence?.passageId, `${path}.evidenceUses[${evidenceIndex}].passageId`);
		assert(typeof evidence.citationPresent === "boolean", `${path}.evidenceUses[${evidenceIndex}].citationPresent must be a boolean`);
	}
	for (const [annotationIndex, annotation] of trace.annotations.entries()) {
		requireString(annotation?.sourceId, `${path}.annotations[${annotationIndex}].sourceId`);
		requireString(annotation?.passageId, `${path}.annotations[${annotationIndex}].passageId`);
	}
	for (const key of ["modelCalls", "latencyMs", "duplicateSources", "focusChanges", "unsupportedActionClaims", "pageMutations"]) {
		requireNonNegativeNumber(trace[key], `${path}.${key}`);
	}
	assert(typeof trace.provisionalAnswerExposed === "boolean", `${path}.provisionalAnswerExposed must be a boolean`);
	assert(typeof trace.honestLimitation === "boolean", `${path}.honestLimitation must be a boolean`);
	if (trace.completed) requireString(trace.reply, `${path}.reply`);
	if (trace.costUsd != null) requireNonNegativeNumber(trace.costUsd, `${path}.costUsd`);
	return trace;
}

export async function loadTrajectoryTraces(path) {
	const raw = String(await readFile(path, "utf8")).trim();
	if (!raw) return [];
	let traces;
	try {
		const parsed = JSON.parse(raw);
		traces = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.traces) ? parsed.traces : [parsed];
	} catch {
		traces = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
	}
	assert(Array.isArray(traces), "trace file must contain an array, object, or JSONL records");
	traces.forEach((trace, index) => validateTrajectoryTrace(trace, index));
	return traces;
}

function percentile(values, percentileValue) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
	return sorted[index];
}

function clamp(value) {
	return Math.max(0, Math.min(1, value));
}

function buildFixtureEvidenceIndex(testCase) {
	const index = new Map();
	for (const slot of testCase.expectations.evidenceSlots || []) {
		const accepted = new Set();
		for (const evidence of slot.acceptableEvidence || []) {
			for (const passageId of evidence.passageIds || []) accepted.add(`${evidence.sourceId}:${passageId}`);
		}
		index.set(slot.id, accepted);
	}
	return index;
}

function scoreEvidenceSlot(slot, trace, accepted) {
	const uses = trace.evidenceUses.filter((use) => use.slotId === slot.id);
	const valid = uses.filter((use) => accepted.has(`${use.sourceId}:${use.passageId}`));
	const hasEvidence = valid.length > 0;
	const hasCitation = !slot.requireCitation || valid.some((use) => use.citationPresent === true);
	const annotationPassageIds = new Set(trace.annotations.map((annotation) => `${annotation.sourceId}:${annotation.passageId}`));
	const hasAnnotation = !slot.requireAnnotation || valid.some((use) => annotationPassageIds.has(`${use.sourceId}:${use.passageId}`));
	return {
		id: slot.id,
		passed: hasEvidence && hasCitation && hasAnnotation,
		hasEvidence,
		hasCitation,
		hasAnnotation,
	};
}

function countToolErrors(trace) {
	return trace.toolCalls.filter((call) => call.state === "error").length;
}

function toolCount(trace, names) {
	const accepted = new Set(names);
	return trace.toolCalls.filter((call) => accepted.has(call.name) && (call.state === "complete" || call.state === "recovered")).length;
}

export function scoreTrajectory(testCase, trace, { passScore = DEFAULT_PASS_SCORE } = {}) {
	validateTrajectoryCase(testCase);
	validateTrajectoryTrace(trace);
	assert(trace.caseId === testCase.id, `trace caseId ${trace.caseId} does not match ${testCase.id}`);
	assert(testCase.profiles.includes(trace.profile), `${testCase.id} does not support profile ${trace.profile}`);

	const expectations = testCase.expectations;
	const hardFailures = [];
	const warnings = [];

	const completionPassed = trace.completed &&
		(expectations.completion === "answer" ? !trace.honestLimitation : trace.honestLimitation);
	if (!completionPassed) hardFailures.push(`completion:${expectations.completion}`);

	const evidenceIndex = buildFixtureEvidenceIndex(testCase);
	const evidenceSlots = (expectations.evidenceSlots || []).map((slot) => scoreEvidenceSlot(slot, trace, evidenceIndex.get(slot.id)));
	for (const slot of evidenceSlots.filter((slot) => !slot.passed)) hardFailures.push(`evidence-slot:${slot.id}`);

	const knownEvidenceKeys = new Set([...evidenceIndex.values()].flatMap((set) => [...set]));
	const unsupportedEvidenceUses = trace.evidenceUses.filter((use) => !knownEvidenceKeys.has(`${use.sourceId}:${use.passageId}`));
	if (unsupportedEvidenceUses.length) hardFailures.push(`unsupported-evidence:${unsupportedEvidenceUses.length}`);

	const requiredToolGroups = (expectations.requiredToolGroups || []).map((group) => ({
		id: group.id,
		passed: toolCount(trace, group.anyOf) >= (group.minCalls || 1),
	}));
	for (const group of requiredToolGroups.filter((group) => !group.passed)) hardFailures.push(`tool-group:${group.id}`);

	const forbiddenToolCalls = trace.toolCalls.filter((call) => (expectations.forbiddenTools || []).includes(call.name));
	if (forbiddenToolCalls.length) hardFailures.push(`forbidden-tools:${forbiddenToolCalls.length}`);

	const annotationCount = trace.annotations.length;
	if (expectations.minAnnotations != null && annotationCount < expectations.minAnnotations) hardFailures.push(`annotations-below-min:${annotationCount}`);
	if (expectations.maxAnnotations != null && annotationCount > expectations.maxAnnotations) hardFailures.push(`annotations-above-max:${annotationCount}`);
	if (expectations.mutations === "forbidden" && (trace.pageMutations > 0 || annotationCount > 0)) hardFailures.push("page-mutation-forbidden");
	if (expectations.mutations === "interaction-required" && trace.pageMutations < 1) hardFailures.push("page-interaction-missing");

	const limits = [
		["model-calls", trace.modelCalls, expectations.maxModelCalls],
		["tool-calls", trace.toolCalls.length, expectations.maxToolCalls],
		["tool-errors", countToolErrors(trace), expectations.maxToolErrors],
		["duplicate-sources", trace.duplicateSources, expectations.maxDuplicateSources],
		["focus-changes", trace.focusChanges, expectations.maxFocusChanges],
		["latency-ms", trace.latencyMs, expectations.maxLatencyMs],
	];
	for (const [label, value, maximum] of limits) {
		if (maximum != null && value > maximum) hardFailures.push(`${label}:${value}>${maximum}`);
	}
	if (expectations.requireNoProvisionalAnswer !== false && trace.provisionalAnswerExposed) hardFailures.push("provisional-answer-exposed");
	if (trace.unsupportedActionClaims > 0) hardFailures.push(`unsupported-action-claims:${trace.unsupportedActionClaims}`);

	const completionScore = completionPassed ? 1 : 0;
	const groundingScore = evidenceSlots.length
		? evidenceSlots.filter((slot) => slot.passed).length / evidenceSlots.length
		: expectations.completion === "honest-limitation" && trace.honestLimitation ? 1 : 0;
	const behaviorChecks = [
		forbiddenToolCalls.length === 0,
		!(expectations.mutations === "forbidden" && (trace.pageMutations > 0 || annotationCount > 0)),
		trace.duplicateSources <= (expectations.maxDuplicateSources ?? Number.POSITIVE_INFINITY),
		trace.focusChanges <= (expectations.maxFocusChanges ?? Number.POSITIVE_INFINITY),
		!trace.provisionalAnswerExposed,
		trace.unsupportedActionClaims === 0,
	];
	const behaviorScore = behaviorChecks.filter(Boolean).length / behaviorChecks.length;
	const efficiencyChecks = limits.slice(0, 3).filter(([, , maximum]) => maximum != null);
	const efficiencyScore = efficiencyChecks.length
		? efficiencyChecks.filter(([, value, maximum]) => value <= maximum).length / efficiencyChecks.length
		: 1;
	const score = clamp(completionScore * 0.25 + groundingScore * 0.4 + behaviorScore * 0.2 + efficiencyScore * 0.15);
	if (trace.costUsd == null) warnings.push("cost unavailable");

	return {
		caseId: testCase.id,
		profile: trace.profile,
		model: trace.model,
		iteration: trace.iteration,
		status: hardFailures.length === 0 && score >= passScore ? "pass" : "fail",
		score: Number(score.toFixed(4)),
		components: {
			completion: completionScore,
			grounding: Number(groundingScore.toFixed(4)),
			behavior: Number(behaviorScore.toFixed(4)),
			efficiency: Number(efficiencyScore.toFixed(4)),
		},
		evidenceSlots,
		requiredToolGroups,
		hardFailures,
		warnings,
		metrics: {
			latencyMs: trace.latencyMs,
			modelCalls: trace.modelCalls,
			toolCalls: trace.toolCalls.length,
			toolErrors: countToolErrors(trace),
			costUsd: trace.costUsd ?? null,
			duplicateSources: trace.duplicateSources,
			focusChanges: trace.focusChanges,
			annotationCount,
		},
	};
}

export function summarizeTrajectoryResults(results) {
	const groups = new Map();
	for (const result of results) {
		const key = `${result.profile}\u0000${result.model}`;
		const group = groups.get(key) || { profile: result.profile, model: result.model, results: [] };
		group.results.push(result);
		groups.set(key, group);
	}
	return [...groups.values()].map((group) => {
		const successful = group.results.filter((result) => result.status === "pass");
		const costs = group.results.map((result) => result.metrics.costUsd).filter(Number.isFinite);
		return {
			profile: group.profile,
			model: group.model,
			runs: group.results.length,
			passes: successful.length,
			passRate: group.results.length ? Number((successful.length / group.results.length).toFixed(4)) : 0,
			averageScore: group.results.length
				? Number((group.results.reduce((sum, result) => sum + result.score, 0) / group.results.length).toFixed(4))
				: 0,
			p95LatencyMs: percentile(group.results.map((result) => result.metrics.latencyMs), 0.95),
			totalCostUsd: costs.length ? Number(costs.reduce((sum, cost) => sum + cost, 0).toFixed(8)) : null,
			costPerSuccessfulTaskUsd: costs.length && successful.length
				? Number((costs.reduce((sum, cost) => sum + cost, 0) / successful.length).toFixed(8))
				: null,
		};
	});
}
