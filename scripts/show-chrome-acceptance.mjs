const DEFAULT_RUN_ID = `chrome-acceptance-${new Date().toISOString().slice(0, 10)}`;

const OPERATOR_NOTES = [
	"Use Computer Use for chrome://extensions reloads, the Onhand options page, the Onhand side panel, and prompt submission.",
	"Use the Codex Chrome Extension backend only for normal web page automation after extension UI is closed.",
	"If Codex Chrome reports that another extension UI is open, close the side panel, extension options tab, or chrome://extensions tab and retry page automation.",
	"Treat that Codex Chrome blocker as an automation conflict unless the Onhand side-panel prompt itself fails with an OAuth or model error.",
];

const suites = {
	oauth: {
		label: "OAuth prompt probe",
		setup: [
			"confirm extension options show authMode oauth, aiProvider openai-codex, aiModel gpt-5.5, hasOAuthCredentials true, and expired false",
			"close extension options, chrome://extensions, and any open Onhand side panel before using Codex Chrome page automation",
			"open https://en.wikipedia.org/wiki/Personal_computer in Chrome",
			"open the Onhand side panel with Computer Use",
			"start a fresh Onhand side-panel session named OAuth validation {runId}",
		],
		cases: [
			{
				id: "oauth-wikipedia",
				title: "OAuth side-panel prompt submission",
				url: "https://en.wikipedia.org/wiki/Personal_computer",
				prompt:
					"OAUTH VALIDATION {runId}: Use browser_get_visible_text on this page. Answer only: OAUTH_VALIDATION_PASS <page title> contains_personal_computer=<yes/no>.",
				expected: [
					"answer starts with OAUTH_VALIDATION_PASS",
					"page title identifies Personal computer",
					"answer includes contains_personal_computer=yes",
				],
			},
		],
	},
	fixture: {
		label: "Local fixture matrix",
		setup: [
			"npm run build:extension",
			"reload the unpacked Chrome extension from packages/browser-extension/ using Computer Use on chrome://extensions",
			"confirm extension options show authMode oauth, aiProvider openai-codex, aiModel gpt-5.5, hasOAuthCredentials true, and expired false",
			"npm run serve:fixture",
			"open http://127.0.0.1:8765/ in Chrome",
			"start a fresh Onhand side-panel session named Chrome acceptance {runId}",
		],
		cases: [
			{
				id: "fixture-read",
				title: "Fixture read/extract/selection",
				url: "http://127.0.0.1:8765/",
				prompt:
					"CHROME ACCEPTANCE FIXTURE READ {runId}: Use browser_get_visible_text, browser_extract_content, browser_get_viewport_headings, browser_get_scroll_state, and browser_get_selection on this page. Answer only a compact checklist with PASS/FAIL for each, include page title and the exact phrase Alpha smoke content if available, and do not include [object Object].",
				expected: [
					"PASS for visible text, extract content, headings, scroll state, and selection",
					"page title is Onhand Port Smoke Fixture",
					"answer includes Alpha smoke content",
					"answer does not include [object Object]",
				],
			},
			{
				id: "fixture-interact",
				title: "Fixture label/click interaction",
				url: "http://127.0.0.1:8765/",
				prompt:
					'CHROME ACCEPTANCE FIXTURE INTERACT {runId}: Use browser_type_by_label to replace Demo field with "chrome acceptance typed", then use browser_click_text to click Demo button, then use browser_run_js only as a runtime-state verification step to return document.querySelector("#result")?.textContent. Answer only: CHROME_ACCEPTANCE_INTERACT <result>.',
				expected: ["answer is CHROME_ACCEPTANCE_INTERACT Demo button clicked"],
			},
			{
				id: "fixture-debug",
				title: "Fixture selector/debug ports",
				url: "http://127.0.0.1:8765/",
				prompt:
					'CHROME ACCEPTANCE FIXTURE DEBUG {runId}: Use browser_wait_for_selector for #cssButton, browser_click on selector #cssButton, browser_type on selector #cssInput with text "chrome selector typed" and clear true, browser_collect_console, browser_get_dom with maxChars 800, browser_capture_screenshot as png, and browser_run_js only as a runtime-state verification step to return { cssInput: document.querySelector("#cssInput")?.value, bodyHasAlpha: document.body.innerText.includes("Alpha smoke content") }. Answer with a compact PASS/FAIL checklist and the JS result.',
				expected: [
					"PASS for wait, click, type, console, DOM, screenshot, and JS",
					"JS result has cssInput chrome selector typed and bodyHasAlpha true",
				],
			},
			{
				id: "fixture-visual-region",
				title: "Fixture visible-region image capture",
				url: "http://127.0.0.1:8765/",
				steps: ["Scroll the Visual Section chart into view before submitting."],
				prompt:
					'CHROME ACCEPTANCE VISUAL REGION {runId}: Use browser_get_visible_region_image for selector "#validationChart", then use browser_highlight_text for "orange series ends above the blue series" with clearExisting true. Answer only: CHROME_ACCEPTANCE_VISUAL_REGION captured_and_anchored.',
				expected: [
					"answer is CHROME_ACCEPTANCE_VISUAL_REGION captured_and_anchored",
					"the visual-region tool captures the chart selector as an image",
					"the answer also has an exact nearby text anchor for the visual claim",
				],
			},
			{
				id: "fixture-artifact",
				title: "Fixture artifact persistence",
				url: "http://127.0.0.1:8765/",
				prompt:
					'CHROME ACCEPTANCE FIXTURE ARTIFACT {runId}: Use browser_capture_state with persist true, includeHtml true, includeScreenshot true, and label "chrome acceptance artifact {runId}". Then use browser_list_artifacts with query "chrome acceptance artifact". Answer only: CHROME_ACCEPTANCE_ARTIFACT <saved artifact id> - <page title>.',
				expected: [
					"answer starts with CHROME_ACCEPTANCE_ARTIFACT artifact_",
					"answer includes Onhand Port Smoke Fixture",
				],
			},
			{
				id: "fixture-session-replay",
				title: "Fixture menu session restore UI",
				url: "http://127.0.0.1:8765/",
				prompt:
					'CHROME ACCEPTANCE FIXTURE SESSION REPLAY {runId}: Use browser_highlight_text for "Alpha smoke content" with clearExisting true, then use browser_show_note on that highlight with note "session replay check {runId}". Answer only: CHROME_ACCEPTANCE_SESSION_REPLAY highlighted_and_noted.',
				expected: [
					"answer is CHROME_ACCEPTANCE_SESSION_REPLAY highlighted_and_noted",
					"the three-dot menu session selector includes the current session",
					"clicking Restore pages in the menu shows a Restore result with at least one page result",
				],
			},
			{
				id: "fixture-network",
				title: "Fixture no-cache network reload",
				url: "http://127.0.0.1:8765/",
				prompt:
					'CHROME ACCEPTANCE FIXTURE NETWORK {runId}: Use browser_collect_network with reload true, ignoreCache true, durationMs 1500, maxEntries 12, onlyFailures false, and matchUrlContains "127.0.0.1:8765". Then use browser_click_text to click "Fetch fixture JSON". Then use browser_run_js only as a runtime-state verification step to return { status: document.querySelector("#networkStatus")?.textContent ?? null }. Answer compact PASS/FAIL for browser_collect_network, browser_click_text, and browser_run_js; include one collected URL/status plus the JS result.',
				expected: [
					"PASS for network, click, and JS",
					"one collected URL is http://127.0.0.1:8765/ with status 200",
					"JS result status is Network loaded: fixture-json",
				],
			},
		],
	},
	pdf: {
		label: "PDF annotation matrix",
		setup: [
			"npm run build:extension",
			"reload the unpacked Chrome extension from packages/browser-extension/ using Computer Use on chrome://extensions",
			"confirm extension options show authMode oauth, aiProvider openai-codex, aiModel gpt-5.5, hasOAuthCredentials true, and expired false",
			"npm run serve:fixture",
			"start a fresh Onhand side-panel session named Chrome PDF acceptance {runId}",
			"use the controlled PDF.js-style fixture and Scholar-like fixture first, then run the native Chrome PDF unsupported diagnostic and the real Google Scholar PDF Reader cases when available",
		],
		cases: [
			{
				id: "pdf-controlled-visible",
				title: "Controlled PDF visible text and page numbers",
				url: "http://127.0.0.1:8765/pdf.html",
				prompt:
					'CHROME PDF CONTROLLED VISIBLE {runId}: Use browser_get_visible_text and browser_get_selection on this PDF fixture page. Answer only a compact PASS/FAIL checklist. Include the page-numbered visible text prefix for page 2 and the exact phrase "recurrent neural networks" if available. Do not include [object Object].',
				expected: [
					"PASS for visible PDF text and selection",
					"answer includes page-numbered PDF text such as [p. 2]",
					"answer includes recurrent neural networks",
					"answer does not include [object Object]",
				],
			},
			{
				id: "pdf-controlled-scholar-visible",
				title: "Controlled Scholar-like PDF visible text excludes native UI",
				url: "http://127.0.0.1:8765/scholar-pdf.html?file=/fixtures/scholar-reader.pdf",
				prompt:
					'CHROME PDF CONTROLLED SCHOLAR VISIBLE {runId}: Use browser_get_visible_text on this Scholar-like PDF fixture page. Answer only a compact PASS/FAIL checklist. Include viewer google-scholar if available, page-numbered text for page 4, and the exact phrase "Recurrent neural networks preserve sequence state". Confirm the native Scholar note text is not included.',
				expected: [
					"PASS for Scholar-like PDF visible text",
					"answer includes page-numbered PDF text such as [p. 4]",
					"answer includes Recurrent neural networks preserve sequence state",
					"answer confirms the native Scholar note/comment text is not included as source text",
					"answer does not include toolbar/comment controls as source text",
				],
			},
			{
				id: "pdf-controlled-highlight-note",
				title: "Controlled PDF overlay highlight and note",
				url: "http://127.0.0.1:8765/pdf.html",
				prompt:
					'CHROME PDF CONTROLLED HIGHLIGHT {runId}: Use browser_highlight_text for "recurrent neural networks" with clearExisting true, then use browser_show_note on that highlight with note "RNNs preserve sequence state across tokens." Answer only: CHROME_PDF_CONTROLLED_HIGHLIGHT highlighted_and_noted.',
				expected: [
					"answer is CHROME_PDF_CONTROLLED_HIGHLIGHT highlighted_and_noted",
					"the PDF fixture shows an Onhand-owned overlay highlight on the phrase",
					"the Onhand note card appears anchored near the PDF highlight",
					"clicking the source/page action jumps back to the PDF highlight or note without duplicate flashes",
				],
			},
			{
				id: "pdf-controlled-scholar-highlight-note",
				title: "Controlled Scholar-like PDF overlay coexists with native annotations",
				url: "http://127.0.0.1:8765/scholar-pdf.html?file=/fixtures/scholar-reader.pdf",
				prompt:
					'CHROME PDF CONTROLLED SCHOLAR HIGHLIGHT {runId}: Use browser_highlight_text for "Recurrent neural networks" with clearExisting true, then use browser_show_note on that highlight with note "Onhand note stays separate from native Scholar comments." Then use browser_capture_state with persist false. Answer only: CHROME_PDF_CONTROLLED_SCHOLAR highlighted_and_noted.',
				expected: [
					"answer is CHROME_PDF_CONTROLLED_SCHOLAR highlighted_and_noted",
					"the Scholar-like fixture shows an Onhand-owned overlay highlight on the phrase",
					"the Onhand note card appears without deleting or replacing the native Scholar comment popup",
					"browser_capture_state captures the Onhand annotation, not the native Scholar comment text",
				],
			},
			{
				id: "pdf-controlled-capture-restore",
				title: "Controlled PDF capture and restore",
				url: "http://127.0.0.1:8765/pdf.html",
				prompt:
					'CHROME PDF CONTROLLED RESTORE {runId}: Use browser_capture_state with persist true, includeHtml true, includeScreenshot true, and label "pdf controlled artifact {runId}". Then use browser_restore_state on that artifact with clearExisting true. Answer only: CHROME_PDF_CONTROLLED_RESTORE <saved artifact id> restored.',
				expected: [
					"answer starts with CHROME_PDF_CONTROLLED_RESTORE artifact_",
					"Restore pages or browser_restore_state reports one restored PDF page",
					"the restored PDF highlight and note reappear from saved normalized PDF anchor metadata",
				],
			},
			{
				id: "pdf-controlled-selected-passage",
				title: "Controlled PDF selected-passage prompt",
				url: "http://127.0.0.1:8765/pdf.html",
				steps: [
					'Before submitting, drag-select the phrase "recurrent neural networks" on page 2 of the controlled PDF fixture.',
				],
				prompt:
					'CHROME PDF CONTROLLED SELECTION {runId}: Explain the selected PDF text in one sentence, highlight the selected text, and add a short note. Answer only: CHROME_PDF_CONTROLLED_SELECTION selected_anchor_reused.',
				expected: [
					"answer is CHROME_PDF_CONTROLLED_SELECTION selected_anchor_reused",
					"the highlight lands on the selected PDF text, not a nearby repeated phrase",
					"the source/page action jumps to the selected PDF highlight",
					"Review/capture metadata shows a PDF anchor with page number and normalized rects",
				],
			},
			{
				id: "pdf-onhand-viewer-highlight-note",
				title: "Onhand PDF viewer real-PDF highlight and note",
				url: "http://127.0.0.1:8765/onhand-pdf-viewer.html?url=http%3A%2F%2F127.0.0.1%3A8765%2Ffixtures%2Fonhand-viewer.pdf",
				prompt:
					'CHROME PDF ONHAND VIEWER {runId}: Use browser_get_visible_text, then use browser_highlight_text for "recurrent neural networks" with clearExisting true, then use browser_show_note on that highlight with note "Onhand viewer PDF note." Then use browser_capture_state with persist true and restore it with clearExisting true. Answer only: CHROME_PDF_ONHAND_VIEWER highlighted_noted_restored.',
				expected: [
					"answer is CHROME_PDF_ONHAND_VIEWER highlighted_noted_restored",
					"visible text comes from an actual PDF file rendered in the Onhand-owned viewer",
					"the Onhand overlay highlight and note appear in the viewer, not in Google Scholar's native annotation UI",
					"capture/restore recreates the PDF highlight and note from normalized PDF anchor metadata",
				],
			},
			{
				id: "pdf-open-onhand-viewer-handoff",
				title: "Direct PDF handoff into Onhand viewer",
				url: "http://127.0.0.1:8765/pdf/onhand-viewer",
				steps: [
					"Start from the direct content-type PDF URL rather than the Onhand viewer URL.",
					"Let Onhand open the PDF in its own viewer before reading or annotating.",
				],
				prompt:
					'CHROME PDF VIEWER HANDOFF {runId}: Use browser_open_pdf_in_onhand_viewer for this PDF, then use browser_get_visible_text, highlight "recurrent neural networks" with clearExisting true, add note "Opened through Onhand viewer.", capture state with persist true, and answer only: CHROME_PDF_VIEWER_HANDOFF opened_highlighted_saved.',
				expected: [
					"answer is CHROME_PDF_VIEWER_HANDOFF opened_highlighted_saved",
					"the active tab becomes an Onhand PDF viewer URL with the original PDF URL encoded",
					"visible text, highlight, note, and capture all run on the Onhand viewer tab",
					"the original direct PDF/native viewer is not treated as an ordinary HTML page",
				],
			},
			{
				id: "pdf-chrome-native-unsupported",
				title: "Chrome native PDF viewer unsupported diagnostic",
				url: "https://arxiv.org/pdf/2509.03345",
				steps: [
					"Open the PDF in Chrome's native PDF viewer, not a text-layer fixture.",
					"Do not create highlights or notes in this case; it is a read-only diagnostic.",
				],
				prompt:
					"CHROME PDF NATIVE VIEWER {runId}: Use browser_get_visible_text and browser_get_selection on this PDF tab. If the PDF viewer exposes no readable page text layer to Onhand, answer only: CHROME_PDF_NATIVE_VIEWER unsupported_pdf_surface. If page-numbered PDF text is available, answer a compact PASS checklist and include the viewer label.",
				expected: [
					"Chrome's native PDF viewer may display readable pages while exposing no scriptable DOM/text layer to Onhand",
					"unsupported result is acceptable when no readable text layer is exposed",
					"Onhand must not silently fall back to HTML matching or claim a source-grounded highlight on a bare native PDF shell",
				],
			},
			{
				id: "pdf-google-scholar-visible",
				title: "Google Scholar PDF Reader visible text diagnostic",
				url: "https://asaparov.org/assets/cs577_fall2025/lecture4.pdf",
				steps: [
					"Open the URL in Chrome with Google Scholar PDF Reader enabled.",
					"If Chrome blocks the direct PDF URL in automation, open the PDF manually and continue from the rendered Scholar PDF tab.",
					"Confirm the tab shows the Google Scholar PDF Reader toolbar or native annotation controls before submitting the prompt.",
				],
				prompt:
					'CHROME PDF SCHOLAR VISIBLE {runId}: Use browser_get_visible_text and browser_get_selection on this real Google Scholar PDF Reader tab. Answer only a compact PASS/FAIL checklist. Include whether page-numbered PDF text is visible, whether a viewer/surface label is available, and whether native Scholar comment/highlight UI is excluded from source text. If no readable PDF text layer is available, answer CHROME_PDF_SCHOLAR_VISIBLE unsupported_pdf_surface.',
				expected: [
					"answer is a compact PASS/FAIL checklist or CHROME_PDF_SCHOLAR_VISIBLE unsupported_pdf_surface",
					"PASS answer includes page-numbered PDF text",
					"PASS answer does not include native Scholar comment/highlight toolbar text as source text",
					"unsupported answer identifies whether the Reader-frame fallback was attempted and why it failed",
				],
			},
			{
				id: "pdf-google-scholar-selection",
				title: "Google Scholar PDF Reader selected-passage prompt",
				url: "https://asaparov.org/assets/cs577_fall2025/lecture4.pdf",
				steps: [
					"Continue from a PASS result in pdf-google-scholar-visible.",
					"Select a visible phrase on page 1 or 2 before submitting the prompt.",
				],
				prompt:
					"CHROME PDF SCHOLAR SELECTION {runId}: Explain the selected PDF text in one sentence, highlight it, and add one short Onhand note. Answer only: CHROME_PDF_SCHOLAR_SELECTION selected_anchor_reused.",
				expected: [
					"answer is CHROME_PDF_SCHOLAR_SELECTION selected_anchor_reused",
					"Onhand creates its own overlay highlight/note and does not invoke Scholar Reader's native highlight/comment toolbar",
					"clicking Onhand source/page action jumps to the selected PDF passage",
					"Scholar Reader native annotations, if present, remain visually separate from Onhand annotations",
				],
			},
			{
				id: "pdf-google-scholar-restore",
				title: "Google Scholar PDF Reader restore",
				url: "https://asaparov.org/assets/cs577_fall2025/lecture4.pdf",
				steps: [
					"Continue in the same session as pdf-google-scholar-selection.",
					"Close or reload the PDF tab, then reopen the same PDF in Scholar Reader.",
					"Use Restore pages from the Onhand menu or browser_restore_state from the prompt.",
				],
				prompt:
					"CHROME PDF SCHOLAR RESTORE {runId}: Restore the saved PDF page state for this session and answer only: CHROME_PDF_SCHOLAR_RESTORE restored.",
				expected: [
					"answer is CHROME_PDF_SCHOLAR_RESTORE restored",
					"the saved Onhand PDF highlight and note reappear on the PDF page",
					"source/page actions jump to the restored PDF annotation",
					"restore does not depend on Scholar Reader's native saved comment/highlight state",
				],
			},
		],
	},
	"real-pages": {
		label: "Real page matrix",
		setup: [
			"reload the unpacked Chrome extension if the runtime bundle changed",
			"confirm extension options show authMode oauth, aiProvider openai-codex, aiModel gpt-5.5, hasOAuthCredentials true, and expired false",
			"start a fresh Onhand side-panel session named Chrome real-page acceptance {runId}",
			"run each case in Chrome, not Helium",
		],
		cases: [
			{
				id: "real-static-article",
				title: "Static article grounding",
				url: "https://en.wikipedia.org/wiki/Personal_computer",
				prompt:
					'CHROME ACCEPTANCE STATIC ARTICLE {runId}: Use browser_get_visible_text, browser_extract_content, browser_get_viewport_headings, and browser_get_selection on this page. Answer only a compact PASS/FAIL checklist; include the page title, whether "personal computer" appears, at least two visible headings, and do not include [object Object].',
				expected: [
					"PASS for visible text, extract content, headings, and selection",
					"page title identifies Personal computer",
					"answer includes personal computer",
					"answer does not include [object Object]",
				],
			},
			{
				id: "real-form-page",
				title: "App-like form interaction without submit",
				url: "https://the-internet.herokuapp.com/login",
				prompt:
					'CHROME ACCEPTANCE FORM PAGE {runId}: Use browser_wait_for_selector for #username, browser_type on selector #username with text "chrome_acceptance_user" and clear true, browser_type on selector #password with text "chrome_acceptance_pass" and clear true, browser_get_dom with maxChars 1200, and browser_run_js only as a runtime-state verification step to return { username: document.querySelector("#username")?.value, passwordLength: document.querySelector("#password")?.value.length, hasLoginButton: !!document.querySelector("button[type=submit]") }. Do not submit the form. Answer with a compact PASS/FAIL checklist and the JS result.',
				expected: [
					"PASS for wait, username type, password type, DOM, and JS",
					"JS result username is chrome_acceptance_user",
					"JS result passwordLength is 22",
					"JS result hasLoginButton is true",
				],
			},
			{
				id: "real-client-routed-page",
				title: "Client-routed docs page with network reload",
				url: "https://react.dev/learn",
				prompt:
					'CHROME ACCEPTANCE ROUTED PAGE {runId}: Use browser_collect_network with reload true, ignoreCache true, durationMs 2000, maxEntries 20, onlyFailures false, and matchUrlContains "react.dev". Then use browser_get_viewport_headings, browser_get_dom with maxChars 1200, and browser_run_js only as a runtime-state verification step to return { title: document.title, pathname: location.pathname, hasLearnContent: document.body.innerText.includes("Learn React") || document.body.innerText.includes("Quick Start") }. Answer compact PASS/FAIL for browser_collect_network, browser_get_viewport_headings, DOM, and browser_run_js; include one collected URL/status plus the JS result.',
				expected: [
					"PASS for network reload, headings, DOM, and JS",
					"one collected URL is on react.dev with a successful status",
					"JS result pathname is /learn",
					"JS result hasLearnContent is true",
				],
			},
		],
	},
	learning: {
		label: "Learning Mode matrix",
		setup: [
			"reload the unpacked Chrome extension if the runtime bundle changed",
			"confirm extension options show authMode oauth, aiProvider openai-codex, aiModel gpt-5.5, hasOAuthCredentials true, and expired false",
			"open https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html in Chrome",
			"start a fresh Onhand side-panel session named Chrome learning acceptance {runId}",
			"run these cases in order; keep the same session for the Learning Mode cases so repeated-concept state can accumulate",
		],
		cases: [
			{
				id: "learning-answer-control",
				title: "Answer Mode direct control",
				url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
				steps: ["Turn Learning Mode off before submitting this prompt."],
				prompt:
					"CHROME LEARNING ANSWER CONTROL {runId}: Use this page to answer directly: what is rejection sampling? Anchor the answer with a highlight, but do not ask me a prediction or retrieval question.",
				expected: [
					"Learning Mode toggle is off before submission",
					"answer directly explains rejection sampling with a page anchor/highlight",
					"answer does not ask a prediction, retrieval, or say-it-back question",
				],
			},
			{
				id: "learning-concept-prompt",
				title: "Learning Mode concept prompt",
				url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
				steps: ["Turn Learning Mode on before submitting this prompt.", "Use the same fresh side-panel session for the remaining Learning Mode cases."],
				prompt: "CHROME LEARNING CONCEPT {runId}: Teach me how rejection sampling works from this page.",
				expected: [
					"first move anchors a relevant page passage or equation",
					"answer asks one short page-anchored prediction or retrieval question before a full explanation",
					"the sidebar This session panel appears with a Rejection sampling concept and an open check",
				],
			},
			{
				id: "learning-open-check-resolution",
				title: "Learning Mode open-check resolution",
				url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
				steps: ["Keep Learning Mode on.", "Submit this as the next turn in the same session as learning-concept-prompt."],
				prompt:
					"CHROME LEARNING CHECK RESPONSE {runId}: I think samples are rejected when they fall under the proposal distribution but outside the target distribution's accepted probability region.",
				expected: [
					"answer assesses the user's response before introducing new material",
					"answer gives a hint or correction anchored to the page if needed",
					"the previously open check is resolved or no longer shown as open in the sidebar",
				],
			},
			{
				id: "learning-repeated-concept",
				title: "Learning Mode repeated-concept refresher",
				url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
				steps: ["Keep Learning Mode on.", "Submit this as a later turn in the same session, after rejection sampling is already in This session."],
				prompt: "CHROME LEARNING REPEAT {runId}: Can you remind me how rejection sampling works again?",
				expected: [
					"answer treats rejection sampling as already covered earlier in the session",
					"answer gives a quick refresher instead of restarting a full explanation",
					"answer points back to the earlier source highlight or anchor when possible",
					"page work stays lightweight: reuse or jump to an existing anchor when possible, with at most one new replacement highlight and no new note unless explicitly requested",
					"the sidebar does not show a duplicate Rejection sampling concept",
					"the sidebar does not accumulate multiple open checks for the same repeated concept",
				],
			},
				{
					id: "learning-cross-tab-retrieval",
				title: "Learning Mode automatic cross-tab retrieval",
				url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
				steps: [
					"Keep Learning Mode on.",
					"Open two additional related tabs in the same Chrome window: https://en.wikipedia.org/wiki/Rejection_sampling and https://en.wikipedia.org/wiki/Monte_Carlo_method.",
					"Return to the BayesianDL tab before submitting this prompt.",
				],
				prompt:
					"CHROME LEARNING CROSS TAB {runId}: I'm trying to understand why rejection sampling wastes samples. Help me reason through it using the material I already have open.",
				expected: [
					"answer uses the current BayesianDL page as the primary anchor",
					"answer notices at least one related open tab by title or domain",
					"answer automatically reads and anchors at least one clearly related tab without requiring 'other tab' wording",
					"page actions do not activate or switch focus merely to read or annotate the related tab",
					"the Learning Mode response stays concise and asks at most one follow-up question",
					],
				},
				{
					id: "learning-homework-distinct-source",
					title: "Learning homework requires genuinely distinct evidence",
					url: "https://asaparov.org/assets/cs577_fall2025/hw1.pdf",
					steps: [
						"Keep Learning Mode on.",
						"Open a second tab showing the same hw1.pdf in another PDF viewer, plus the CS577 Fall 2025 course page.",
						"Select the full text of Discussion Question 3 about data augmentation, the loss function, and the training procedure.",
						"Return to the homework tab before submitting this prompt.",
					],
					prompt: "could you help me solve this?",
					expected: [
						"the model classifier recognizes the deictic wording as a request for help with the visible homework problem",
						"the research planner treats the selected Question 3 text as the authoritative target and derives regularization-specific searches",
						"the user does not need to name the question or mention another open tab",
						"the sidebar shows research progress but does not expose a provisional answer or a Revising state",
						"the duplicate viewer for the same canonical homework PDF does not satisfy the outside-evidence requirement",
						"the model-led preflight selects the course page as an index and searches its linked PDF corpus before answer prose",
						"the corpus pass covers the complete 27-lecture collection rather than truncating to the first few lectures or walking lecture numbers in order",
						"the model-selected evidence finds Lecture 13 page 45 for data augmentation and Lecture 16 page 29 for loss regularization even though their titles do not advertise those topics",
						"only the strongest returned source PDFs are opened for exact reading and annotation; the scan itself does not create one tab per lecture",
						"the activity trace checks the broader open workspace before finalizing instructional claims",
						"the response either grounds its guidance in sufficient distinct sources or explicitly says the strongest checked materials did not verify it",
					],
				},
				{
					id: "learning-linked-source-annotation",
					title: "Learning follows a course index to supporting notes",
					url: "https://asaparov.org/assets/cs577_fall2025/hw2.pdf",
					steps: [
						"Keep Learning Mode on.",
						"Open https://asaparov.org/cs577_fall2025/ in another tab, but do not open Lecture 13 manually.",
						"Return to hw2.pdf before submitting this prompt.",
					],
					prompt: "CHROME LEARNING LINKED SOURCE {runId}: Help me reason through Part D Question 2(a).",
					expected: [
						"Onhand inspects the course page, follows its Lecture 13 link in a background tab, and reads the destination itself",
						"the supporting lecture receives its own exact highlight and one short interpretive note",
						"the active homework tab keeps focus during automatic discovery",
						"the answer distinguishes claims stated by the lecture from the learner's own required reasoning",
					],
				},
				{
					id: "learning-no-support-fallback",
					title: "Learning withdraws an unsupported homework draft",
					url: "https://asaparov.org/assets/cs577_fall2025/hw2.pdf",
					steps: [
						"Keep Learning Mode on.",
						"Keep the CS577 course page open, but close any syntax/CFG lecture tabs.",
						"Return to hw2.pdf before submitting this prompt.",
					],
					prompt: "CHROME LEARNING NO SUPPORT {runId}: Help me reason through Part C Question 3.",
					expected: [
						"Onhand checks plausible open sources rather than treating the problem statement as explanatory evidence",
						"if no inspected source supports CFG ambiguity, the final answer says so and does not retain unsupported claims from an earlier draft",
						"the remaining guidance stays limited to what the homework text establishes and asks for the learner's next step",
					],
				},
			],
	},
	voice: {
		label: "Realtime voice matrix",
		setup: [
			"optional: npm run generate:realtime-voice-fixture, then play the generated WAV through Chrome's selected microphone or a virtual audio device",
			"npm run build:extension",
			"reload the unpacked Chrome extension from packages/browser-extension/ using Computer Use on chrome://extensions",
			"confirm extension options show an OpenAI platform API key with Realtime API access; Codex OAuth can stay selected for text chat but is not enough for Realtime voice",
			"npm run serve:fixture",
			"open http://127.0.0.1:8765/ in Chrome",
			"open the Onhand side panel with Computer Use",
			"start a fresh Onhand side-panel session named Chrome realtime voice acceptance {runId}",
		],
		cases: [
			{
				id: "voice-live-mic-question",
				title: "Live microphone drives Realtime voice input",
				url: "http://127.0.0.1:8765/",
				steps: [
					"Click the Voice button on the local smoke fixture.",
					"Ask aloud, or play through the selected microphone: What does this page say about Alpha smoke content? Please answer briefly and point to the page.",
					"Do not type into the composer during this case.",
					"Wait up to 60 seconds for the status to move through Mic hears you, Listening or Mic heard a pause, Transcribing, Using Onhand, and Speaking Onhand answer.",
				],
				prompt:
					"No typed prompt. The spoken prompt is: What does this page say about Alpha smoke content? Please answer briefly and point to the page.",
				expected: [
					"Voice starts with the selected Chrome microphone device",
					"status shows Mic hears you before any typed input",
					"OpenAI server VAD or the manual fallback submits the audio turn",
					"the sidebar receives an Onhand Page-grounded answer without clicking Ask",
					"the spoken/sidebar answer mentions Alpha smoke content or the fixture page content and preserves the Onhand answer in the sidebar",
					"status does not end at OpenAI received no mic audio",
				],
			},
			{
				id: "voice-learning-socratic-fixture",
				title: "Learning Mode voice asks a grounded Socratic prompt",
				url: "http://127.0.0.1:8765/",
				steps: [
					"Turn Learning Mode on before starting this case.",
					"Click the Voice button on the local smoke fixture.",
					"Ask aloud, or play through the selected microphone: What does this page say about Alpha smoke content? Please answer briefly and point to the page.",
					"Do not type into the composer during the first voice turn.",
					"Wait up to 60 seconds for the status to move through Transcribing, Planning tutor move, and Speaking tutor prompt.",
					"Answer the spoken prompt aloud, or type a short answer in the composer while Voice remains live.",
					"Wait for Checking answer and Speaking tutor feedback.",
				],
				prompt:
					"No typed first prompt. The spoken prompt is: What does this page say about Alpha smoke content? Please answer briefly and point to the page.",
				expected: [
					"the first Learning Mode voice turn asks a question or nudge instead of giving a full direct answer",
					"the Alpha smoke content source sentence is highlighted",
					"the This session learner panel records an open check after the first turn",
					"the follow-up student answer resolves that check or records feedback in This session",
					"Realtime speaks both the Socratic prompt and the feedback without a Conversation already has an active response error",
				],
			},
			{
				id: "voice-visual-region-fixture",
				title: "Learning Mode voice captures visible chart region",
				url: "http://127.0.0.1:8765/",
				steps: [
					"Scroll the Visual Section chart into view.",
					"Turn Learning Mode on.",
					"Click Voice, then type the visual prompt into the composer and click Ask while Voice remains live.",
					"Wait for Planning tutor move and Speaking tutor prompt.",
				],
				prompt: "What does this chart show about accuracy?",
				expected: [
					"the planner captures a visible-region image before making visual claims",
					"the tutor prompt refers to the visible chart region and does not invent unsupported chart details",
					"if exact chart text is available, Onhand also highlights a nearby text anchor such as the Visual Section caption",
					"if exact text anchoring is unavailable, the sidebar says what visual context or selection is needed instead of pretending to annotate the figure",
				],
			},
			{
				id: "voice-pdf-viewer-handoff",
				title: "Realtime voice opens direct PDFs in Onhand viewer before answering",
				url: "http://127.0.0.1:8765/pdf/onhand-viewer",
				steps: [
					"Start from the direct content-type PDF URL, not the Onhand viewer URL.",
					"Click Voice and wait for any Opening PDF in Onhand viewer status to complete.",
					"With Voice still live, type the prompt into the composer and click Ask.",
					"Wait up to 60 seconds for Using Onhand and Speaking Onhand answer.",
				],
				prompt: "What does this PDF say about recurrent neural networks?",
				expected: [
					"the active tab is opened through the Onhand PDF viewer or inline Onhand PDF viewer bridge before the answer runs",
					"the answer routes through Onhand rather than realtime-only context",
					"the phrase recurrent neural networks is highlighted on the PDF page",
					"the sidebar preserves a concise answer and the spoken answer does not report unsupported_pdf_surface",
				],
			},
			{
				id: "voice-stale-turn-and-session-persistence",
				title: "Voice interruptions ignore stale results and preserve final text turns",
				url: "http://127.0.0.1:8765/",
				steps: [
					"Turn Learning Mode on and start Voice on the local smoke fixture.",
					"Ask a Learning Mode question, then interrupt or type a newer voice-live question before the first planner/evaluator result finishes.",
					"Wait for the newer turn to finish, then use the session menu to review or restore the current session.",
				],
				prompt: "First ask: What does Alpha smoke content mean? Then interrupt with: What should I notice in the highlighted sentence?",
				expected: [
					"the older planner/evaluator result does not replace the newer sidebar answer",
					"the older result is not spoken after the newer turn starts",
					"learner checks are not resolved by stale evaluator feedback",
					"the completed voice prompts and text answers remain visible in the saved session transcript",
				],
			},
		],
	},
};

