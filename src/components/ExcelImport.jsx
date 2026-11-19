import { useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './ExcelImport.css'

// Central synonym dictionary: every source term maps to one canonical inventory field.
// Import headings are resolved from Supabase, not hard-coded in the client.
const normalizeHeader = value => String(value || '')
  .normalize('NFKC')
  .replace(/[\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]/g, '')
  .replace(/[\\u064B-\\u065F\\u0670\\u0640]/g, '')
  .trim()
  .toLowerCase()
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/[ىي]/g, 'ي')
  .replace(/[\\s_\\-]+/g, ' ')

function buildHeaderResolver(aliasRows) {
  const lookup = {}
  for (const row of aliasRows || []) {
    if (!row.is_active || !row.alias || !row.canonical_field) continue
    lookup[normalizeHeader(row.alias)] = row.canonical_field
  }
  return value => {
    const normalized = normalizeHeader(value)
    if (lookup[normalized]) return lookup[normalized]
    const matches = Object.entries(lookup)
      .filter(([alias]) => alias.length >= 3 && normalized.includes(alias))
      .sort((a, b) => b[0].length - a[0].length)
    return matches[0]?.[1] || null
  }
}

async function loadHeaderResolver() {
  const { data, error } = await supabase
    .from('inventory_import_aliases')
    .select('canonical_field, alias, is_active')
    .eq('is_active', true)
  if (error) throw new Error('تعذر تحميل قاموس المصطلحات من قاعدة البيانات: ' + error.message)
  if (!data?.length) throw new Error('قاموس مصطلحات استيراد المخزون فارغ في قاعدة البيانات.')
  return buildHeaderResolver(data)
}

const cellText = cell => {
  const value = cell?.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value.text) return String(value.text).trim()
  return String(cell.text || value).trim()
}

const asInteger = value => {
  if (value === '' || value === null || value === undefined) return null
  const normalized = normalizeDigits(value).replace(/[٬,\s]/g, '').trim()
  if (!/^\d+$/.test(normalized)) return NaN
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : NaN
}

const slugCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 3) || 'BR'

function findHeaderRow(sheet, resolveHeader) {
  const max = Math.min(sheet.rowCount, 10)
  for (let rowNumber = 1; rowNumber <= max; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const rawHeaders = row.values.slice(1).map(value => String(value || '').trim())
    const mapped = rawHeaders.map(header => resolveHeader(header))
    if (mapped.includes('item_name') && mapped.includes('quantity')) {
      return { rowNumber, headers: mapped }
    }
  }
  return null
}

async function parseWorkbook(file, resolveHeader) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('ملف Excel لا يحتوي على ورقة عمل.')
  const header = findHeaderRow(sheet, resolveHeader)
  if (!header) throw new Error('لم أجد صف العناوين. يجب أن يحتوي الملف على عمود «اسم الصنف» وعمود «الكمية».')
  const rows = []
  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const source = sheet.getRow(rowNumber)
    const values = {}
    header.headers.forEach((field, index) => {
      if (!field) return
      const rawHeader = String(source.getCell(index + 1).value || '').trim()
      const value = cellText(source.getCell(index + 1))
      values[field] = value
    })
    if (!Object.values(values).some(value => String(value || '').trim())) continue
    rows.push({
      sourceRow: rowNumber,
      conditionBreakdownProvided: header.headers.some(field => ['new_quantity', 'used_quantity', 'damaged_quantity'].includes(field)),
      item_name: String(values.item_name || '').trim(),
      item_code: String(values.item_code || '').trim(),
      category: String(values.category || '').trim(),
      quantity: asInteger(values.quantity),
      new_quantity: values.new_quantity === undefined || values.new_quantity === '' ? 0 : asInteger(values.new_quantity),
      used_quantity: values.used_quantity === undefined || values.used_quantity === '' ? 0 : asInteger(values.used_quantity),
      damaged_quantity: values.damaged_quantity ? asInteger(values.damaged_quantity) : 0,
      missing_quantity: values.missing_quantity ? asInteger(values.missing_quantity) : 0,
      unit: String(values.unit || 'قطعة').trim() || 'قطعة',
      notes: [
        String(values.notes || '').trim(),
        values.used_tools ? 'الأدوات المستخدمة: ' + String(values.used_tools).trim() : ''
      ].filter(Boolean).join(' | ')
    })
  }
  if (!rows.length) throw new Error('لا توجد صفوف بيانات أسفل العناوين.')
  if (rows.length > 5000) throw new Error('الحد الأقصى للاستيراد في المرة الواحدة هو 5,000 صف.')
  return rows
}


