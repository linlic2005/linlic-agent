import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = new URL("..", import.meta.url).pathname;

const promptNames = ["search", "paper", "idea", "experiment", "review", "revise", "citation-check"];
const readmeCommandExamples = [
	'/search topic="your research topic" limit=20 year_from=2020',
	"/paper research_workspace/papers/example.pdf",
	'/idea idea="your research idea" limit=10 year_from=2020',
	"/experiment research_workspace/drafts/experiment-plan.md",
	'/review research_workspace/drafts/paper.md target="target venue"',
	"/citation-check research_workspace/drafts/paper.md",
	"/revise target=",
];
const skillDirs = [
	"literature-search",
	"paper-analysis",
	"novelty-check",
	"experiment-critic",
	"peer-review",
	"review-revise-loop",
	"citation-check",
];

describe("linlic-agent resources", () => {
	it("provides the MVP prompt templates", () => {
		for (const name of promptNames) {
			const path = join(packageRoot, "prompts", `${name}.md`);
			expect(existsSync(path), `${name}.md should exist`).toBe(true);
			const content = readFileSync(path, "utf8");
			expect(content).toContain("research_prepare_workspace");
			expect(content).toContain("$ARGUMENTS");
			if (name !== "revise") expect(content).toContain("research_write_report");
		}
	});

	it("wires the search prompt and README to the paper search tool", () => {
		const searchPrompt = readFileSync(join(packageRoot, "prompts", "search.md"), "utf8");
		const readme = readFileSync(join(packageRoot, "README.md"), "utf8");

		expect(searchPrompt).toContain("research_search_papers");
		expect(searchPrompt).toContain("research_export_bibtex");
		expect(readme).toContain("SEMANTIC_SCHOLAR_API_KEY");
	});

	it("documents README examples for every slash command", () => {
		const readme = readFileSync(join(packageRoot, "README.md"), "utf8");

		for (const example of readmeCommandExamples) {
			expect(readme).toContain(example);
		}
	});

	it("documents parameter usage for every slash command", () => {
		const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
		const parameterSnippets = [
			"| `topic` | 是 | 无 |",
			"| `limit` | 否 | `10`，最大 `50` |",
			"| `path` / `pdf` / `file` | 是，三选一或使用位置参数 |",
			"| `idea` | 是 | 无 |",
			"| 实验方案路径或文本 | 是 | 无 |",
			"| `file` / `path` / `draft` | 是，三选一或使用位置参数 |",
			"| `target` | 否 | `未指定投稿目标` |",
			"| `limit` | 否 | `8` |",
			"| `draft` / `file` / `path` | 是，三选一或使用位置参数 |",
			"| `max_rounds` / `maxRounds` | 否 | `3`，最大 `6` |",
		];

		for (const snippet of parameterSnippets) {
			expect(readme).toContain(snippet);
		}
	});

	it("pins prompt output categories to stable research_workspace locations", () => {
		const expectedPromptOutputCategories: Record<string, string> = {
			search: "category`: `reports`",
			paper: "category`: `notes`",
			idea: "category`: `reports`",
			experiment: "category`: `reviews`",
			review: "category`: `reviews`",
			"citation-check": "category`: `reviews`",
		};

		for (const [promptName, categorySnippet] of Object.entries(expectedPromptOutputCategories)) {
			const prompt = readFileSync(join(packageRoot, "prompts", `${promptName}.md`), "utf8");
			expect(prompt).toContain("research_prepare_workspace");
			expect(prompt).toContain("research_write_report");
			expect(prompt).toContain(categorySnippet);
		}

		const revisePrompt = readFileSync(join(packageRoot, "prompts", "revise.md"), "utf8");
		expect(revisePrompt).toContain("research_goal_loop");
		expect(revisePrompt).toContain("final-summary.md");
		expect(revisePrompt).toContain("原始草稿没有被覆盖");
	});

	it("wires the paper prompt and README to the PDF analysis tool", () => {
		const paperPrompt = readFileSync(join(packageRoot, "prompts", "paper.md"), "utf8");
		const readme = readFileSync(join(packageRoot, "README.md"), "utf8");

		expect(paperPrompt).toContain("research_analyze_paper_pdf");
		expect(readme).toContain("pdf-parse");
		expect(readme).toContain("/paper research_workspace/papers/example.pdf");
	});

	it("wires the idea prompt and README to the novelty check tool", () => {
		const ideaPrompt = readFileSync(join(packageRoot, "prompts", "idea.md"), "utf8");
		const readme = readFileSync(join(packageRoot, "README.md"), "utf8");

		expect(ideaPrompt).toContain("research_check_idea");
		expect(ideaPrompt).toContain("Zotero");
		expect(readme).toContain("research_check_idea");
		expect(readme).toContain("不能替代 iThenticate、Turnitin 或学校查重系统");
	});

	it("wires the review prompt and README to the draft review tool", () => {
		const reviewPrompt = readFileSync(join(packageRoot, "prompts", "review.md"), "utf8");
		const readme = readFileSync(join(packageRoot, "README.md"), "utf8");

		expect(reviewPrompt).toContain("research_review_draft");
		expect(reviewPrompt).toContain("Zotero 引用完整性检查");
		expect(readme).toContain("research_review_draft");
		expect(readme).toContain("/review research_workspace/drafts/paper.md");
		expect(readme).toContain("不会直接覆盖、重写或修改原论文");
		expect(reviewPrompt).toContain("LaTeX 结构审查摘要");
		expect(readme).toContain("递归读取常见 `\\input{}` 和 `\\include{}` 子文件");
	});

	it("wires the revise prompt and README to the review-revise loop tool", () => {
		const revisePrompt = readFileSync(join(packageRoot, "prompts", "revise.md"), "utf8");
		const readme = readFileSync(join(packageRoot, "README.md"), "utf8");

		expect(revisePrompt).toContain("research_goal_loop");
		expect(readme).toContain("research_goal_loop");
		expect(readme).toContain("revise-YYYYMMDD-HHmmss");
		expect(readme).toContain("不直接覆盖原始 draft");
	});

	it("wires the citation-check prompt and README to the citation checker", () => {
		const citationPrompt = readFileSync(join(packageRoot, "prompts", "citation-check.md"), "utf8");
		const readme = readFileSync(join(packageRoot, "README.md"), "utf8");

		expect(existsSync(join(packageRoot, "extensions", "citation-check.ts"))).toBe(true);
		expect(citationPrompt).toContain("research_check_citations");
		expect(citationPrompt).toContain("research_write_report");
		expect(citationPrompt).toContain("citation-check");
		expect(readme).toContain("/citation-check research_workspace/drafts/paper.md");
		expect(readme).toContain("research_check_citations");
	});

	it("documents Zotero integration and BibTeX export", () => {
		const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
		const zoteroDoc = readFileSync(join(packageRoot, "docs", "zotero.md"), "utf8");

		expect(existsSync(join(packageRoot, "extensions", "zotero.ts"))).toBe(true);
		expect(readme).toContain("ZOTERO_API_KEY");
		expect(readme).toContain("research_zotero_search");
		expect(readme).toContain("research_export_bibtex");
		expect(zoteroDoc).toContain("Zotero Web API v3");
		expect(zoteroDoc).toContain("ZOTERO_GROUP_ID");
		expect(zoteroDoc).toContain("BibTeX");
	});

	it("provides skill documentation for every MVP workflow", () => {
		for (const dir of skillDirs) {
			const path = join(packageRoot, "skills", dir, "SKILL.md");
			expect(existsSync(path), `${dir}/SKILL.md should exist`).toBe(true);
			const content = readFileSync(path, "utf8");
			expect(content).toContain("适用场景");
			expect(content).toContain("输入格式");
			expect(content).toContain("输出格式");
			expect(content).toContain("质量检查清单");
		}
	});
});
