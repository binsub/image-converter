import './styles.css'
import { jsPDF } from 'jspdf'

const SIZE_PRESETS = {
  auto: null,
  'phone-portrait': { width: 1080, height: 1920, label: '1080 × 1920' },
  square: { width: 1080, height: 1080, label: '1080 × 1080' },
  'a4-portrait': { width: 1240, height: 1754, label: '1240 × 1754' },
  'a4-landscape': { width: 1754, height: 1240, label: '1754 × 1240' },
  'letter-portrait': { width: 1275, height: 1650, label: '1275 × 1650' },
}

const state = {
  items: [],
}

const refs = {
  input: document.querySelector('#image-input'),
  sizePreset: document.querySelector('#size-preset'),
  layoutMode: document.querySelector('#layout-mode'),
  imageFormat: document.querySelector('#image-format'),
  backgroundColor: document.querySelector('#background-color'),
  customSize: document.querySelector('#custom-size'),
  customWidth: document.querySelector('#custom-width'),
  customHeight: document.querySelector('#custom-height'),
  downloadImage: document.querySelector('#download-image'),
  downloadPdf: document.querySelector('#download-pdf'),
  status: document.querySelector('#status'),
  summary: document.querySelector('#summary'),
  emptyState: document.querySelector('#empty-state'),
  previewList: document.querySelector('#preview-list'),
}

refs.input.addEventListener('change', handleFileSelection)
refs.sizePreset.addEventListener('change', () => {
  updateCustomSizeVisibility()
  render()
})
refs.customWidth.addEventListener('input', render)
refs.customHeight.addEventListener('input', render)
refs.downloadImage.addEventListener('click', downloadMergedImage)
refs.downloadPdf.addEventListener('click', downloadPdf)

updateCustomSizeVisibility()
render()

async function handleFileSelection(event) {
  const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'))

  if (!files.length) {
    return
  }

  setStatus(`Loading ${files.length} photo${files.length > 1 ? 's' : ''}...`)

  try {
    const newItems = await Promise.all(files.map(createImageItem))
    state.items.push(...newItems)
    render()
    setStatus(`Added ${newItems.length} photo${newItems.length > 1 ? 's' : ''}.`)
  } catch (error) {
    console.error(error)
    setStatus('One or more images could not be loaded. Please try again.')
  } finally {
    refs.input.value = ''
  }
}

async function createImageItem(file) {
  const url = URL.createObjectURL(file)

  try {
    const image = await loadImage(url)

    return {
      id: crypto.randomUUID(),
      file,
      url,
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      name: file.name.replace(/\.[^.]+$/, ''),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

function updateCustomSizeVisibility() {
  refs.customSize.classList.toggle('hidden', refs.sizePreset.value !== 'custom')
}

function getTileSize(item) {
  if (refs.sizePreset.value === 'custom') {
    return {
      width: sanitizeDimension(refs.customWidth.value, 1080),
      height: sanitizeDimension(refs.customHeight.value, 1920),
      label: 'custom',
    }
  }

  if (refs.sizePreset.value === 'auto') {
    return {
      width: item.width,
      height: item.height,
      label: `${item.width} × ${item.height}`,
    }
  }

  return SIZE_PRESETS[refs.sizePreset.value]
}

function sanitizeDimension(value, fallback) {
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) && number >= 100 ? number : fallback
}

function render() {
  refs.previewList.innerHTML = ''
  refs.emptyState.hidden = state.items.length > 0

  state.items.forEach((item, index) => {
    const card = document.createElement('article')
    card.className = 'preview-card'
    card.innerHTML = `
      <img src="${item.url}" alt="${escapeHtml(item.file.name)} preview" />
      <div class="preview-meta">
        <div>
          <h3>${escapeHtml(item.file.name)}</h3>
          <p>${item.width} × ${item.height}px</p>
        </div>
        <div class="preview-actions">
          <button type="button" data-action="up" data-id="${item.id}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-action="down" data-id="${item.id}" ${index === state.items.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-action="remove" data-id="${item.id}" class="danger">Remove</button>
        </div>
      </div>
    `

    refs.previewList.append(card)
  })

  refs.previewList.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', handlePreviewAction)
  })

  const sizeLabel = state.items[0] ? getTileSize(state.items[0]).label : 'auto'
  refs.summary.textContent = `${state.items.length} photo${state.items.length === 1 ? '' : 's'} selected · tile size ${sizeLabel}`
}