async function parseWordDocument(file, resolveHeader) {
  const arrayBuffer = await file.arrayBuffer()
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer })
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  const tables = [...documentNode.querySelectorAll('table')]
  if (!tables.length) {
    throw new Error('ملف Word لا يحتوي على جدول بيانات واضح. ضع بيانات المخزون في جدول بعناوين مثل «اسم الصنف» و«الكمية».')
  }

  const rows = []
  let tableNumber = 0
  for (const table of tables) {
    tableNumber += 1
    const matrix = [...table.querySelectorAll('tr')].map(row =>
      [...row.querySelectorAll('th, td')].map(cell => cell.textContent.trim())
    )
    let headerIndex = -1
    let headers = []
    for (let index = 0; index < Math.min(matrix.length, 10); index += 1) {
      const mapped = matrix[index].map(value => resolveHeader(value))
      if (mapped.includes('item_name') && mapped.includes('quantity')) {
        headerIndex = index
        headers = mapped
        break
      }
    }
    if (headerIndex < 0) continue

    for (let index = headerIndex + 1; index < matrix.length; index += 1) {
      const values = {}
      headers.forEach((field, columnIndex) => {
        if (!field) return
        const rawHeader = matrix[headerIndex][columnIndex] || ''
        const value = matrix[index][columnIndex] || ''
        values[field] = value
      })
      if (!Object.values(values).some(value => String(value || '').trim())) continue
      rows.push({
        sourceRow: 'WORD-' + tableNumber + '-' + (index + 1),
        conditionBreakdownProvided: headers.some(field => ['new_quantity', 'used_quantity', 'damaged_quantity'].includes(field)),
        item_name: String(values.item_name || '').trim(),
        item_code: String(values.item_code || '').trim(),
        category: String(values.category || '').trim(),
        quantity: asInteger(values.quantity),
        new_quantity: values.new_quantity === undefined || values.new_quantity === '' ? 0 : asInteger(values.new_quantity),
        used_quantity: values.used_quantity === undefined || values.used_quantity === '' ? 0 : asInteger(values.used_quantity),
        damaged_quantity: values.damaged_quantity ? asInteger(values.damaged_quantity) : 0,
        missing_quantity: values.missing_quantity ? asInteger(values.missing_quantity) : 0,
        unit: String(values.unit || 'قطعة').trim() || 'قطعة',
        notes: [
          String(values.notes || '').trim(),
          values.used_tools ? 'الأدوات المستخدمة: ' + String(values.used_tools).trim() : ''
        ].filter(Boolean).join(' | ')
      })
    }
  }

  if (!rows.length) {
    throw new Error('لم أجد جدولاً بعناوين واضحة في ملف Word. يجب أن يحتوي الجدول على «اسم الصنف» و«الكمية».')
  }
  if (rows.length > 5000) throw new Error('الحد الأقصى للاستيراد في المرة الواحدة هو 5,000 صف.')
  return rows
}

const normalizeDigits = value => String(value || '').replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))