function parseArgs(argv) {
	const args = {
		json: false,
		runId: DEFAULT_RUN_ID,
		suite: "all",
	};
	for (const value of argv) {
		if (value === "--json") {
			args.json = true;
			continue;
		}
		if (value.startsWith("--run-id=")) {
			args.runId = value.slice("--run-id=".length) || args.runId;
			continue;
		}
		if (value.startsWith("--suite=")) {
			args.suite = value.slice("--suite=".length) || args.suite;
			continue;
		}
		if (value === "--help" || value === "-h") {
			printHelp();
			process.exit(0);
		}
		throw new Error(`Unknown option: ${value}`);
	}
	return args;
}

function selectedSuites(name) {
	if (name === "all") return [suites.oauth, suites.fixture, suites.pdf, suites["real-pages"], suites.learning];
	if (suites[name]) return [suites[name]];
	throw new Error(`Unknown suite: ${name}. Expected all, oauth, fixture, pdf, real-pages, learning, or voice.`);
}

function hydrate(value, runId) {
	return value.replaceAll("{runId}", runId);
}

function buildPlan(args) {
	return {
		runId: args.runId,
		operatorNotes: OPERATOR_NOTES,
		suites: selectedSuites(args.suite).map((suite) => ({
			...suite,
			setup: suite.setup.map((line) => hydrate(line, args.runId)),
			cases: suite.cases.map((testCase) => ({
				...testCase,
				prompt: hydrate(testCase.prompt, args.runId),
				expected: testCase.expected.map((line) => hydrate(line, args.runId)),
				steps: Array.isArray(testCase.steps) ? testCase.steps.map((line) => hydrate(line, args.runId)) : testCase.steps,
			})),
		})),
	};
}

