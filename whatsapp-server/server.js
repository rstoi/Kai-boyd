import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é Kai Boyd — assessor digital de elite para empreendedores e executivos de alto desempenho. Fusão de John Boyd (OODA Loop), mentor executivo e engenheiro de IA.

PERSONALIDADE:
- Direto, sem enrolação, respeitoso e motivador
- Tom de general + coach de CEOs: mistura linguagem militar ("garanta a iniciativa"), business ("maximize EV") e lean ("PDCA rápido")
- Humor seco ocasional: "Você não perdeu tempo, rodou um OODA lento. Vamos acelerar."
- Trata o usuário como par de alto nível, cobra excelência
- Nunca condescendente

FORMATO DE RESPOSTA (sempre estruture assim):
[OBSERVE] breve análise da situação atual
[ORIENT] síntese + modelos mentais + hipótese
[DECIDE] recomendação clara com % de confiança e EV estimado
[ACT] plano PDCA concreto com passos acionáveis
[PRÓXIMO CICLO] o que monitorar e quando revisar

Use símbolos visuais: → para ações, ◆ para decisões, ▲ para riscos, ✓ para check.
Seja cirúrgico: máximo 300 palavras por resposta, alta densidade de valor.
Estamos em canal WhatsApp — evite formatação Markdown pesada (sem **bold** ou # headings). Use texto simples e emojis com moderação.`;

// In-memory conversation history per user (keyed by WhatsApp phone number)
const sessions = new Map();

function getHistory(phone) {
  if (!sessions.has(phone)) sessions.set(phone, []);
  return sessions.get(phone);
}

// Trim history to last 20 turns to avoid token overflow
function trimHistory(history) {
  const MAX_TURNS = 20;
  if (history.length > MAX_TURNS) history.splice(0, history.length - MAX_TURNS);
}

async function sendWhatsApp(to, text) {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error('WhatsApp send error:', err);
  }
}

async function replyWithKaiBoyd(phone, userText) {
  const history = getHistory(phone);
  history.push({ role: 'user', content: userText });
  trimHistory(history);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: history,
  });

  const reply = response.content[0].text;
  history.push({ role: 'assistant', content: reply });
  await sendWhatsApp(phone, reply);
}

// Webhook verification (Meta requires a GET with hub.challenge)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming messages from WhatsApp
app.post('/webhook', async (req, res) => {
  // Acknowledge immediately so Meta doesn't retry
  res.sendStatus(200);

  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (!message || message.type !== 'text') return;

  const phone = message.from;
  const text = message.text.body.trim();

  console.log(`[${phone}] ${text}`);

  try {
    await replyWithKaiBoyd(phone, text);
  } catch (err) {
    console.error('Claude error:', err.message);
    await sendWhatsApp(
      phone,
      '[OBSERVE] Falha temporária no sistema.\n[ACT] → Tente novamente em instantes.'
    );
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'kai-boyd-whatsapp' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kai Boyd WhatsApp server running on port ${PORT}`));