function parsePdfQuantity(value) {
  const raw = normalizeDigits(value).trim()
  if (!raw) return null
  const compact = raw.replace(/,/g, '').replace(/\s+/g, '')

  const ratio = compact.match(/^(\d+)[/⁄](\d+)$/)
  if (ratio) {
    const available = Number(ratio[1])
    const total = Number(ratio[2])
    if (total < available) return null
    return { quantity: total, inferredMissing: total - available, detail: '', ratio: true, source: raw }
  }

  const weightedCount = compact.match(/^(\d+(?:\.\d+)?)[x×✖✕*](\d+(?:\.\d+)?)(kg|kgs|lb|lbs)?(?:=(\d+(?:\.\d+)?))?$/i)
  if (weightedCount) {
    const count = Number(weightedCount[1])
    const size = Number(weightedCount[2])
    const unit = weightedCount[3] || ''
    const explicitTotal = weightedCount[4] ? Number(weightedCount[4]) : null
    return {
      quantity: Number.isInteger(explicitTotal) ? explicitTotal : (unit ? count : count * size),
      inferredMissing: 0,
      detail: unit ? String(size) + unit.toLowerCase() : '',
      ratio: false,
      source: raw
    }
  }

  const weightAndCount = compact.match(/^(\d+(?:\.\d+)?)(kg|kgs|lb|lbs)[-–—](\d+(?:\.\d+)?)$/i)
  if (weightAndCount) {
    return {
      quantity: Number(weightAndCount[3]),
      inferredMissing: 0,
      detail: String(Number(weightAndCount[1])) + weightAndCount[2].toLowerCase(),
      ratio: false,
      source: raw
    }
  }

  if (/^\d+$/.test(compact)) {
    return { quantity: Number(compact), inferredMissing: 0, detail: '', ratio: false, source: raw }
  }
  return null
}

function parsePdfCount(value) {
  const raw = normalizeDigits(value).trim()
  if (!raw) return null
  if (/^[-—–]+$/.test(raw)) return 0
  const parsed = parsePdfQuantity(raw)
  return parsed && Number.isInteger(parsed.quantity) ? parsed.quantity : null
}