function printHelp() {
	console.log("Usage: npm run acceptance:chrome -- [--suite=all|oauth|fixture|pdf|real-pages|learning|voice] [--run-id=<id>] [--json]");
}

function printPlan(plan) {
	console.log(`# Chrome Acceptance Gate: ${plan.runId}`);
	console.log("");
	console.log("Use Chrome with the Codex Chrome Extension and OpenAI Codex OAuth. Record PASS/FAIL results in the PR or handoff.");
	console.log("");
	console.log("Operator notes:");
	for (const line of plan.operatorNotes) console.log(`- ${line}`);
	for (const suite of plan.suites) {
		console.log("");
		console.log(`## ${suite.label}`);
		console.log("");
		console.log("Setup:");
		for (const line of suite.setup) console.log(`- ${line}`);
		for (const testCase of suite.cases) {
			console.log("");
			console.log(`### ${testCase.id}: ${testCase.title}`);
			console.log(`URL: ${testCase.url}`);
			if (Array.isArray(testCase.steps) && testCase.steps.length) {
				console.log("");
				console.log("Steps:");
				for (const line of testCase.steps) console.log(`- ${line}`);
			}
			console.log("");
			console.log("Prompt:");
			console.log(testCase.prompt);
			console.log("");
			console.log("Expected:");
			for (const line of testCase.expected) console.log(`- ${line}`);
		}
	}
}

const args = parseArgs(process.argv.slice(2));
const plan = buildPlan(args);

if (args.json) {
	console.log(JSON.stringify(plan, null, 2));
} else {
	printPlan(plan);
}
