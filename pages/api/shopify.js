export const config = {
  api: { bodyParser: { sizeLimit: '25mb' } },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN } = process.env

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_TOKEN) {
    return res.status(500).json({
      error: 'Shopify is not configured. Add SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_TOKEN to your Vercel environment variables.',
    })
  }

  const {
    title, description, price, productType, ageGroup,
    materials, features, tags, collectionId,
    imageBase64, imageMediaType,
  } = req.body

  const base = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01`
  const headers = {
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json',
  }

  // Convert plain-text description paragraphs to HTML
  const bodyHtml = (description || '')
    .split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n')

  try {
    // 1. Create the product (as a draft so nothing goes live by accident)
    const productRes = await fetch(`${base}/products.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        product: {
          title: title || 'New HVP Product',
          body_html: bodyHtml,
          vendor: 'Hello Violet Page',
          product_type: productType || '',
          tags: Array.isArray(tags) ? tags.join(', ') : '',
          status: 'draft',
          variants: [{
            price: String(parseFloat(price) || '0.00'),
            inventory_management: null,
          }],
          metafields: [
            materials ? { namespace: 'hvp', key: 'materials', value: materials, type: 'single_line_text_field' } : null,
            features  ? { namespace: 'hvp', key: 'special_features', value: features, type: 'single_line_text_field' } : null,
            ageGroup  ? { namespace: 'hvp', key: 'age_group', value: ageGroup, type: 'single_line_text_field' } : null,
          ].filter(Boolean),
        },
      }),
    })

    const productData = await productRes.json()
    if (!productRes.ok) {
      const msg = productData.errors ? JSON.stringify(productData.errors) : `Shopify error ${productRes.status}`
      throw new Error(msg)
    }

    const productId = productData.product.id

    // 2. Upload the product image (non-fatal if it fails)
    if (imageBase64 && imageMediaType) {
      const ext = imageMediaType.split('/')[1] || 'jpg'
      await fetch(`${base}/products/${productId}/images.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image: {
            attachment: imageBase64,
            filename: `hvp-product-${productId}.${ext}`,
          },
        }),
      }).catch(() => {})
    }

    // 3. Add to a collection if one was selected (non-fatal if it fails)
    if (collectionId) {
      await fetch(`${base}/collects.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          collect: { product_id: productId, collection_id: Number(collectionId) },
        }),
      }).catch(() => {})
    }

    const productUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/products/${productId}`
    res.status(200).json({ productUrl, productId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
