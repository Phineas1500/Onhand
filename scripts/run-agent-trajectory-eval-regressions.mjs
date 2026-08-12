#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	loadTrajectorySuite,
	loadTrajectoryTraces,
	scoreTrajectory,
	summarizeTrajectoryResults,
	validateTrajectorySuite,
	validateTrajectoryTrace,
} from "./lib/agent-trajectory-eval.mjs";
import {
	buildTrajectoryPdf,
	createTrajectoryFixtureCatalog,
	normalizeConfiguredRuntimeMetadata,
	normalizeLiveTrajectoryTrace,
} from "./lib/agent-trajectory-fixtures.mjs";

const SUITE_PATH = fileURLToPath(new URL("../evals/agent-trajectories/cases.json", import.meta.url));

function passingCurrentPageTrace() {
	return {
		caseId: "current-page-grounded-answer",
		profile: "legacy",
		model: "baseline-model",
		iteration: 1,
		completed: true,
		honestLimitation: false,
		reply: "It remains stable because each reading uses the same reference window.",
		toolCalls: [
			{ name: "browser_extract_content", state: "complete", sourceId: "calibration-article", passageIds: ["calibration-anchor"], durationMs: 120 },
			{ name: "browser_highlight_text", state: "complete", sourceId: "calibration-article", passageIds: ["calibration-anchor"], durationMs: 90 },
		],
		evidenceUses: [
			{ slotId: "mechanism", sourceId: "calibration-article", passageId: "calibration-anchor", citationPresent: true },
		],
		annotations: [
			{ sourceId: "calibration-article", passageId: "calibration-anchor", annotationId: "annotation-1" },
		],
		modelCalls: 1,
		latencyMs: 1500,
		costUsd: 0.001,
		duplicateSources: 0,
		focusChanges: 0,
		unsupportedActionClaims: 0,
		pageMutations: 1,
		provisionalAnswerExposed: false,
	};
}