async function parsePdf(file, resolveHeader) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const lines = []

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo)
    const pageWidth = page.getViewport({ scale: 1 }).width
    const content = await page.getTextContent()
    const grouped = new Map()

    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue
      const y = Math.round(item.transform[5] / 3) * 3
      if (!grouped.has(y)) grouped.set(y, [])
      grouped.get(y).push({ x: item.transform[4], width: item.width || 0, text: item.str.trim() })
    }

    for (const [y, parts] of [...grouped.entries()].sort((a, b) => b[0] - a[0])) {
      const ordered = parts.sort((a, b) => a.x - b.x)
      if (ordered.length) lines.push({ page: pageNo, pageWidth, parts: ordered, text: ordered.map(part => part.text).join('  ').trim() })
    }
  }

  if (!lines.length) {
    throw new Error('لم أتمكن من استخراج نص من ملف PDF. قد يكون الملف ممسوحًا ضوئيًا كصورة ويحتاج OCR.')
  }

  const split = text => text.split(/\s{2,}|\t|\s*\|\s*/).map(value => value.trim()).filter(Boolean)
  let headerIndex = -1
  let headerAnchors = []

  for (let i = 0; i < Math.min(lines.length, 100); i += 1) {
    const headerParts = lines[i].parts.flatMap(part => {
      const directField = resolveHeader(part.text)
      if (directField) return [{ x: part.x + (part.width || 0) / 2, field: directField, label: part.text }]
      // Some PDFs expose an entire table header as one text object (e.g. "Tools Number New Used Damage").
      // Split that object into individual header labels and estimate each label's horizontal position.
      const matches = [...String(part.text).matchAll(/\S+/g)]
      const usableWidth = part.width || String(part.text).length * 5
      return matches.map(match => {
        const token = match[0]
        const field = resolveHeader(token)
        if (!field) return null
        const center = (match.index + token.length / 2) / Math.max(1, String(part.text).length)
        return { x: part.x + usableWidth * center, field, label: token }
      }).filter(Boolean)
    })
    const mapped = headerParts.map(part => part.field)
    if (mapped.includes('item_name') && mapped.includes('quantity')) {
      headerIndex = i
      headerAnchors = headerParts.map(part => ({
        xRatio: part.x / lines[i].pageWidth,
        label: part.label,
        field: part.field
      }))
      break
    }

    const fallbackMapped = split(lines[i].text).map(value => resolveHeader(value))
    if (fallbackMapped.includes('item_name') && fallbackMapped.includes('quantity')) {
      headerIndex = i
      headerAnchors = []
      break
    }
  }

  if (headerIndex < 0) {
    throw new Error('لم أجد صف عناوين واضحًا داخل PDF. يدعم النظام «الصنف» أو «Class Name» لاسم الأداة، و«عدد» أو «Number» أو «Quantity» للكمية.')
  }

  const rows = []
  let lastBaseName = ''
  let pendingItemName = ''

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    const cells = {}

    if (headerAnchors.length) {
      for (const part of line.parts) {
        const xRatio = part.x / line.pageWidth
        let nearest = null
        let nearestDistance = Infinity
        for (const anchor of headerAnchors) {
          const distance = Math.abs(anchor.xRatio - xRatio)
          if (distance < nearestDistance) {
            nearest = anchor
            nearestDistance = distance
          }
        }
        if (!nearest || nearestDistance > 0.16 || !nearest.field) continue
        cells[nearest.field] = cells[nearest.field] ? cells[nearest.field] + ' ' + part.text : part.text
      }
    } else {
      const parts = split(line.text)
      const mappedFields = ['item_name', 'quantity', 'new_quantity', 'used_quantity', 'damaged_quantity', 'missing_quantity', 'notes']
      mappedFields.forEach((field, index) => {
        if (parts[index]) cells[field] = parts[index]
      })
    }

    let itemName = String(cells.item_name || '').trim()
    const quantityRaw = String(cells.quantity || '').trim()
    const notesRaw = String(cells.notes || '').trim()
    if (!itemName && !quantityRaw && !notesRaw) continue

    if (itemName && !quantityRaw) {
      pendingItemName = (pendingItemName + ' ' + itemName).trim()
      continue
    }

    if (pendingItemName) {
      itemName = (pendingItemName + ' ' + itemName).trim()
      pendingItemName = ''
    }

    const parsedQuantity = parsePdfQuantity(quantityRaw)
    if (!itemName && parsedQuantity?.detail && lastBaseName) {
      itemName = lastBaseName + ' (' + parsedQuantity.detail + ')'
    } else if (!itemName && !parsedQuantity?.detail) {
      continue
    }

    if (!itemName) continue
    lastBaseName = itemName

    const explicitMissing = parsePdfCount(cells.missing_quantity)
    const missingQuantity = parsedQuantity?.ratio
      ? (explicitMissing !== null && explicitMissing > 0 ? explicitMissing : parsedQuantity.inferredMissing)
      : (explicitMissing ?? 0)

    const rowNotes = []
    if (notesRaw) rowNotes.push(notesRaw)
    if (parsedQuantity?.ratio) {
      rowNotes.push('العدد في الملف: ' + parsedQuantity.source + '؛ المفقود المحسوب من النسبة: ' + parsedQuantity.inferredMissing)
    }

    rows.push({
      sourceRow: 'PDF-' + line.page + '-' + (i - headerIndex),
      conditionBreakdownProvided: headerAnchors.length > 0
        ? headerAnchors.some(anchor => ['new_quantity', 'used_quantity', 'damaged_quantity'].includes(anchor.field))
        : ['new_quantity', 'used_quantity', 'damaged_quantity'].some(field => cells[field] !== undefined),
      item_name: itemName,
      item_code: String(cells.item_code || '').trim(),
      category: String(cells.category || '').trim(),
      quantity: parsedQuantity?.quantity ?? null,
      new_quantity: parsePdfCount(cells.new_quantity) ?? 0,
      used_quantity: parsePdfCount(cells.used_quantity) ?? 0,
      damaged_quantity: parsePdfCount(cells.damaged_quantity) ?? 0,
      missing_quantity: missingQuantity,
      unit: String(cells.unit || 'قطعة').trim() || 'قطعة',
      notes: rowNotes.join(' | ')
    })
  }

  if (!rows.length) {
    throw new Error('تم العثور على العناوين لكن لم أجد صفوف بيانات قابلة للقراءة. تأكد من وجود اسم أداة وعدد في كل صف.')
  }
  if (rows.length > 5000) throw new Error('الحد الأقصى للاستيراد في المرة الواحدة هو 5,000 صف.')
  return rows
}

