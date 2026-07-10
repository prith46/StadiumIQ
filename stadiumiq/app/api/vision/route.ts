import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/ai/client';
import { VISION_TICKET_PROMPT } from '@/lib/ai/prompts';
import { ChatMessage } from '@/lib/ai/client';

const requestSchema = z.object({
  imageBase64: z.string(),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  fanContext: z.object({
    language: z.string(),
    accessibility: z.boolean(),
    location: z.string().optional(),
    group: z.enum(['solo', 'family', 'group']).optional(),
    leavingEarly: z.boolean().optional(),
    ticket: z.object({
      section: z.string(),
      gate: z.string(),
      nationality: z.string(),
      countryCode: z.string(),
      seat: z.string().optional(),
    }).optional(),
  }),
}).strict();

const NATIONALITY_TO_LANG: Record<string, string> = {
  USA: 'en',
  MEX: 'es',
  FRA: 'fr',
  BRA: 'pt',
  JPN: 'ja',
  KOR: 'ko',
  ARG: 'es',
  GER: 'de',
};

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const result = requestSchema.safeParse(body);
  if (!result.success) {
    // Never surface raw zod error internals to the client (§8).
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const validated = result.data;
  
  // Validate base64 decoded size <= 5MB
  // A base64 string has 4 chars for every 3 bytes. Approximate check:
  const approximateBytes = (validated.imageBase64.length * 3) / 4;
  if (approximateBytes > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Payload too large: Image exceeds 5MB' }, { status: 400 });
  }

  // Graceful fallback response when vision is unsupported or fails
  const fallbackMessage = "Vision services are currently unavailable. Please select your language manually from the accessibility menu.";
  const fallbackResponse = {
    message: fallbackMessage,
    language: validated.fanContext.language || 'en',
    mapActions: [],
    alertLevel: 'none' as const,
    meta: { tool: 'vision-unavailable' },
  };

  let client;
  try {
    client = createClient();
  } catch (err) {
    console.error('Failed to create AI client:', err);
    return NextResponse.json(fallbackResponse);
  }

  if (!client.supportsVision) {
    return NextResponse.json(fallbackResponse);
  }

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: VISION_TICKET_PROMPT },
      { role: 'user', content: 'Here is my ticket photo.' }
    ];

    const chatResult = await client.visionChat(messages, validated.imageBase64, validated.mimeType);
    if (!chatResult.text) {
      return NextResponse.json(fallbackResponse);
    }

    let cleanJson = chatResult.text.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
    }

    const modelJson = JSON.parse(cleanJson);
    let resolvedLanguage = 'en';

    if (modelJson.language) {
      const code = modelJson.language.trim().toUpperCase();
      if (NATIONALITY_TO_LANG[code]) {
        resolvedLanguage = NATIONALITY_TO_LANG[code];
      } else if (Object.values(NATIONALITY_TO_LANG).includes(modelJson.language.toLowerCase())) {
        resolvedLanguage = modelJson.language.toLowerCase();
      } else {
        resolvedLanguage = 'en';
      }
    }

    return NextResponse.json({
      message: modelJson.message || 'Ticket processed successfully.',
      language: resolvedLanguage,
      mapActions: modelJson.mapActions || [],
      alertLevel: modelJson.alertLevel || 'none',
      meta: { tool: 'vision-ticket' }
    });

  } catch (err) {
    console.error('Vision processing error:', err);
    return NextResponse.json(fallbackResponse);
  }
}