async function main() {
	const suite = await loadTrajectorySuite(SUITE_PATH);
	assert.equal(suite.schemaVersion, 1);
	assert.equal(suite.cases.length, 11);
	assert.equal(new Set(suite.cases.map((testCase) => testCase.id)).size, suite.cases.length);

	const currentPageCase = suite.cases.find((testCase) => testCase.id === "current-page-grounded-answer");
	assert.ok(currentPageCase);
	const passing = passingCurrentPageTrace();
	validateTrajectoryTrace(passing);
	const passingResult = scoreTrajectory(currentPageCase, passing);
	assert.equal(passingResult.status, "pass");
	assert.equal(passingResult.score, 1);
	assert.deepEqual(passingResult.hardFailures, []);

	const missingCitation = structuredClone(passing);
	missingCitation.evidenceUses[0].citationPresent = false;
	const citationResult = scoreTrajectory(currentPageCase, missingCitation);
	assert.equal(citationResult.status, "fail");
	assert.ok(citationResult.hardFailures.includes("evidence-slot:mechanism"));

	const duplicateAndFocusFailure = structuredClone(passing);
	duplicateAndFocusFailure.duplicateSources = 1;
	duplicateAndFocusFailure.focusChanges = 1;
	duplicateAndFocusFailure.provisionalAnswerExposed = true;
	const behaviorResult = scoreTrajectory(currentPageCase, duplicateAndFocusFailure);
	assert.equal(behaviorResult.status, "fail");
	assert.ok(behaviorResult.hardFailures.some((failure) => failure.startsWith("duplicate-sources:")));
	assert.ok(behaviorResult.hardFailures.some((failure) => failure.startsWith("focus-changes:")));
	assert.ok(behaviorResult.hardFailures.includes("provisional-answer-exposed"));

	const failedTool = structuredClone(passing);
	failedTool.toolCalls[1].state = "error";
	const toolResult = scoreTrajectory(currentPageCase, failedTool);
	assert.equal(toolResult.status, "fail");
	assert.ok(toolResult.hardFailures.includes("tool-group:anchor-evidence"));

	const claimCheckCase = suite.cases.find((testCase) => testCase.id === "answer-mode-claim-check-background-tab");
	assert.ok(claimCheckCase, "the answer-mode background-tab claim-check case must exist");
	const claimCheckTrace = {
		caseId: "answer-mode-claim-check-background-tab",
		profile: "legacy",
		model: "baseline-model",
		iteration: 1,
		completed: true,
		honestLimitation: false,
		reply: "Not quite: the collapse is better described as aeroelastic flutter, not simple forced resonance.",
		toolCalls: [
			{ name: "browser_get_visible_text", state: "complete", sourceId: "textbook-page", passageIds: ["resonance-claim"], durationMs: 100 },
			{ name: "browser_extract_content", state: "complete", sourceId: "encyclopedia-article", passageIds: ["flutter-correction"], durationMs: 140 },
			{ name: "browser_highlight_text", state: "complete", sourceId: "textbook-page", passageIds: ["resonance-claim"], durationMs: 80 },
			{ name: "browser_highlight_text", state: "complete", sourceId: "encyclopedia-article", passageIds: ["flutter-correction"], durationMs: 90 },
		],
		evidenceUses: [
			{ slotId: "textbook-claim", sourceId: "textbook-page", passageId: "resonance-claim", citationPresent: true },
			{ slotId: "flutter-correction", sourceId: "encyclopedia-article", passageId: "flutter-correction", citationPresent: true },
		],
		annotations: [
			{ sourceId: "textbook-page", passageId: "resonance-claim", annotationId: "annotation-1" },
			{ sourceId: "encyclopedia-article", passageId: "flutter-correction", annotationId: "annotation-2" },
		],
		modelCalls: 2,
		latencyMs: 2500,
		costUsd: 0.002,
		duplicateSources: 0,
		focusChanges: 0,
		unsupportedActionClaims: 0,
		pageMutations: 2,
		provisionalAnswerExposed: false,
	};
	validateTrajectoryTrace(claimCheckTrace);
	const claimCheckResult = scoreTrajectory(claimCheckCase, claimCheckTrace);
	assert.equal(claimCheckResult.status, "pass", "reading and citing the background tab should pass the claim-check case");
	assert.deepEqual(claimCheckResult.hardFailures, []);

	const memoryOnlyTrace = structuredClone(claimCheckTrace);
	memoryOnlyTrace.toolCalls = [claimCheckTrace.toolCalls[0], claimCheckTrace.toolCalls[2]];
	memoryOnlyTrace.evidenceUses = [claimCheckTrace.evidenceUses[0]];
	memoryOnlyTrace.annotations = [claimCheckTrace.annotations[0]];
	memoryOnlyTrace.pageMutations = 1;
	const memoryOnlyResult = scoreTrajectory(claimCheckCase, memoryOnlyTrace);
	assert.equal(memoryOnlyResult.status, "fail", "correcting the page from model memory while the related tab sits open must fail the eval");
	assert.ok(memoryOnlyResult.hardFailures.includes("evidence-slot:flutter-correction"));

	const invalidSuite = structuredClone(suite);
	invalidSuite.cases[0].expectations.evidenceSlots[0].acceptableEvidence[0].passageIds = ["missing-passage"];
	assert.throws(() => validateTrajectorySuite(invalidSuite), /unknown passage missing-passage/);

	const summary = summarizeTrajectoryResults([passingResult, citationResult]);
	assert.equal(summary.length, 1);
	assert.equal(summary[0].runs, 2);
	assert.equal(summary[0].passes, 1);
	assert.equal(summary[0].passRate, 0.5);
	assert.equal(summary[0].costPerSuccessfulTaskUsd, 0.002);

	const catalog = createTrajectoryFixtureCatalog(suite, "http://127.0.0.1:8765");
	assert.deepEqual(
		normalizeConfiguredRuntimeMetadata({
			ok: true,
			state: {
				preferences: {
					aiProvider: "openai-codex",
					aiModel: "gpt-5.6-sol",
					extensionVersion: "0.4.2",
					runtimeRevision: "runtime-test",
				},
			},
		}),
		{
			provider: "openai-codex",
			model: "gpt-5.6-sol",
			extensionVersion: "0.4.2",
			runtimeRevision: "runtime-test",
		},
	);
	assert.deepEqual(
		normalizeConfiguredRuntimeMetadata({ settings: { aiProvider: "onhand-free", aiModel: "deepseek/deepseek-v4-flash" } }),
		{
			provider: "onhand-free",
			model: "deepseek/deepseek-v4-flash",
			extensionVersion: "",
			runtimeRevision: "",
		},
	);
	{
		const tab = currentPageCase.workspace.tabs[0];
		const tabUrl = catalog.tabUrl(currentPageCase, tab);
		assert.equal(catalog.resolve(tabUrl)?.sourceId, "calibration-article");
		// PDF annotations recorded in the Onhand viewer carry the viewer URL with
		// the fixture URL wrapped in its `url` query parameter; resolve() must
		// unwrap it (July pilot P0: PDF receipts normalized to zero annotations).
		const viewerWrappedUrl = `chrome-extension://hpjpjeehgbloadhdidmecpijppodibim/pdf-viewer.html?url=${encodeURIComponent(tabUrl)}&page=3`;
		assert.equal(
			catalog.resolve(viewerWrappedUrl)?.sourceId,
			"calibration-article",
			"viewer-wrapped fixture URLs must resolve to their source",
		);
		assert.equal(catalog.resolve("chrome-extension://hpjpjeehgbloadhdidmecpijppodibim/pdf-viewer.html"), null, "a viewer URL without a wrapped fixture stays unresolved");
		const selectedHomeworkCase = suite.cases.find((testCase) => testCase.id === "selected-homework-workspace-research");
		const pruningResource = selectedHomeworkCase.workspace.resources.find((resource) => resource.id === "pruning-slides");
		const pdf = buildTrajectoryPdf(pruningResource);
		assert.equal(pdf.subarray(0, 8).toString("utf8"), "%PDF-1.4");
		assert.match(pdf.toString("utf8"), /An L0 penalty controls model complexity/);
		const normalized = normalizeLiveTrajectoryTrace(
			currentPageCase,
			{
				turn: {
					reply: "It stays stable because each reading uses the same reference window. [1]",
					pending: false,
					error: false,
					modelCalls: 2,
					durationMs: 1400,
					provisionalAnswerExposed: false,
					toolTraces: [
						{
							toolName: "browser_extract_content",
							state: "complete",
							resultDetails: {
								tab: { url: tabUrl },
								content: { text: "The calibration remains stable because every reading is compared with the same reference window." },
							},
						},
						{
							toolName: "browser_highlight_text",
							state: "complete",
							resultDetails: {
								tab: { url: tabUrl },
								annotation: {
									annotationId: "fixture-highlight",
									matchedText: "The calibration remains stable because every reading is compared with the same reference window.",
								},
							},
						},
					],
					pageActions: [
						{
							type: "annotation",
							annotationId: "fixture-highlight",
							url: tabUrl,
							citationText: "The calibration remains stable because every reading is compared with the same reference window.",
						},
					],
				},
			},
			{ profile: "legacy", model: "fixture-model", iteration: 1, catalog },
		);
		validateTrajectoryTrace(normalized);
		assert.equal(normalized.modelCalls, 2);
		assert.equal(normalized.evidenceUses[0].passageId, "calibration-anchor");
		assert.equal(normalized.annotations[0].annotationId, "fixture-highlight");
		assert.equal(scoreTrajectory(currentPageCase, normalized).status, "pass");

		// PDF-shaped receipts: the action's URL is the Onhand viewer URL wrapping
		// the fixture, and the exact quote lives under pdfAnchor.textQuote.exact
		// rather than citationText. Pre-fix these normalized to zero annotations
		// (the July pilot's P0 evaluator gap), so PDF-case scores were floors.
		const pdfShaped = normalizeLiveTrajectoryTrace(
			currentPageCase,
			{
				turn: {
					reply: "It stays stable because each reading uses the same reference window. [1]",
					pending: false,
					error: false,
					modelCalls: 2,
					durationMs: 1400,
					provisionalAnswerExposed: false,
					toolTraces: [
						{
							toolName: "browser_pdf_read_pages",
							state: "complete",
							resultDetails: {
								tab: { url: viewerWrappedUrl },
								content: { text: "The calibration remains stable because every reading is compared with the same reference window." },
							},
						},
						{
							toolName: "browser_highlight_text",
							state: "complete",
							resultDetails: {
								tab: { url: viewerWrappedUrl },
								annotation: { annotationId: "fixture-pdf-highlight" },
							},
						},
					],
					pageActions: [
						{
							type: "annotation",
							annotationId: "fixture-pdf-highlight",
							url: viewerWrappedUrl,
							pdfAnchor: {
								textQuote: { exact: "The calibration remains stable because every reading is compared with the same reference window." },
							},
						},
					],
				},
			},
			{ profile: "legacy", model: "fixture-model", iteration: 1, catalog },
		);
		validateTrajectoryTrace(pdfShaped);
		assert.equal(
			pdfShaped.annotations[0]?.annotationId,
			"fixture-pdf-highlight",
			"viewer-wrapped PDF annotation actions must normalize into counted annotations",
		);

		// PDF text layers glue words across line boundaries, so the recorded
		// quote may read "...compared with the samereference window." — the
		// matcher must still map it to its passage (space-free fallback).
		const gluedShaped = normalizeLiveTrajectoryTrace(
			currentPageCase,
			{
				turn: {
					reply: "It stays stable because each reading uses the same reference window. [1]",
					pending: false,
					error: false,
					modelCalls: 2,
					durationMs: 1400,
					provisionalAnswerExposed: false,
					toolTraces: [
						{
							toolName: "browser_pdf_read_pages",
							state: "complete",
							resultDetails: {
								tab: { url: viewerWrappedUrl },
								content: { text: "The calibration remains stable because every reading is compared with the same reference window." },
							},
						},
					],
					pageActions: [
						{
							type: "annotation",
							annotationId: "fixture-glued-highlight",
							url: viewerWrappedUrl,
							citationText: "Calibration notes - page 2The calibration remains stable because every reading iscompared with the samereference window.",
						},
					],
				},
			},
			{ profile: "legacy", model: "fixture-model", iteration: 1, catalog },
		);
		assert.equal(
			gluedShaped.annotations[0]?.annotationId,
			"fixture-glued-highlight",
			"glued PDF text-layer quotes must still map to their passage",
		);

		const splitHighlight = normalizeLiveTrajectoryTrace(
			currentPageCase,
			{
				turn: {
					...normalized,
					toolTraces: [
						{
							toolName: "browser_extract_content",
							state: "complete",
							resultDetails: {
								tab: { url: tabUrl },
								content: { text: "The calibration remains stable because every reading is compared with the same reference window." },
							},
						},
						{
							toolName: "browser_highlight_text",
							state: "complete",
							args: { text: "The calibration remains stable because every reading is compared with the same reference window." },
							resultDetails: {
								tab: { url: tabUrl },
								annotation: { annotationId: "split-highlight", matchedText: "every reading is compared with the same reference window" },
							},
						},
					],
					pageActions: [
						{
							type: "annotation",
							annotationId: "split-highlight",
							url: tabUrl,
							citationText: "every reading is compared with the same reference window",
							anchor: { textQuote: { exact: "every reading is compared with the same reference window" } },
						},
					],
				},
			},
			{ profile: "legacy", model: "fixture-model", iteration: 1, catalog },
		);
		assert.equal(splitHighlight.annotations[0].annotationId, "split-highlight", "a source-anchored evidence fragment should count as the passage annotation");

		const navigationTrace = {
			toolName: "browser_navigate",
			state: "complete",
			args: { url: tabUrl },
			resultDetails: { tab: { url: tabUrl } },
		};
		const oneOpen = normalizeLiveTrajectoryTrace(
			currentPageCase,
			{ turn: { ...normalized, toolTraces: [navigationTrace] } },
			{ profile: "legacy", model: "fixture-model", iteration: 1, catalog },
		);
		assert.equal(oneOpen.duplicateSources, 0, "one navigation must not count twice when its URL appears in both args and result");
		const duplicateOpen = normalizeLiveTrajectoryTrace(
			currentPageCase,
			{ turn: { ...normalized, toolTraces: [navigationTrace, structuredClone(navigationTrace)] } },
			{ profile: "legacy", model: "fixture-model", iteration: 1, catalog },
		);
		assert.equal(duplicateOpen.duplicateSources, 1, "a second successful source open must count as a duplicate");
	}

	const tempDirectory = await mkdtemp(join(tmpdir(), "onhand-agent-trajectory-eval-"));
	try {
		const jsonlPath = join(tempDirectory, "traces.jsonl");
		await writeFile(jsonlPath, `${JSON.stringify(passing)}\n${JSON.stringify(missingCitation)}\n`, "utf8");
		const loadedTraces = await loadTrajectoryTraces(jsonlPath);
		assert.equal(loadedTraces.length, 2);
		assert.equal(loadedTraces[0].caseId, currentPageCase.id);
	} finally {
		await rm(tempDirectory, { force: true, recursive: true });
	}

	console.log("Agent trajectory eval regressions passed.");
}

main().catch((error) => {
	console.error(error.stack || error.message || String(error));
	process.exitCode = 1;
});
