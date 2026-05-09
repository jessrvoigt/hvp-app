import Anthropic from '@anthropic-ai/sdk'

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

const BASE_PROMPT = `Analyze this product image. Return ONLY this JSON (pure JSON, nothing else):

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

function buildPrompt(examples) {
  if (!examples || examples.length === 0) return BASE_PROMPT

  const exampleText = examples.map((ex, i) => {
    const orig = ex.original
    const edit = ex.edited
    const changes = []

    if (orig.title !== edit.title)
      changes.push(`  Title: "${orig.title}" → "${edit.title}"`)
    if (orig.description !== edit.description)
      changes.push(`  Description: rewritten (kept tone: ${edit.description.slice(0, 80)}…)`)
    if (String(orig.suggested_price) !== String(edit.price) && edit.price)
      changes.push(`  Price: $${orig.suggested_price} → $${edit.price}`)
    if (JSON.stringify(orig.tags) !== JSON.stringify(edit.tags))
      changes.push(`  Tags: ${orig.tags?.join(', ')} → ${edit.tags?.join(', ')}`)
    if (orig.product_type !== edit.productType && edit.productType)
      changes.push(`  Product type: ${orig.product_type} → ${edit.productType}`)

    if (changes.length === 0) return null
    return `EXAMPLE ${i + 1} — what the user changed:\n${changes.join('\n')}`
  }).filter(Boolean).join('\n\n')

  if (!exampleText) return BASE_PROMPT

  return `${BASE_PROMPT}

---
LEARN FROM THESE EDITS — the owner has corrected previous listings. Match her style:

${exampleText}

Apply these patterns to this new product.`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not set. Add it to your Vercel environment variables.',
    })
  }

  const { base64, mediaType, examples } = req.body
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
          { type: 'text', text: buildPrompt(examples) },
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
