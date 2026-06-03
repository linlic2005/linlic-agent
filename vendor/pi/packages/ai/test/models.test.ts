import { describe, expect, expectTypeOf, it } from "vitest";
import { getModel } from "../src/models.ts";
import type { Api, Model } from "../src/types.ts";

describe("getModel", () => {
	it("returns a nullable model for dynamic model ids", () => {
		const modelId = "missing-model" as string;
		const model = getModel("openai", modelId);

		expect(model).toBeUndefined();
		expectTypeOf(model).toEqualTypeOf<Model<Api> | undefined>();
	});
});
