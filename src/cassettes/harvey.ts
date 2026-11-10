import type { Cassette } from '../copper/types';

export type HarveyTone = 'warm' | 'direct' | 'formal';

export interface HarveyPayload {
  to?: string;
  company?: string;
  product?: string;
  notes?: string;
  tone?: HarveyTone;
}

export interface HarveyDraft {
  to: string;
  subject: string;
  body: string;
  tone: HarveyTone;
  draftedBy: 'harvey';
}

const GREETING: Record<HarveyTone, string> = {
  warm: 'Hope your week is going well.',
  direct: 'Straight to the point:',
  formal: 'I hope this message finds you well.',
};

const CTA: Record<HarveyTone, string> = {
  warm: 'Worth a 20 minute call next week?',
  direct: 'Reply with a time and I will send the invite.',
  formal: 'Would a 20 minute call next week be convenient?',
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export const cassette = 'harvey';

/**
 * Harvey — AI sales cassette.
 *
 * Plain business logic: no routing, no tracking, no gateway code. Everything it
 * keeps in memory lives on this instance, so `teardown()` + module eviction is
 * all that is needed to make it cheap again.
 */
export function create(): Cassette<HarveyPayload, HarveyDraft> {
  // Bounded, instance-scoped cache so repeat payloads do not re-draft.
  const cache = new Map<string, HarveyDraft>();
  const CACHE_LIMIT = 50;

  return {
    handle(payload) {
      const to = text(payload.to) ?? 'there';
      const company = text(payload.company) ?? 'your team';
      const product = text(payload.product) ?? 'the platform';
      const notes = text(payload.notes) ?? 'cutting infrastructure spend without slowing the roadmap';
      const tone: HarveyTone = payload.tone === 'direct' || payload.tone === 'formal' ? payload.tone : 'warm';

      const key = `${to}|${company}|${product}|${notes}|${tone}`;
      const cached = cache.get(key);
      if (cached) {
        return cached;
      }

      const draft: HarveyDraft = {
        to,
        subject: `${product} for ${company}`,
        body: [
          `Hi ${to},`,
          '',
          GREETING[tone],
          '',
          `We built ${product} for teams like ${company}: ${notes}`,
          CTA[tone],
          '',
          '— Harvey',
        ].join('\n'),
        tone,
        draftedBy: 'harvey',
      };

      if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (!oldest.done) {
          cache.delete(oldest.value);
        }
      }
      cache.set(key, draft);
      return draft;
    },

    teardown() {
      cache.clear();
    },
  };
}
