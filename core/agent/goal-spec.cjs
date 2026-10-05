const { z } = require('zod');
const words = z.string().trim().min(1).max(500);
const list = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value
          .filter((v) => v != null)
          .map((v) =>
            v && typeof v === 'object'
              ? typeof v.name === 'string'
                ? v.name
                : typeof v.label === 'string'
                  ? v.label
                  : JSON.stringify(v)
              : v,
          )
      : value,
  z
    .array(words)
    .max(20)
    .nullish()
    .transform((value) => value ?? []),
);
const goalSpec = z
  .object({
    subject: words,
    entities: list,
    intent: z.enum(['answer', 'research', 'teach', 'compare', 'create', 'act', 'mixed']),
    requestedFacts: list,
    requestedActions: list,
    requestedOutputs: list,
    currentInformationRequired: z.boolean(),
    researchRequired: z.boolean(),
    comparisonRequired: z.boolean(),
    visualizationRequired: z.boolean(),
    imagesUseful: z.boolean(),
    chartsUseful: z.boolean(),
    timelineUseful: z.boolean(),
    threeDRequested: z.boolean(),
    saveRequested: z.boolean(),
    folderRequested: z.string().max(80).nullable(),
    computerInspectionRequired: z.boolean(),
    constraints: list,
  })
  .strict();
const goalInstructions = `Interpret the user's actual goal semantically, never by a command phrase table. Return a GoalSpec, not an answer. Do not invent current entity identities: preserve an unresolved group as subject and let research resolve its members from dated evidence. Distinguish requested actions from useful outputs. Teaching, comparisons and substantial research benefit from a visual workspace even if no exact presentation phrase was used. Images/charts/timeline are useful only when they clarify the goal; do not require charts without comparable data. threeDRequested and saveRequested require actual user intent. folderRequested is the user's exact folder or null. computerInspectionRequired is true only when the goal requires local machine information. Preserve constraints, exact text, requested dates, comparison scope and privacy. Nothing authorizes additional consequential actions.`;
module.exports = { goalSpec, goalInstructions };
