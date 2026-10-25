/**
 * Brand voice learned from the restaurant's own posted replies. Deterministic
 * (no LLM call): it measures person (I/we), formality, sign-off, emoji use and
 * length, and renders a short style brief that is added to the reply prompt.
 */
const EMOJI = /\p{Extended_Pictographic}/u;
const CONTRACTION = /\b\w+'(s|re|ll|ve|d|m|t)\b/i;

export function summarizeBrandVoice(replies: string[]): string | null {
  const texts = replies.map((t) => (t ?? '').trim()).filter(Boolean).slice(0, 20);
  if (texts.length < 3) return null; // too little signal to claim a style
  const n = texts.length;
  const count = (re: RegExp) => texts.filter((t) => re.test(t)).length;

  const we = count(/\b(we|our|us)\b/i);
  const i = count(/\b(I|my|me)\b/);
  const person = we >= i ? 'Writes as "we" (the team)' : 'Writes in first person ("I")';

  const contractions = count(CONTRACTION);
  const exclaim = count(/!/);
  const formality = contractions / n > 0.5 || exclaim / n > 0.5 ? 'casual and upbeat' : 'polite and fairly formal';

  const emoji = count(EMOJI);
  const emojiLine = emoji / n >= 0.3 ? 'often uses an emoji' : 'avoids emojis';

  const avgWords = Math.round(texts.reduce((s, t) => s + t.split(/\s+/).length, 0) / n);

  // Sign-off: the most common last line/fragment after a dash or newline, if repeated.
  const tails = texts
    .map((t) => {
      const m = t.match(/(?:\n|[-–—]\s*)([^\n\-–—]{2,40})$/);
      return m ? m[1].trim() : '';
    })
    .filter(Boolean);
  const freq = new Map<string, number>();
  tails.forEach((x) => freq.set(x, (freq.get(x) ?? 0) + 1));
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
  const signOff = top && top[1] >= 2 ? `Signs off as "${top[0]}"` : 'No fixed sign-off';

  return `${person}; ${formality}; ${emojiLine}; about ${avgWords} words; ${signOff}.`;
}