function validateRows(rows) {
  const seenCodes = new Set()
  const seenNames = new Set()
  return rows.map(row => {
    const errors = []
    if (!row.item_name) errors.push('اسم الصنف مطلوب')
    if (row.quantity === null || !Number.isInteger(row.quantity) || row.quantity < 0) errors.push('الكمية يجب أن تكون رقماً صحيحاً غير سالب')
    if (!Number.isInteger(row.new_quantity) || row.new_quantity < 0) errors.push('قيمة الجديد غير صحيحة')
    if (!Number.isInteger(row.used_quantity) || row.used_quantity < 0) errors.push('قيمة المستعمل غير صحيحة')
    if (!Number.isInteger(row.damaged_quantity) || row.damaged_quantity < 0) errors.push('قيمة التالف غير صحيحة')
    if (!Number.isInteger(row.missing_quantity) || row.missing_quantity < 0) errors.push('قيمة المفقود غير صحيحة')
    if (Number.isInteger(row.quantity) && row.damaged_quantity + row.missing_quantity > row.quantity) errors.push('التالف والمفقود أكبر من الكمية الإجمالية')
    const duplicateKey = row.item_code ? 'code:' + row.item_code.toLowerCase() : 'name:' + row.item_name.toLowerCase()
    if (row.item_code && seenCodes.has(duplicateKey)) errors.push('كود مكرر داخل الملف')
    if (!row.item_code && row.item_name && seenNames.has(duplicateKey)) errors.push('اسم مكرر داخل الملف بدون كود')
    if (row.item_code) seenCodes.add(duplicateKey)
    else if (row.item_name) seenNames.add(duplicateKey)
    const conditionTotal = row.new_quantity + row.used_quantity + row.damaged_quantity
    if (row.conditionBreakdownProvided && Number.isInteger(row.quantity) && conditionTotal !== row.quantity) {
      errors.push('مجموع الجديد والمستعمل والتالف (' + conditionTotal + ') لا يساوي الإجمالي (' + row.quantity + ')')
    }
    return { ...row, errors }
  })
}

