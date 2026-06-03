import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const researchWorkspaceName = "research_workspace";

export const researchWorkspaceDirs = ["papers", "notes", "reports", "reviews", "drafts", "logs"] as const;

export type ResearchWorkspaceDir = (typeof researchWorkspaceDirs)[number];

export type ResearchWorkspacePaths = Record<ResearchWorkspaceDir, string>;

export interface ResearchWorkspaceResult {
	workspaceRoot: string;
	directories: ResearchWorkspacePaths;
}

export function getResearchWorkspaceRoot(cwd: string): string {
	return join(cwd, researchWorkspaceName);
}

export async function ensureResearchWorkspace(cwd: string): Promise<ResearchWorkspaceResult> {
	const workspaceRoot = getResearchWorkspaceRoot(cwd);
	await mkdir(workspaceRoot, { recursive: true });

	const directories = {} as ResearchWorkspacePaths;
	for (const dir of researchWorkspaceDirs) {
		const absolutePath = join(workspaceRoot, dir);
		await mkdir(absolutePath, { recursive: true });
		directories[dir] = absolutePath;
	}

	return { workspaceRoot, directories };
}
