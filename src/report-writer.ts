import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureResearchWorkspace, type ResearchWorkspaceDir, researchWorkspaceName } from "./workspace.ts";

export interface SaveMarkdownReportOptions {
	cwd: string;
	category: ResearchWorkspaceDir;
	title: string;
	content: string;
	timestamp?: Date;
}

export interface SaveMarkdownReportResult {
	absolutePath: string;
	relativePath: string;
}

function formatTimestamp(date: Date): string {
	const year = String(date.getUTCFullYear()).padStart(4, "0");
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	const second = String(date.getUTCSeconds()).padStart(2, "0");
	return `${year}${month}${day}-${hour}${minute}${second}`;
}

export function createSafeReportSlug(title: string): string {
	const normalized = title
		.normalize("NFKC")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return normalized || "research-report";
}

export async function saveMarkdownReport(options: SaveMarkdownReportOptions): Promise<SaveMarkdownReportResult> {
	const workspace = await ensureResearchWorkspace(options.cwd);
	const slug = createSafeReportSlug(options.title);
	const timestamp = formatTimestamp(options.timestamp ?? new Date());
	const filename = `${slug}-${timestamp}.md`;
	const absolutePath = join(workspace.directories[options.category], filename);
	const relativePath = join(researchWorkspaceName, options.category, filename);
	const content = options.content.endsWith("\n") ? options.content : `${options.content}\n`;

	await writeFile(absolutePath, content, "utf8");

	return { absolutePath, relativePath };
}