export default function ExcelImport({ profile, branches, isCentral, canManage, onComplete, onError, onNotice }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [branchId, setBranchId] = useState(profile?.branch_id || '')
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState(null)
  const [fileError, setFileError] = useState('')

  const validRows = useMemo(() => rows.filter(row => row.errors.length === 0), [rows])
  const invalidRows = rows.length - validRows.length
  const selectedBranch = branches.find(branch => branch.id === (isCentral ? branchId : profile?.branch_id))

  function reset() {
    setFileName('')
    setRows([])
    setSummary(null)
    setFileError('')
  }

  async function handleFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    reset()
    setFileName(file.name)
    const isExcel = /\.xlsx$/i.test(file.name)
    const isPdf = /\.pdf$/i.test(file.name)
    const isWord = /\.docx$/i.test(file.name)
    if (!isExcel && !isPdf && !isWord) {
      setFileError('صيغة الملف غير مدعومة. اختر Excel بصيغة XLSX أو PDF أو Word بصيغة DOCX. ملفات Word القديمة DOC غير مدعومة حالياً.')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setFileError('حجم الملف يتجاوز 15 ميجابايت.')
      return
    }
    setParsing(true)
    try {
      const resolveHeader = await loadHeaderResolver()
      const parsed = isPdf ? await parsePdf(file, resolveHeader) : isWord ? await parseWordDocument(file, resolveHeader) : await parseWorkbook(file, resolveHeader)
      setRows(validateRows(parsed))
    } catch (error) {
      setFileError(error.message || 'تعذر قراءة الملف.')
    } finally {
      setParsing(false)
      event.target.value = ''
    }
  }

  async function downloadTemplate() {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Inventory')
    sheet.columns = [
      { header: 'اسم الصنف', key: 'item_name', width: 28 },
      { header: 'كود الصنف', key: 'item_code', width: 18 },
      { header: 'التصنيف', key: 'category', width: 20 },
      { header: 'الكمية الإجمالية', key: 'quantity', width: 16 },
      { header: 'الجديد', key: 'new_quantity', width: 14 },
      { header: 'المستعمل', key: 'used_quantity', width: 14 },
      { header: 'التالف', key: 'damaged_quantity', width: 14 },
      { header: 'المفقود', key: 'missing_quantity', width: 14 },
      { header: 'الوحدة', key: 'unit', width: 14 },
      { header: 'ملاحظات', key: 'notes', width: 32 }
    ]
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.autoFilter = 'A1:H1'
    const instructions = workbook.addWorksheet('تعليمات')
    instructions.addRows([
      ['تعليمات استيراد المخزون'],
      ['اسم الصنف والكمية حقول إلزامية.'],
      ['الكود اختياري؛ إذا لم يوجد سيبحث النظام عن الصنف بالاسم، أو ينشئ كوداً داخلياً.'],
      ['التالف + المفقود يجب ألا يتجاوزا الكمية الإجمالية.'],
      ['الاستيراد يحدّث رصيد الصنف في الفرع المحدد إلى الأرقام الموجودة في الملف.'],
      ['لا تكرر الصنف أو الكود في نفس الملف.']
    ])
    instructions.getColumn(1).width = 100
    const buffer = await workbook.xlsx.writeBuffer()
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'NIS-SportTrack-Excel-Template.xlsx'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importRows() {
    if (!canManage) return
    const targetBranchId = isCentral ? branchId : profile?.branch_id
    if (!targetBranchId) {
      setFileError('اختر الفرع قبل بدء الاستيراد.')
      return
    }
    if (!validRows.length) {
      setFileError('لا توجد صفوف سليمة للاستيراد.')
      return
    }
    const confirmed = window.confirm(
      'سيتم استيراد ' + validRows.length + ' صف إلى فرع ' + (selectedBranch?.name || '') +
      '. سيتم تحديث أرصدة الأصناف الموجودة لتطابق الملف. هل تريد المتابعة؟'
    )
    if (!confirmed) return

    setImporting(true)
    setFileError('')
    const failures = []
    let created = 0
    let updated = 0
    let unchanged = 0
    let movementWarnings = 0

    const { data: equipmentRows, error: equipmentLoadError } = await supabase
      .from('equipment')
      .select('id, name, item_code, branch_id, category_id, custom_category, unit')
    if (equipmentLoadError) {
      setImporting(false)
      setFileError('تعذر قراءة سجل الأصناف: ' + equipmentLoadError.message)
      return
    }

    for (const row of validRows) {
      try {
        let equipment = row.item_code
          ? equipmentRows.find(item => String(item.item_code || '').toLowerCase() === row.item_code.toLowerCase())
          : null
        if (!equipment) {
          equipment = equipmentRows.find(item =>
            String(item.name || '').trim().toLowerCase() === row.item_name.toLowerCase() &&
            (!item.branch_id || item.branch_id === targetBranchId)
          )
        }
        if (equipment?.branch_id && equipment.branch_id !== targetBranchId) {
          throw new Error('كود الصنف مستخدم لصنف تابع لفرع آخر.')
        }

        if (!equipment) {
          let categoryId = null
          if (isCentral && row.category) {
            const { data: category, error: categoryError } = await supabase
              .from('categories')
              .upsert({ name: row.category }, { onConflict: 'name', ignoreDuplicates: true })
              .select('id')
              .maybeSingle()
            if (categoryError) throw categoryError
            if (category?.id) categoryId = category.id
            else {
              const { data: existingCategory, error: lookupError } = await supabase
                .from('categories').select('id').eq('name', row.category).single()
              if (lookupError) throw lookupError
              categoryId = existingCategory.id
            }
          }
          const branch = branches.find(item => item.id === targetBranchId)
          const generatedCode = row.item_code || (
            'IMP-' + slugCode(branch?.slug || branch?.name) + '-' +
            Date.now().toString(36).toUpperCase() + '-' + String(row.sourceRow).padStart(4, '0')
          )
          const payload = {
            name: row.item_name,
            item_code: generatedCode,
            description: row.notes || null,
            unit: row.unit,
            category_id: isCentral ? categoryId : null,
            custom_category: isCentral ? null : (row.category || null),
            branch_id: isCentral ? null : targetBranchId
          }
          const { data: createdEquipment, error: createError } = await supabase
            .from('equipment').insert(payload).select('id, name, item_code, branch_id, category_id, custom_category, unit').single()
          if (createError) throw createError
          equipment = createdEquipment
          equipmentRows.push(equipment)
        }

        const { data: oldStock, error: stockReadError } = await supabase
          .from('inventory').select('id, quantity, new_quantity, used_quantity, damaged_quantity, missing_quantity')
          .eq('branch_id', targetBranchId).eq('equipment_id', equipment.id).maybeSingle()
        if (stockReadError) throw stockReadError

        const stockPayload = {
          branch_id: targetBranchId,
          equipment_id: equipment.id,
          quantity: row.quantity,
          new_quantity: row.new_quantity,
          used_quantity: row.used_quantity,
          damaged_quantity: row.damaged_quantity,
          missing_quantity: row.missing_quantity,
          notes: row.notes || null
        }
        // The live schema does not define a unique constraint on (branch_id, equipment_id),
        // so avoid upsert(onConflict) and update by the existing inventory row ID instead.
        let stockError
        if (oldStock?.id) {
          const result = await supabase
            .from('inventory')
            .update({
              quantity: stockPayload.quantity,
              new_quantity: stockPayload.new_quantity,
              used_quantity: stockPayload.used_quantity,
              damaged_quantity: stockPayload.damaged_quantity,
              missing_quantity: stockPayload.missing_quantity,
              notes: stockPayload.notes,
              updated_at: new Date().toISOString()
            })
            .eq('id', oldStock.id)
          stockError = result.error
        } else {
          const result = await supabase
            .from('inventory')
            .insert(stockPayload)
          stockError = result.error
        }
        if (stockError) throw stockError

        const changed = !oldStock ||
          Number(oldStock.quantity) !== row.quantity ||
          Number(oldStock.new_quantity || 0) !== row.new_quantity ||
          Number(oldStock.used_quantity || 0) !== row.used_quantity ||
          Number(oldStock.damaged_quantity) !== row.damaged_quantity ||
          Number(oldStock.missing_quantity) !== row.missing_quantity
        if (changed) {
          if (oldStock) updated += 1
          else created += 1
          const movementQuantity = oldStock
            ? Math.max(1, Math.abs(row.quantity - Number(oldStock.quantity)), Math.abs(row.new_quantity - Number(oldStock.new_quantity || 0)), Math.abs(row.used_quantity - Number(oldStock.used_quantity || 0)), Math.abs(row.damaged_quantity - Number(oldStock.damaged_quantity)), Math.abs(row.missing_quantity - Number(oldStock.missing_quantity)))
            : row.quantity
          if (movementQuantity > 0) {
            const { error: movementError } = await supabase.from('inventory_movements').insert({
              branch_id: targetBranchId,
              equipment_id: equipment.id,
              movement_type: oldStock ? 'adjustment' : 'addition',
              quantity: movementQuantity,
              notes: 'استيراد ملف - إجمالي: ' + row.quantity + '، جديد: ' + row.new_quantity + '، مستعمل: ' + row.used_quantity + '، تالف: ' + row.damaged_quantity + '، مفقود: ' + row.missing_quantity,
              created_by: profile.id
            })
            if (movementError) movementWarnings += 1
          }
        } else {
          unchanged += 1
        }
      } catch (error) {
        failures.push({ row: row.sourceRow, name: row.item_name, message: error.message || 'حدث خطأ غير معروف' })
      }
    }

    setImporting(false)
    setSummary({ total: validRows.length, created, updated, unchanged, failures, movementWarnings })
    if (failures.length === 0) {
      onNotice('اكتمل استيراد الملف بنجاح.')
      if (onComplete) await onComplete()
    } else {
      onError(failures.length + ' صف لم يتم استيراده. راجع تفاصيل الأخطاء أسفل المعاينة.')
      if (onComplete) await onComplete()
    }
  }

  return (
    <section className="excel-import-page" dir="rtl">
      <div className="excel-import-intro">
        <div className="excel-import-icon"><FileSpreadsheet size={25} /></div>
        <div>
          <h3>رفع ملفات المخزون من Excel أو PDF أو Word</h3>
          <p>ارفع الملف من الموبايل أو الكمبيوتر، راجع البيانات والأخطاء، ثم اعتمد تحديث الأرصدة.</p>
        </div>
        <button className="button button-light" type="button" onClick={downloadTemplate}><Download size={16} /> تحميل نموذج Excel</button>
      </div>

      <div className="excel-import-card">
        {isCentral ? (
          <label className="excel-field">
            <span>الفرع المستهدف</span>
            <select value={branchId} onChange={event => setBranchId(event.target.value)}>
              <option value="">اختر الفرع</option>
              {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="excel-branch-fixed"><span>الفرع</span><strong>{selectedBranch?.name || 'الفرع المرتبط بحسابك'}</strong></div>
        )}

        <label className="excel-upload-zone">
          <input type="file" accept=".xlsx,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} disabled={!canManage || parsing || importing} />
          <Upload size={24} />
          <strong>{parsing ? 'جارٍ قراءة الملف...' : fileName || 'اضغط لاختيار ملف Excel أو PDF أو Word'}</strong>
          <span>Excel XLSX • PDF نصي قابل للتحديد • Word DOCX • حتى 15 ميجابايت • حتى 5,000 صف</span>
        </label>

        {fileError && <div className="excel-message error"><AlertCircle size={17} />{fileError}</div>}
        {!canManage && <div className="excel-message error"><AlertCircle size={17} />حسابك يملك صلاحية العرض فقط ولا يمكنه استيراد بيانات.</div>}

        {rows.length > 0 && (
          <>
            <div className="excel-summary-grid">
              <div><span>إجمالي الصفوف</span><strong>{rows.length}</strong></div>
              <div><span>جاهز للاستيراد</span><strong className="good">{validRows.length}</strong></div>
              <div><span>يحتاج مراجعة</span><strong className="bad">{invalidRows}</strong></div>
            </div>
            <div className="excel-preview-heading"><div><h4>معاينة البيانات</h4><p>يتم استيراد الصفوف السليمة فقط.</p></div><button className="button button-light" type="button" onClick={reset}>إلغاء الملف</button></div>
            <div className="excel-table-wrap">
              <table>
                <thead><tr><th>صف المصدر</th><th>اسم الصنف</th><th>الكود</th><th>التصنيف</th><th>الإجمالي</th><th>الجديد</th><th>المستعمل</th><th>التالف</th><th>المفقود</th><th>النتيجة</th></tr></thead>
                <tbody>
                  {rows.slice(0, 150).map(row => (
                    <tr key={row.sourceRow} className={row.errors.length ? 'invalid' : ''}>
                      <td>{row.sourceRow}</td><td>{row.item_name || '—'}</td><td>{row.item_code || 'تلقائي'}</td><td>{row.category || '—'}</td>
                      <td>{Number.isInteger(row.quantity) ? row.quantity : '—'}</td><td>{row.new_quantity}</td><td>{row.used_quantity}</td><td>{row.damaged_quantity}</td><td>{row.missing_quantity}</td>
                      <td>{row.errors.length ? <span className="excel-row-error">{row.errors.join('، ')}</span> : <span className="excel-row-ok">سليم</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 150 && <p className="excel-table-note">المعاينة تعرض أول 150 صفاً فقط، وسيتم فحص واستيراد جميع الصفوف السليمة.</p>}
            </div>
            <div className="excel-import-actions">
              <span>تأكد من اختيار الفرع الصحيح قبل الاعتماد.</span>
              <button className="button button-primary" type="button" onClick={importRows} disabled={importing || parsing || !validRows.length || !(isCentral ? branchId : profile?.branch_id)}>
                {importing ? <><RefreshCw size={16} className="spin" /> جارٍ الاستيراد...</> : <><Upload size={16} /> اعتماد استيراد {validRows.length} صف</>}
              </button>
            </div>
          </>
        )}

        {summary && (
          <div className="excel-result">
            <h4><CheckCircle2 size={18} /> نتيجة الاستيراد</h4>
            <div className="excel-result-stats">
              <span>تمت المعالجة: <strong>{summary.total}</strong></span>
              <span>جديد: <strong>{summary.created}</strong></span>
              <span>محدّث: <strong>{summary.updated}</strong></span>
              <span>بدون تغيير: <strong>{summary.unchanged}</strong></span>
            </div>
            {summary.movementWarnings > 0 && <p className="excel-message error">{summary.movementWarnings} سجل تم تحديثه لكن تعذر تسجيل حركته في سجل الحركات.</p>}
            {summary.failures.length > 0 && (
              <div className="excel-failures"><strong>صفوف لم تكتمل:</strong>{summary.failures.map((failure, index) => <p key={index}>صف {failure.row} — {failure.name}: {failure.message}</p>)}</div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
