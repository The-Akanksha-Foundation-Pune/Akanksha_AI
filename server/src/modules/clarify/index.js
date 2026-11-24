// Clarify module: when a question leaves out something that changes the answer (which year, which subject…),
// Claude calls ask_user instead of guessing. The chat loop stops there and the client shows the questions in a
// small dialog; the user's choices come back as the next message. Nothing is stored beyond the normal chat text.

const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 6;

// First line of the stored assistant message for a clarifying turn. chat.js uses it to keep such turns out of answer reuse.
export const CLARIFY_PREFIX = 'To answer this I need a few details:';

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function normaliseQuestions(input) {
  const list = Array.isArray(input?.questions) ? input.questions : [];
  return list
    .map((q) => ({
      question: clean(q?.question, 140),
      options: [...new Set((Array.isArray(q?.options) ? q.options : []).map((o) => clean(o, 60)).filter(Boolean))].slice(0, MAX_OPTIONS),
    }))
    .filter((q) => q.question)
    .slice(0, MAX_QUESTIONS);
}

// Plain-text version of the questions, saved as the assistant's message so the chat reads sensibly later.
export function clarifyText(questions) {
  return CLARIFY_PREFIX + '\n\n' + questions.map((q) => `- **${q.question}**${q.options.length ? ` ${q.options.join(' / ')}` : ''}`).join('\n');
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
          'Where it makes sense include an option such as "Overall" or "All". Use real values for options: take them from the schema, table notes or earlier turns, or run one quick query to list them. ' +
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
                  options: { type: 'array', items: { type: 'string' }, description: 'Two to six short answer choices, most likely first.' },
                },
                required: ['question', 'options'],
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
      async execute(input) {
        const questions = normaliseQuestions(input);
        if (!questions.length) throw new Error('ask_user needs at least one question with text');
        return { content: 'The questions were shown to the user. Stop here and wait for their reply.', ui: { questions }, stop: true };
      },
    },
  ],
};
