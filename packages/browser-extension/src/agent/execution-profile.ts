export const EXECUTION_PROFILES = ["legacy", "full-agent", "guided-agent"] as const;

export type ExecutionProfile = (typeof EXECUTION_PROFILES)[number];
export type TargetExecutionProfile = Exclude<ExecutionProfile, "legacy">;

export interface ModelExecutionCapabilities {
	defaultProfile: TargetExecutionProfile;
	reliableNativeTools: boolean;
	reliableParallelTools: boolean;
	supportsVision: boolean;
	supportsStructuredOutput: boolean;
	recommendedMaxToolSteps: number;
}

export interface ExecutionProfileResolution {
	profile: ExecutionProfile;
	source: "legacy-migration" | "requested" | "model-capabilities";
	capabilities: ModelExecutionCapabilities;
}

export const DEFAULT_MODEL_EXECUTION_CAPABILITIES: ModelExecutionCapabilities = {
	defaultProfile: "full-agent",
	reliableNativeTools: true,
	reliableParallelTools: false,
	supportsVision: true,
	supportsStructuredOutput: true,
	recommendedMaxToolSteps: 32,
};

export function resolveExecutionProfile({
	requestedProfile,
	capabilities = DEFAULT_MODEL_EXECUTION_CAPABILITIES,
	legacyOnly = true,
}: {
	requestedProfile?: TargetExecutionProfile;
	capabilities?: ModelExecutionCapabilities;
	legacyOnly?: boolean;
} = {}): ExecutionProfileResolution {
	if (legacyOnly) {
		return { profile: "legacy", source: "legacy-migration", capabilities };
	}
	if (requestedProfile) {
		return { profile: requestedProfile, source: "requested", capabilities };
	}
	return { profile: capabilities.defaultProfile, source: "model-capabilities", capabilities };
}
