import 'server-only';

/**
 * What a visitor should read when a Claude call fails. The raw message stays in the log for us.
 * Spend limits are reported in two shapes (400 "workspace API usage limits", 429 enforced_spend_limit_reached),
 * so both are matched, as are rate limits and overload (429, 529).
 */
export function claudeErrorMessage(e: unknown): string {
  const err = e as { statusCode?: number; message?: string; responseBody?: string };
  const text = `${err?.message ?? ''} ${err?.responseBody ?? ''}`;
  if (/usage limit|spend limit|spend_limit|credit balance|billing/i.test(text)) {
    return 'Live runs are paused: the demo has used up its Claude budget for now. The recorded run on the home page shows a complete one.';
  }
  if (err?.statusCode === 429 || err?.statusCode === 529 || /overloaded|rate limit/i.test(text)) {
    return 'Claude is busy right now. Try again in a minute, or open the recorded run from the home page.';
  }
  return 'The agent could not reach Claude. Try again in a minute, or open the recorded run from the home page.';
}