function handlePreviewAction(event) {
  const { action, id } = event.currentTarget.dataset
  const index = state.items.findIndex((item) => item.id === id)

  if (index === -1) {
    return
  }

  if (action === 'remove') {
    URL.revokeObjectURL(state.items[index].url)
    state.items.splice(index, 1)
  }

  if (action === 'up' && index > 0) {
    ;[state.items[index - 1], state.items[index]] = [state.items[index], state.items[index - 1]]
  }

  if (action === 'down' && index < state.items.length - 1) {
    ;[state.items[index + 1], state.items[index]] = [state.items[index], state.items[index + 1]]
  }

  render()
}

async function downloadMergedImage() {
  if (!state.items.length) {
    setStatus('Please add at least one image before downloading.')
    return
  }

  toggleBusy(true)
  setStatus('Preparing merged image...')

  try {
    const tiles = state.items.map((item) => createTileCanvas(item))
    const mergedCanvas = mergeTiles(tiles)
    const format = refs.imageFormat.value
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
    const quality = format === 'png' ? undefined : 0.92
    const blob = await new Promise((resolve) => mergedCanvas.toBlob(resolve, mimeType, quality))

    if (!blob) {
      throw new Error('Image export failed.')
    }

    triggerDownload(blob, `merged-photos.${format === 'png' ? 'png' : 'jpg'}`)
    setStatus('Merged image downloaded.')
  } catch (error) {
    console.error(error)
    setStatus('The merged image could not be created.')
  } finally {
    toggleBusy(false)
  }
}

async function downloadPdf() {
  if (!state.items.length) {
    setStatus('Please add at least one image before downloading.')
    return
  }

  toggleBusy(true)
  setStatus('Preparing PDF...')

  try {
    const tiles = state.items.map((item) => createTileCanvas(item))
    const firstTile = tiles[0]
    const pdf = new jsPDF({
      unit: 'px',
      format: [firstTile.width, firstTile.height],
      orientation: firstTile.width > firstTile.height ? 'landscape' : 'portrait',
      compress: true,
    })

    tiles.forEach((tile, index) => {
      if (index > 0) {
        pdf.addPage([tile.width, tile.height], tile.width > tile.height ? 'landscape' : 'portrait')
      }

      pdf.addImage(tile.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, tile.width, tile.height)
    })

    pdf.save('merged-photos.pdf')
    setStatus('PDF downloaded.')
  } catch (error) {
    console.error(error)
    setStatus('The PDF could not be created.')
  } finally {
    toggleBusy(false)
  }
}

function createTileCanvas(item) {
  const { width, height } = getTileSize(item)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const background = refs.backgroundColor.value

  canvas.width = width
  canvas.height = height

  context.fillStyle = background
  context.fillRect(0, 0, width, height)

  const padding = Math.max(24, Math.round(Math.min(width, height) * 0.04))
  const targetWidth = width - padding * 2
  const targetHeight = height - padding * 2
  const scale = Math.min(targetWidth / item.width, targetHeight / item.height)
  const drawWidth = item.width * scale
  const drawHeight = item.height * scale
  const offsetX = (width - drawWidth) / 2
  const offsetY = (height - drawHeight) / 2

  context.drawImage(item.image, offsetX, offsetY, drawWidth, drawHeight)

  return canvas
}

function mergeTiles(tiles) {
  const isVertical = refs.layoutMode.value === 'vertical'
  const gap = 24
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  canvas.width = isVertical
    ? Math.max(...tiles.map((tile) => tile.width))
    : tiles.reduce((total, tile) => total + tile.width, 0) + gap * Math.max(tiles.length - 1, 0)
  canvas.height = isVertical
    ? tiles.reduce((total, tile) => total + tile.height, 0) + gap * Math.max(tiles.length - 1, 0)
    : Math.max(...tiles.map((tile) => tile.height))

  context.fillStyle = refs.backgroundColor.value
  context.fillRect(0, 0, canvas.width, canvas.height)

  let cursor = 0

  tiles.forEach((tile, index) => {
    const x = isVertical ? (canvas.width - tile.width) / 2 : cursor
    const y = isVertical ? cursor : (canvas.height - tile.height) / 2
    context.drawImage(tile, x, y)
    cursor += (isVertical ? tile.height : tile.width) + (index === tiles.length - 1 ? 0 : gap)
  })

  return canvas
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function toggleBusy(isBusy) {
  refs.downloadImage.disabled = isBusy
  refs.downloadPdf.disabled = isBusy
  refs.downloadImage.textContent = isBusy ? 'Working...' : 'Download merged image'
  refs.downloadPdf.textContent = isBusy ? 'Working...' : 'Download PDF'
}

function setStatus(message) {
  refs.status.textContent = message
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
