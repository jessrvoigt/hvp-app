// Fetches the store's Shopify collections so the UI can show a real dropdown.
// Returns empty array gracefully if Shopify env vars aren't set yet.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN } = process.env

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_TOKEN) {
    return res.status(200).json({ collections: [] })
  }

  try {
    const base = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01`
    const headers = { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }

    const [customRes, smartRes] = await Promise.all([
      fetch(`${base}/custom_collections.json?limit=250`, { headers }),
      fetch(`${base}/smart_collections.json?limit=250`, { headers }),
    ])

    const [customData, smartData] = await Promise.all([
      customRes.json(),
      smartRes.json(),
    ])

    const collections = [
      ...(customData.custom_collections || []),
      ...(smartData.smart_collections || []),
    ]
      .map(c => ({ id: String(c.id), title: c.title }))
      .sort((a, b) => a.title.localeCompare(b.title))

    res.status(200).json({ collections })
  } catch {
    res.status(200).json({ collections: [] })
  }
}
