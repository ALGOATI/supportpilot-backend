import OpenAI from "openai";

const FALLBACK_HANDOFF_MESSAGE = "Let me connect you with the owner for this one.";

function buildKnowledgeBlock(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return "- No knowledge entries available.";

  const lines = [];
  for (const row of list.slice(0, 80)) {
    const question = String(row?.question || "").trim();
    const answer = String(row?.answer || "").trim();
    if (!question || !answer) continue;
    lines.push(`- Q: ${question}`, `  A: ${answer}`);
  }
  return lines.length ? lines.join("\n") : "- No knowledge entries available.";
}

function buildSystemPrompt({ businessName, knowledgeBase }) {
  return `
You are SupportPilot, a customer support assistant for "${businessName}".

Rules:
- Only answer using the provided knowledge base.
- If the answer is missing or uncertain, say exactly: "${FALLBACK_HANDOFF_MESSAGE}".
- Keep replies short, friendly, and helpful.
- Support both English and Arabic naturally.
- Do not invent policies, prices, hours, or contact details.

Knowledge Base:
${buildKnowledgeBlock(knowledgeBase)}
  `.trim();
}

function getTokensUsed(usage) {
  const total = Number(usage?.total_tokens);
  if (Number.isFinite(total)) return total;
  const prompt = Number(usage?.prompt_tokens);
  const completion = Number(usage?.completion_tokens);
  if (Number.isFinite(prompt) || Number.isFinite(completion)) {
    return (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0);
  }
  return 0;
}

export function createOpenAiSupportService({ apiKey = process.env.OPENAI_API_KEY } = {}) {
  const client = apiKey ? new OpenAI({ apiKey }) : null;

  async function generateReply({ businessName, message, knowledgeBase }) {
    if (!client) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt({
            businessName: String(businessName || "the business"),
            knowledgeBase,
          }),
        },
        {
          role: "user",
          content: String(message || "").trim(),
        },
      ],
    });

    const reply =
      String(completion?.choices?.[0]?.message?.content || "").trim() ||
      FALLBACK_HANDOFF_MESSAGE;
    const tokensUsed = getTokensUsed(completion?.usage);

    return {
      reply,
      tokensUsed,
      usage: {
        promptTokens: Number(completion?.usage?.prompt_tokens || 0),
        completionTokens: Number(completion?.usage?.completion_tokens || 0),
        totalTokens: tokensUsed,
      },
      model: "gpt-4o-mini",
    };
  }

  return {
    generateReply,
    FALLBACK_HANDOFF_MESSAGE,
  };
}
