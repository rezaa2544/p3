export type AssessmentScore = {
  id: string;
  title: string;
  maxScore: number;
  weight: number;
  score: number | null;
  status: string;
  approved: boolean;
};

export type SubjectAverage = {
  average: number | null;
  counted: number;
  missing: number;
  excluded: number;
  totalWeight: number;
  complete: boolean;
};

/**
 * میانگین وزنی نمرات یک درس، نرمال‌شده به مقیاس ۲۰.
 * فقط نمراتی که تأیید شده‌اند و مقدار عددی دارند محاسبه می‌شوند؛ نمرات ناقص
 * باعث «ناقص بودن» نتیجه می‌شوند و هرگز با صفر جایگزین نمی‌شوند.
 */
export function computeSubjectAverage(items: AssessmentScore[]): SubjectAverage {
  const usable = items.filter((i) => i.approved && typeof i.score === 'number' && i.score !== null);
  const missing = items.filter((i) => i.approved && (i.score === null || typeof i.score !== 'number')).length;
  const excluded = items.filter((i) => !i.approved).length;
  if (usable.length === 0) {
    return { average: null, counted: 0, missing, excluded, totalWeight: 0, complete: false };
  }
  let weighted = 0;
  let totalWeight = 0;
  for (const item of usable) {
    const normalized = (Number(item.score) / item.maxScore) * 20;
    weighted += normalized * item.weight;
    totalWeight += item.weight;
  }
  const average = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) / 100 : null;
  return {
    average,
    counted: usable.length,
    missing,
    excluded,
    totalWeight,
    complete: missing === 0 && excluded === 0,
  };
}

export function describeAverage(avg: SubjectAverage, threshold = 10): 'pass' | 'fail' | 'incomplete' | 'no-data' {
  if (avg.average === null) return 'no-data';
  if (!avg.complete) return 'incomplete';
  return avg.average >= threshold ? 'pass' : 'fail';
}
