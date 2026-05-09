import Head from 'next/head'
import { useState, useRef, useEffect, useCallback } from 'react'

const CLAUDE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 20 * 1024 * 1024
const MAX_IMAGES = 10

const ALL_TAGS = [
  'spring-2025', 'summer-2025', 'fall-2025', 'winter-2025',
  'poncho', 'tote', 'toddler-shirt', 'hoodie', 'basic', 'seasonal',
  'coastal-prep', 'new-arrival', 'handmade',
  'navy', 'coastal-blue', 'natural', 'pastel',
]

function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const MAX_DIM = 1568
      let { width, height } = img
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM }
        else { width = Math.round(width * MAX_DIM / height); height = MAX_DIM }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.src = dataUrl
  })
}

export default function Home() {
  // Multiple images stored as array of { base64, mediaType, name, size, preview }
  const [images, setImages]             = useState([])
  const [formatWarn, setFormatWarn]     = useState(null)
  const [dragging, setDragging]         = useState(false)
  const [generating, setGenerating]     = useState(false)
  const [genMeta, setGenMeta]           = useState(null)
  const [error, setError]               = useState(null)
  const [form, setForm]                 = useState(null)
  const [originalListing, setOriginalListing] = useState(null)
  const [tags, setTags]                 = useState([])
  const [tagInput, setTagInput]         = useState('')
  const [shopifyCollections, setShopifyCollections] = useState([])
  const [pushing, setPushing]           = useState(false)
  const [shopifyResult, setShopifyResult] = useState(null)
  const [history, setHistory]           = useState([])
  const [toast, setToast]               = useState(null)

  const toastRef     = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem('hvp_listings') || '[]')) } catch {}
    fetch('/api/collections')
      .then(r => r.json())
      .then(d => { if (d.collections?.length) setShopifyCollections(d.collections) })
      .catch(() => {})
  }, [])

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 2600)
  }, [])

  // ── File handling ─────────────────────────────────────────────────────────────
  const processFiles = useCallback((fileList) => {
    setError(null)
    setFormatWarn(null)
    setShopifyResult(null)

    const incoming = Array.from(fileList)
    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) { showToast(`Max ${MAX_IMAGES} images per listing`); return }
    const toProcess = incoming.slice(0, remaining)

    toProcess.forEach(file => {
      if (file.size > MAX_BYTES) { setError(`${file.name} is too large (max 20 MB)`); return }

      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target.result

        if (!CLAUDE_TYPES.has(file.type)) {
          setFormatWarn(`${file.name}: convert to JPG, PNG, WebP, or GIF for Claude to analyze.`)
          return
        }

        compressImage(dataUrl).then(compressed => {
          setImages(prev => [
            ...prev,
            {
              base64:    compressed.split(',')[1],
              mediaType: 'image/jpeg',
              name:      file.name,
              size:      file.size,
              preview:   dataUrl, // show original for preview quality
            },
          ])
        })
      }
      reader.readAsDataURL(file)
    })
  }, [images, showToast])

  const removeImage = useCallback((index) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const clearImages = useCallback(() => {
    setImages([])
    setFormatWarn(null)
    setError(null)
    setShopifyResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // ── Tags ───────────────────────────────────────────────────────────────────────
  const addTag    = useCallback((tag) => { tag = tag.trim().toLowerCase().replace(/\s+/g, '-'); if (!tag) return; setTags(p => p.includes(tag) ? p : [...p, tag]); setTagInput('') }, [])
  const removeTag = useCallback((tag) => setTags(p => p.filter(t => t !== tag)), [])
  const toggleTag = useCallback((tag) => setTags(p => p.includes(tag) ? p.filter(t => t !== tag) : [...p, tag]), [])

  // ── Generate ───────────────────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (!images.length) return
    setGenerating(true); setError(null); setForm(null); setOriginalListing(null); setShopifyResult(null)

    const examples = history
      .filter(h => h.original && h.edited)
      .slice(0, 20)
      .map(h => ({ original: h.original, edited: h.edited }))

    try {
      const res  = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: images.map(img => ({ base64: img.base64, mediaType: img.mediaType })),
          examples,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setGenMeta({ time: data.time, tokens: data.tokens, cost: data.cost })
      const l = data.listing
      setOriginalListing(l)
      setForm({ title: l.title || '', description: l.description || '', price: l.suggested_price || '', collection: l.suggested_collection || '', collectionId: '', productType: l.product_type || '', ageGroup: l.age_group || '', materials: l.materials_notes || '', features: l.special_features || '' })
      setTags(Array.isArray(l.tags) ? l.tags : [])
    } catch (err) {
      setError(err.message || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }, [images, history])

  // ── Shopify ────────────────────────────────────────────────────────────────────
  const pushToShopify = useCallback(async () => {
    if (!form) return
    setPushing(true); setError(null)
    try {
      const res  = await fetch('/api/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send first image as primary product image
        body: JSON.stringify({ ...form, tags, imageBase64: images[0]?.base64 || null, imageMediaType: images[0]?.mediaType || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setShopifyResult(data.productUrl)
      showToast('Product created in Shopify!')
      const entry = { id: Date.now(), savedAt: new Date().toLocaleString(), listing: { ...form, tags }, original: originalListing || null, edited: { ...form, tags } }
      const next  = [entry, ...history].slice(0, 50)
      setHistory(next); localStorage.setItem('hvp_listings', JSON.stringify(next))
    } catch (err) {
      setError(err.message || 'Shopify push failed')
    } finally {
      setPushing(false)
    }
  }, [form, tags, images, originalListing, history, showToast])

  // ── History ────────────────────────────────────────────────────────────────────
  const saveToHistory = useCallback(() => {
    if (!form?.title) { showToast('Add a title before saving'); return }
    const entry = { id: Date.now(), savedAt: new Date().toLocaleString(), listing: { ...form, tags }, original: originalListing || null, edited: { ...form, tags } }
    const next  = [entry, ...history].slice(0, 50)
    setHistory(next); localStorage.setItem('hvp_listings', JSON.stringify(next)); showToast('Saved!')
  }, [form, tags, originalListing, history, showToast])

  const loadFromHistory = useCallback((entry) => {
    const l = entry.listing
    setForm({ title: l.title || '', description: l.description || '', price: l.price || '', collection: l.collection || '', collectionId: l.collectionId || '', productType: l.productType || '', ageGroup: l.ageGroup || '', materials: l.materials || '', features: l.features || '' })
    setTags(Array.isArray(l.tags) ? l.tags : [])
    setShopifyResult(null); showToast('Listing loaded')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [showToast])

  const downloadJson = useCallback(() => {
    if (!form) return
    const data = { ...form, tags }
    const name = form.title ? 'hvp-' + form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json' : 'hvp-listing.json'
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: name }).click()
    URL.revokeObjectURL(url); showToast('Downloaded')
  }, [form, tags, showToast])

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const collectionOptions = shopifyCollections.length > 0
    ? shopifyCollections
    : ['Spring 2025 Collection', 'Summer 2025 Collection', 'Fall 2025 Collection', 'Winter 2025 Collection', 'Ponchos', 'Basics', 'Totes', 'Seasonal', 'New Arrivals', 'Best Sellers'].map(t => ({ id: t, title: t }))

  const canGenerate = images.length > 0 && !generating
  const canPush     = !!form && !pushing && !!form.title

  return (
    <>
      <Head>
        <title>HVP Product Listing Generator</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <header className="header">
        <div className="wordmark">Hello Violet Page</div>
        <div className="header-meta">Product Listing Generator · Claude Sonnet 4.6</div>
      </header>

      <div className="container">
        <div className="two-col">

          {/* ══ LEFT ══ */}
          <div>
            <div className="card">
              <div className="card-title">Product Images</div>

              <div
                className={`drop-zone${dragging ? ' drag-over' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files) }}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
              >
                <span className="drop-icon">🌊</span>
                <p><strong>Click to browse</strong> or drag &amp; drop</p>
                <p className="fmt-note">
                  Up to {MAX_IMAGES} photos per listing · JPG, PNG, WebP, GIF · Up to 20 MB each<br />
                  <em>Multiple angles help Claude write more accurate listings</em>
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.psd,.tiff,.tif,.heic,.heif"
                multiple
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files.length) processFiles(e.target.files) }}
              />

              {formatWarn && <div className="format-warn">⚠ {formatWarn}</div>}

              {/* Image grid */}
              {images.length > 0 && (
                <div className="image-grid">
                  {images.map((img, i) => (
                    <div key={i} className="image-thumb">
                      <img src={img.preview} alt={img.name} />
                      {i === 0 && <span className="primary-badge">Primary</span>}
                      <button className="remove-thumb" onClick={() => removeImage(i)} aria-label="Remove">×</button>
                    </div>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <div className="image-thumb add-more" onClick={() => fileInputRef.current?.click()}>
                      <span>+ Add more</span>
                    </div>
                  )}
                </div>
              )}

              {images.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: '.78rem', color: 'var(--muted)', alignSelf: 'center' }}>
                    {images.length} photo{images.length > 1 ? 's' : ''} · drag to reorder coming soon
                  </span>
                  <button className="btn btn-danger" style={{ marginLeft: 'auto' }} onClick={clearImages}>✕ Clear all</button>
                </div>
              )}

              <button className="btn btn-primary" onClick={generate} disabled={!canGenerate}>
                {generating ? '⏳ Analyzing…' : `✦ Generate Listing${images.length > 1 ? ` (${images.length} photos)` : ''}`}
              </button>

              {error && <div className="error-msg">{error}</div>}
            </div>

            {generating && (
              <div className="spinner-wrap">
                <div className="spinner-ring" />
                <p>Claude is analyzing your {images.length > 1 ? `${images.length} photos` : 'image'}…</p>
              </div>
            )}
          </div>

          {/* ══ RIGHT ══ */}
          {form && (
            <div className="card">
              <div className="card-title">Listing Details</div>

              {genMeta && (
                <div className="meta-bar">
                  <span>⏱ {genMeta.time}s</span>
                  <span>🔢 {Number(genMeta.tokens).toLocaleString()} tokens</span>
                  <span>💰 {genMeta.cost}</span>
                </div>
              )}

              <div className="field-group">
                <label>Title</label>
                <input type="text" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="3–5 words, no brand name" />
              </div>

              <div className="field-group">
                <label>Description</label>
                <textarea className="desc" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="HVP brand-voice description…" />
              </div>

              <div className="row-2">
                <div className="field-group">
                  <label>Price (USD)</label>
                  <div className="price-wrap">
                    <span className="currency">$</span>
                    <input type="number" value={form.price} onChange={e => setField('price', e.target.value)} placeholder="32.00" min="0" step="0.01" />
                  </div>
                </div>
                <div className="field-group">
                  <label>Collection</label>
                  <select value={form.collection} onChange={e => { const opt = e.target.options[e.target.selectedIndex]; setForm(p => ({ ...p, collection: opt.text, collectionId: opt.value })) }}>
                    <option value="">— Select —</option>
                    {collectionOptions.map(c => <option key={c.id || c.title} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
              </div>

              <div className="row-2">
                <div className="field-group">
                  <label>Product Type</label>
                  <select value={form.productType} onChange={e => setField('productType', e.target.value)}>
                    <option value="">— Select —</option>
                    {['poncho', 'hoodie', 'toddler-shirt', 'tote', 'seasonal', 'other'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field-group">
                  <label>Age Group</label>
                  <select value={form.ageGroup} onChange={e => setField('ageGroup', e.target.value)}>
                    <option value="">— Select —</option>
                    {['toddler', 'kids', 'adult', 'unisex'].map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div className="field-group">
                <label>Materials</label>
                <input type="text" value={form.materials} onChange={e => setField('materials', e.target.value)} placeholder="e.g. soft felt, 100% cotton…" />
              </div>

              <div className="field-group">
                <label>Special Features</label>
                <input type="text" value={form.features} onChange={e => setField('features', e.target.value)} placeholder="Any visible details…" />
              </div>

              <div className="field-group">
                <label>Tags <span className="label-hint">(click to add/remove · type + Enter)</span></label>
                <div className="tag-editor" onClick={() => document.getElementById('tag-input').focus()}>
                  {tags.map(tag => (
                    <span key={tag} className="tag-chip">
                      {tag}<button type="button" onClick={() => removeTag(tag)}>×</button>
                    </span>
                  ))}
                  <input id="tag-input" type="text" value={tagInput} placeholder="Add tag…"
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) }
                      if (e.key === 'Backspace' && !tagInput && tags.length) removeTag(tags[tags.length - 1])
                    }}
                  />
                </div>
                <div className="tag-suggestions">
                  {ALL_TAGS.filter(t => !tagInput || t.includes(tagInput.toLowerCase())).map(tag => (
                    <button key={tag} type="button" className={`tag-pill${tags.includes(tag) ? ' active' : ''}`} onClick={() => toggleTag(tag)}>{tag}</button>
                  ))}
                </div>
              </div>

              <hr className="form-divider" />

              {shopifyResult ? (
                <div className="success-banner">
                  ✓ Draft product created!{' '}
                  <a href={shopifyResult} target="_blank" rel="noreferrer">View in Shopify Admin →</a>
                </div>
              ) : (
                <button className="btn btn-shopify" onClick={pushToShopify} disabled={!canPush}>
                  {pushing ? '⏳ Creating in Shopify…' : '🛍 Push to Shopify'}
                </button>
              )}

              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn btn-secondary" onClick={saveToHistory}>💾 Save</button>
                <button className="btn btn-secondary" onClick={downloadJson}>⬇ Download JSON</button>
              </div>
            </div>
          )}

        </div>

        {history.length > 0 && (
          <div className="history-section">
            <hr />
            <div className="card-title" style={{ color: '#132F66', fontFamily: "'Trajan Pro','EB Garamond',Georgia,serif", letterSpacing: '.06em', textTransform: 'uppercase', fontSize: '.9rem', marginBottom: 14 }}>
              Saved Listings
            </div>
            <div className="history-grid">
              {history.map(entry => (
                <div key={entry.id} className="history-card" onClick={() => loadFromHistory(entry)}>
                  <div className="h-title" title={entry.listing.title}>{entry.listing.title || 'Untitled'}</div>
                  <div className="h-meta">{[entry.listing.productType, entry.listing.price ? `$${entry.listing.price}` : null, entry.listing.collection].filter(Boolean).join(' · ')}</div>
                  <div className="h-meta">{entry.savedAt}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-danger" style={{ marginTop: 12 }} onClick={() => { if (!confirm('Clear all?')) return; setHistory([]); localStorage.removeItem('hvp_listings') }}>
              Clear history
            </button>
          </div>
        )}
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </>
  )
}
