export interface EvidenceSlot {
	id: string;
	description: string;
	queries: string[];
}

export interface LearningResearchPlan {
	problemHelp: boolean;
	selectedTextIsTarget: boolean;
	requiresWorkspaceResearch: boolean;
	target: string;
	searchQueries: string[];
	evidenceNeeded: string[];
	evidenceSlots: EvidenceSlot[];
	candidateTabIds: number[];
	maxSources: number;
	corpusResults?: Array<{ tabId: number; tabTitle: string; linkedPdfCount: number; corpus: any }>;
	modelCorpusEvidence?: Array<{ id: string; description: string; coverage: string; reason: string; matches: any[] }>;
}

export interface LearningEvidenceAssessment {
	sufficient: boolean;
	reason: string;
	nextQueries: string[];
	nextCandidateTabIds: number[];
}

export interface PdfCorpusSource {
	title?: string;
	url: string;
}

export interface PdfCorpusEvidenceSlot {
	id: string;
	description?: string;
	queries: string[];
}

export interface PdfCorpusPage {
	pageNumber: number;
	text: string;
}
