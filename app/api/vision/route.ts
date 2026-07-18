import { NextResponse } from 'next/server';
import { z } from 'zod';
import { detectLanguageFromTicket } from '@/lib/ai/languageDetection';
import { fanContextSchema } from '@/lib/validation/fanContext';
import { guardRequest } from '@/lib/server/guardRequest';

// Maximum decoded image size accepted, before base64 expansion.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Hard body cap, enforced while streaming: a 5MB image is ~6.7MB of base64,
// plus JSON envelope headroom.
const BODY_MAX_BYTES = 8 * 1024 * 1024;

const requestSchema = z.object({
  imageBase64: z.string(),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  fanContext: fanContextSchema,
}).strict();

export async function POST(req: Request) {
  const guard = await guardRequest(req, { route: 'vision', maxBytes: BODY_MAX_BYTES, schema: requestSchema });
  if (!guard.ok) return guard.response;

  const validated = guard.data;

  // Size check FIRST (cheap length arithmetic) — never run the base64 regex
  // over a payload that is already too large to accept.
  const approximateBytes = (validated.imageBase64.length * 3) / 4;
  if (approximateBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Payload too large: Image exceeds ${MAX_IMAGE_BYTES / (1024 * 1024)}MB` },
      { status: 400 }
    );
  }

  // Validate the payload is actually base64 before forwarding to the provider.
  // Canonical base64 is always a multiple of 4 chars (browser btoa/toDataURL
  // pad) — check that first, it's O(1) before the linear regex scan.
  if (
    validated.imageBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(validated.imageBase64)
  ) {
    return NextResponse.json({ error: 'Invalid image encoding: expected base64' }, { status: 400 });
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
    const mapActions = ticket?.section ? [{ op: 'highlight' as const, zoneId: `sec-${ticket.section}` }] : [];

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
