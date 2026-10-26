import { z } from 'zod';

/** `{ answers: { [questionId]: optionIndex } }` */
export const QuizSubmissionSchema = z.object({
  answers: z.record(z.string().max(64), z.number().int().min(0).max(10)).refine((a) => Object.keys(a).length <= 60),
});
