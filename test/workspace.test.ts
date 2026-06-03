import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveMarkdownReport } from "../src/report-writer.ts";
import { ensureResearchWorkspace, researchWorkspaceDirs } from "../src/workspace.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = join(tmpdir(), `linlic-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	tempDirs.push(dir);
	return dir;
}

describe("linlic-agent workspace", () => {
	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	it("creates every research_workspace subdirectory", async () => {
		const cwd = makeTempDir();

		const result = await ensureResearchWorkspace(cwd);

		expect(result.workspaceRoot).toBe(join(cwd, "research_workspace"));
		for (const dir of researchWorkspaceDirs) {
			expect(existsSync(join(cwd, "research_workspace", dir))).toBe(true);
			expect(result.directories[dir]).toBe(join(cwd, "research_workspace", dir));
		}
	});

	it("saves markdown reports with a safe generated filename", async () => {
		const cwd = makeTempDir();

		const result = await saveMarkdownReport({
			cwd,
			category: "reports",
			title: "medical imaging / anomaly: survey?",
			content: "# 文献检索报告\n\n正文",
			timestamp: new Date("2026-06-02T10:11:12Z"),
		});

		expect(result.relativePath).toBe("research_workspace/reports/medical-imaging-anomaly-survey-20260602-101112.md");
		expect(readFileSync(result.absolutePath, "utf8")).toBe("# 文献检索报告\n\n正文\n");
	});

	it("creates the workspace automatically and saves Markdown to every report category", async () => {
		const cwd = makeTempDir();
		const categories = ["reports", "reviews", "notes", "logs"] as const;

		for (const category of categories) {
			const result = await saveMarkdownReport({
				cwd,
				category,
				title: `${category} output`,
				content: `# ${category}\n\n稳定 Markdown 输出`,
				timestamp: new Date("2026-06-02T10:11:12Z"),
			});

			expect(result.relativePath).toBe(`research_workspace/${category}/${category}-output-20260602-101112.md`);
			expect(existsSync(result.absolutePath)).toBe(true);
			expect(readFileSync(result.absolutePath, "utf8")).toBe(`# ${category}\n\n稳定 Markdown 输出\n`);
		}
	});
});
