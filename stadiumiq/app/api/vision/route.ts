import { NextResponse } from 'next/server';
import { z } from 'zod';
import { detectLanguageFromTicket } from '@/lib/ai/languageDetection';

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

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const result = requestSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const validated = result.data;
  
  // Validate base64 decoded size <= 5MB
  const approximateBytes = (validated.imageBase64.length * 3) / 4;
  if (approximateBytes > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Payload too large: Image exceeds 5MB' }, { status: 400 });
  }

  // Graceful fallback response when vision is unsupported or fails
  const fallbackMessage = "Vision services are unavailable or failed. Please select your language manually.";
  const fallbackResponse = {
    message: fallbackMessage,
    language: validated.fanContext.language || 'en',
    mapActions: [],
    alertLevel: 'none' as const,
    meta: { tool: 'vision-unavailable' },
  };

  try {
    const detectResult = await detectLanguageFromTicket(validated.imageBase64, validated.mimeType);
    if ('error' in detectResult) {
      console.error('Language detection error:', detectResult.error);
      return NextResponse.json(fallbackResponse);
    }

    const ticket = detectResult.ticketData;
    const mapActions = ticket?.section ? [{ type: 'highlightZone', zoneId: ticket.section, pulse: true }] : [];

    return NextResponse.json({
      message: 'Ticket processed successfully.',
      language: detectResult.language,
      ticket: ticket,
      mapActions: mapActions,
      alertLevel: 'none',
      meta: { tool: 'vision-ticket', confidence: detectResult.confidence }
    });

  } catch (err) {
    console.error('Vision processing exception:', err);
    return NextResponse.json(fallbackResponse);
  }
}
