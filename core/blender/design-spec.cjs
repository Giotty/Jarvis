const { z } = require('zod');
// Rich descriptive subobjects are useful planning data, never executable tools.
// Normalize them losslessly rather than spending a repair request on formatting.
const word = z.preprocess(
    (value) =>
      value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value,
    z.string().min(1).max(1000),
  ),
  list = z.array(word).max(16);
const designSpec = z
  .object({
    objectType: word,
    style: word,
    recognitionFeatures: list.min(3),
    dimensions: word,
    primaryForms: list.min(1),
    secondaryForms: list,
    mechanicalDetails: list,
    surfaceDetails: list,
    symmetry: word,
    materials: list.min(1),
    colors: list.min(1),
    lighting: word,
    camera: word,
    quality: z.enum(['QUICK', 'STANDARD', 'HIGH', 'ULTRA']),
    qualityTarget: word,
    referencesUseful: z.boolean(),
    referenceQueries: z.array(z.string().min(1).max(200)).max(4),
    exactText: z
      .array(
        z
          .object({
            text: z.string().min(1).max(160),
            style: z.enum(['raised', 'embossed', 'engraved', 'recessed']),
            placement: word,
          })
          .strict(),
      )
      .max(6),
    generationMode: z.enum(['text', 'image']),
    generationPrompt: z.string().min(80).max(2000),
  })
  .strip();
const score = z.number().min(0).max(10);
const scores = z
  .object({
    recognizability: score,
    silhouette: score,
    proportions: score,
    geometry: score,
    detail: score,
    materials: score,
    lighting: score,
    composition: score,
    userIntent: score,
    overall: score,
  })
  .strict();
const critique = z
  .object({
    accepted: z.boolean(),
    scores,
    missingFeatures: list,
    defects: list,
    corrections: list,
    viewFindings: z
      .array(z.object({ view: word, findings: list }).strict())
      .min(2)
      .max(4),
  })
  .strict();
const qualityModes = {
  QUICK: { references: 1, iterations: 1, samples: 16, size: 512, threshold: 5.5 },
  STANDARD: { references: 2, iterations: 2, samples: 32, size: 640, threshold: 7 },
  HIGH: { references: 3, iterations: 3, samples: 48, size: 768, threshold: 8 },
  ULTRA: { references: 4, iterations: 3, samples: 64, size: 960, threshold: 8.5 },
};
function acceptedReview(review, mode) {
  const target = qualityModes[mode];
  return (
    review.accepted &&
    !review.missingFeatures.length &&
    review.scores.overall >= target.threshold &&
    review.scores.recognizability >= target.threshold &&
    review.scores.userIntent >= target.threshold &&
    (!['HIGH', 'ULTRA'].includes(mode) || Object.values(review.scores).every((v) => v >= 7))
  );
}
module.exports = { designSpec, critique, qualityModes, acceptedReview };
