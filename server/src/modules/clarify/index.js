// Clarify module: when a question leaves out something that changes the answer (which year, which subject…),
// Claude calls ask_user instead of guessing. The chat loop stops there and the client shows the questions in a
// small dialog; the user's choices come back as the next message. Nothing is stored beyond the normal chat text.
//
// Choices that are values in the data (academic years, schools, subjects…) are read from the database, not
// written by the model (user request, 24 Nov 2026: the dialog offered years but not 2026-2027, which was in
// the data). The model passes `options_sql`; the server runs it and uses what comes back. The model's own
// `options` are only the fallback, for when that query fails or returns nothing, and for choices that are not
// data ("Average score" or "Number of students").
import { distinctValues } from '../sql/index.js';

const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 6; // choices the model writes itself
const MAX_DB_OPTIONS = 40; // choices read from the database (every school fits; the dialog scrolls)
const TEXT_OPTIONS = 12; // choices written into the saved chat text before "…"

// First line of the stored assistant message for a clarifying turn. chat.js uses it to keep such turns out of answer reuse.
export const CLARIFY_PREFIX = 'To answer this I need a few details:';

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const cleanList = (v, n) => [...new Set((Array.isArray(v) ? v : []).map((o) => clean(o, 60)).filter(Boolean))].slice(0, n);

export function normaliseQuestions(input) {
  const list = Array.isArray(input?.questions) ? input.questions : [];
  return list
    .map((q) => ({
      question: clean(q?.question, 140),
      options: cleanList(q?.options, MAX_OPTIONS),
      extra: cleanList(q?.extra_options, 3),
      sql: typeof q?.options_sql === 'string' ? q.options_sql.trim() : '',
    }))
    .filter((q) => q.question)
    .slice(0, MAX_QUESTIONS);
}

// Replaces a question's choices with the values its options_sql returns, then the non-data extras ("Overall").
// If the query is refused, fails or finds nothing, the model's own choices are kept.
async function withRealOptions(q, ctx) {
  let options = q.options;
  let fromData = false;
  if (q.sql) {
    try {
      const values = (await distinctValues(ctx, q.sql, { max: MAX_DB_OPTIONS })).map((v) => clean(v, 60)).filter(Boolean);
      if (values.length) { options = values; fromData = true; }
    } catch (err) {
      console.warn('[clarify] options_sql not used:', err.message);
    }
  }
  const seen = new Set(options.map((o) => o.toLowerCase()));
  for (const e of q.extra) if (!seen.has(e.toLowerCase())) { options = [...options, e]; seen.add(e.toLowerCase()); }
  return { question: q.question, options, fromData };
}

// Plain-text version of the questions, saved as the assistant's message so the chat reads sensibly later.
export function clarifyText(questions) {
  return CLARIFY_PREFIX + '\n\n' + questions.map((q) => `- **${q.question}**${q.options.length ? ` ${q.options.slice(0, TEXT_OPTIONS).join(' / ')}${q.options.length > TEXT_OPTIONS ? ' / …' : ''}` : ''}`).join('\n');
}

export default {
  name: 'clarify',
  order: 12, // static text, sits between the schema (10) and the glossary (15) so it never disturbs the cache

  prompt() {
    return [
      {
        text:
          'Before you query, check that the question pins down everything needed for one correct answer. ' +
          'If a detail that would materially change the answer is missing, call ask_user instead of guessing. ' +
          'Typical missing details: academic year, assessment round (BOY, MOY, EOY), subject or overall, grade, school or city, and the measure wanted (average score, count, percentage). ' +
          'For a question about assessment scores, the academic year and the subject (one subject, or overall across subjects) both matter; ask for whichever is not given. ' +
          `Ask only for what is missing and matters: at most ${MAX_QUESTIONS} questions, each short, each with 2 to ${MAX_OPTIONS} short options, the most likely first. ` +
          'Choices that are values stored in the data (academic year, school, city, grade, subject, assessment round, and anything else that is a column value) must come from the database, never from your memory or the examples above: ' +
          'set options_sql to one SELECT that lists them, for example SELECT DISTINCT academic_year FROM student_attendance_data ORDER BY academic_year DESC. ' +
          'Return one column with every value the person could mean, up to 40 rows and without a LIMIT smaller than that, the most likely choice first (newest year first), filtered to what the question already fixed (for example only the subjects of the school that was named). ' +
          'Read the values from the same table you will use to answer the question, so the choices are exactly what the answer can use; a small lookup table often holds only some of them and would hide real choices. ' +
          'On a large table a DISTINCT is fast when that column leads an index (the schema lists the indexes of large tables); only if no index leads with it, use another table that holds the same records. ' +
          'Every question whose choices are data needs its own options_sql, including the assessment round or type. ' +
          'The app runs that query and shows what it returns, so also fill options with your best guess in case it fails. ' +
          'For choices that are not data (the measure wanted, "this year" or "last year"), write options yourself and set options_sql to an empty string. ' +
          'Put a catch-all such as "Overall" or "All schools" in extra_options, not in options; it is added after the real values. ' +
          'Do not ask when the question, the conversation or the user\'s preferences already settle the detail, when the user has told you to use your judgement, or when the detail would not change the answer. ' +
          'When you call ask_user, write no other text and make no further tool calls; the user\'s choices arrive as their next message.',
      },
    ];
  },

  tools: [
    {
      definition: {
        name: 'ask_user',
        description:
          'Ask the user up to 3 short multiple-choice questions when their question is missing a detail that changes the answer ' +
          '(for example which academic year, which subject, or overall). The questions are shown in a small dialog and the turn ends.',
        input_schema: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              description: 'One to three questions.',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string', description: 'The question, under 12 words, e.g. "Which academic year?"' },
                  options: { type: 'array', items: { type: 'string' }, description: 'Two to six short answer choices, most likely first. Used as they are when options_sql is empty; otherwise only if that query fails.' },
                  options_sql: { type: 'string', description: 'One SELECT returning a single column with the real values to offer (up to 40 rows, most likely first), e.g. SELECT DISTINCT academic_year FROM student_attendance_data ORDER BY academic_year DESC. Required whenever the choices are values in the data. Empty string when they are not.' },
                  extra_options: { type: 'array', items: { type: 'string' }, description: 'Up to three catch-all choices added after the real values, e.g. "Overall", "All schools". Empty array if none.' },
                },
                required: ['question', 'options', 'options_sql', 'extra_options'],
                additionalProperties: false,
              },
            },
          },
          required: ['questions'],
          additionalProperties: false,
        },
        strict: true,
        eager_input_streaming: true,
      },
      describe: () => ({}),
      async execute(input, ctx) {
        const asked = normaliseQuestions(input);
        if (!asked.length) throw new Error('ask_user needs at least one question with text');
        const questions = await Promise.all(asked.map((q) => withRealOptions(q, ctx)));
        return { content: 'The questions were shown to the user. Stop here and wait for their reply.', ui: { questions }, stop: true };
      },
    },
  ],
};
