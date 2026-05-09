import Anthropic from '@anthropic-ai/sdk'

// Allow up to 25 MB request body (covers Shopify's 20 MB image limit + JSON overhead)
export const config = {
  api: { bodyParser: { sizeLimit: '25mb' } },
}

const SYSTEM_PROMPT = `You are a product copywriter for Hello Violet Page (HVP), a coastal prep children's apparel brand founded to honor four women: Violet Page, Barbara Ann (mother), Nola Elaine (grandmother), and Violet Moran.

BRAND VOICE RULES:
- Warm, storytelling-driven, heritage-conscious, playful
- Use the Product Description Formula:
  1. Opening (heritage/joy): "Every poncho honors…" or "Crafted to bring coastal joy…"
  2. Materials: specific fabrics
  3. Connection to brand: one sentence about Violet's legacy or the four women
  4. Key details: sizing, features, care
  5. Closing (lifestyle): how it fits coastal prep aesthetic
- NEVER use: "best-in-class", "game-changer", "synergy", or more than one exclamation mark per description

PRICING GUIDELINES:
- Children's ponchos: $25–$35
- Toddler basics: $18–$28
- Adult totes: $45–$65
- Premium seasonal: $60–$80

VALID TAGS (choose 3–5): spring-2025, summer-2025, fall-2025, winter-2025, poncho, tote, toddler-shirt, hoodie, basic, seasonal, coastal-prep, new-arrival, handmade, navy, coastal-blue, natural, pastel

Return ONLY valid JSON — no markdown, no code blocks, no backticks, no extra text.`

const USER_PROMPT = `Analyze this product image. Return ONLY this JSON (pure JSON, nothing else):

{
  "title": "Product Title (3-5 words, no brand name)",
  "description": "2-3 paragraph HVP-voice description separated by \\n\\n",
  "tags": ["tag1", "tag2", "tag3"],
  "suggested_collection": "Spring 2025 Collection",
  "suggested_price": 32.00,
  "product_type": "poncho",
  "materials_notes": "fabric details visible in image",
  "age_group": "toddler",
  "special_features": "any visible special details"
}`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not set. Add it to your Vercel environment variables.',
    })
  }

  const { base64, mediaType } = req.body
  if (!base64 || !mediaType) return res.status(400).json({ error: 'Missing image data' })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const startTime = Date.now()

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: USER_PROMPT },
        ],
      }],
    })

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const rawText = message.content.filter(c => c.type === 'text').map(c => c.text).join('')
    const clean = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    let listing
    try { listing = JSON.parse(clean) }
    catch { return res.status(500).json({ error: `Claude returned invalid JSON. Raw: ${rawText.slice(0, 300)}` }) }

    const inTok = message.usage?.input_tokens || 0
    const outTok = message.usage?.output_tokens || 0
    const cost = `$${((inTok * 3 + outTok * 15) / 1_000_000).toFixed(4)}`

    res.status(200).json({ listing, time: elapsed, tokens: inTok + outTok, cost })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
