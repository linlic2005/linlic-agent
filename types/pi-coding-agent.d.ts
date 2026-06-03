import type { Static, TSchema } from "typebox";

export interface ExtensionAPI {
	registerTool<TParams extends TSchema>(tool: RegisteredTool<TParams>): void;
}

export interface RegisteredTool<TParams extends TSchema> {
	name: string;
	label?: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: TParams;
	execute: (
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal,
		onUpdate: ToolUpdateCallback,
		context: ToolExecutionContext,
	) => ToolExecutionResult | Promise<ToolExecutionResult>;
}

export type ToolUpdateCallback = (update: unknown) => void;

export interface ToolExecutionContext {
	cwd: string;
	ui: {
		notify(message: string, level?: "info" | "warning" | "error"): void;
	};
}

export interface ToolExecutionResult {
	content: Array<{ type: "text"; text: string }>;
	details?: unknown;
}
