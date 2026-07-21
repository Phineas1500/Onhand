export const CORE_READ_TOOL_NAMES = [
	"browser_get_visible_text",
	"browser_extract_content",
	"browser_get_selection",
	"browser_get_viewport_headings",
	"browser_get_scroll_state",
];
export const READER_SEARCH_TOOL_NAMES = ["browser_textbook_search"];
export const VISUAL_CONTEXT_TOOL_NAMES = ["browser_get_visible_region_image"];
export const VISUAL_GROUNDING_TOOL_NAMES = ["browser_highlight_text", "browser_show_note", "browser_scroll_to_annotation", "browser_clear_annotations"];
export const PDF_ANNOTATION_TOOL_NAMES = ["browser_highlight_text", "browser_show_note", "browser_scroll_to_annotation"];
export const PAGE_CHANGE_TOOL_NAMES = [
	"browser_highlight_text",
	"browser_show_note",
	"browser_clear_annotations",
	"browser_capture_state",
	"browser_restore_state",
];
export const TAB_TOOL_NAMES = ["browser_list_tabs", "browser_activate_tab", "browser_navigate", "browser_open_pdf_in_onhand_viewer"];
export const PDF_TOOL_NAMES = ["browser_pdf_search", "browser_pdf_read_pages", "browser_pdf_jump_to_page", "browser_pdf_capture_page_image", "browser_pdf_find_citation"];
export const PDF_CORPUS_TOOL_NAMES = ["browser_search_linked_pdf_corpus"];
export const ELEMENT_READ_TOOL_NAMES = ["browser_find_elements"];
export const INTERACTION_TOOL_NAMES = [
	"browser_find_elements",
	"browser_wait_for_selector",
	"browser_click",
	"browser_type",
	"browser_click_text",
	"browser_type_by_label",
	"browser_pick_elements",
];
export const LINK_NAVIGATION_TOOL_NAMES = ["browser_find_elements", "browser_wait_for_selector", "browser_click", "browser_click_text"];
export const DEBUG_INSPECTION_TOOL_NAMES = ["browser_collect_console", "browser_collect_network", "browser_get_dom", "browser_capture_screenshot"];
export const RUNTIME_JS_TOOL_NAMES = ["browser_run_js"];
export const ARTIFACT_TOOL_NAMES = ["browser_capture_state", "browser_list_artifacts", "browser_restore_state"];
export const LEARNING_TOOL_NAMES = ["onhand_record_learning_event"];
export const BROAD_SOURCE_TOOL_NAMES = [...CORE_READ_TOOL_NAMES, ...TAB_TOOL_NAMES, ...ELEMENT_READ_TOOL_NAMES];

export const KNOWN_BROWSER_TOOL_NAMES = new Set([
	...CORE_READ_TOOL_NAMES,
	...READER_SEARCH_TOOL_NAMES,
	...VISUAL_CONTEXT_TOOL_NAMES,
	...VISUAL_GROUNDING_TOOL_NAMES,
	...PAGE_CHANGE_TOOL_NAMES,
	...TAB_TOOL_NAMES,
	...PDF_TOOL_NAMES,
	...PDF_CORPUS_TOOL_NAMES,
	...ELEMENT_READ_TOOL_NAMES,
	...INTERACTION_TOOL_NAMES,
	...DEBUG_INSPECTION_TOOL_NAMES,
	...RUNTIME_JS_TOOL_NAMES,
	...ARTIFACT_TOOL_NAMES,
]);

export function browserToolRegistrySnapshot() {
	return {
		all: Array.from(KNOWN_BROWSER_TOOL_NAMES),
		groups: {
			read: [...CORE_READ_TOOL_NAMES, ...READER_SEARCH_TOOL_NAMES, ...ELEMENT_READ_TOOL_NAMES],
			visual: [...VISUAL_CONTEXT_TOOL_NAMES, ...VISUAL_GROUNDING_TOOL_NAMES],
			pageChange: [...PAGE_CHANGE_TOOL_NAMES],
			tabs: [...TAB_TOOL_NAMES],
			pdf: [...PDF_TOOL_NAMES, ...PDF_CORPUS_TOOL_NAMES, ...PDF_ANNOTATION_TOOL_NAMES],
			interaction: [...INTERACTION_TOOL_NAMES],
			debug: [...DEBUG_INSPECTION_TOOL_NAMES, ...RUNTIME_JS_TOOL_NAMES],
			artifacts: [...ARTIFACT_TOOL_NAMES],
			learning: [...LEARNING_TOOL_NAMES],
		},
	};
}
