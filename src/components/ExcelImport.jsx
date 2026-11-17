import { useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './ExcelImport.css'

const FIELD_ALIASES = {
  item_name: ['اسم الصنف', 'اسم الاداه', 'اسم الأداة', 'الصنف', 'الأداة', 'item name', 'item', 'name', 'equipment', 'equipment name'],
  item_code: ['كود الصنف', 'كود', 'الكود', 'item code', 'code', 'sku'],
  category: ['التصنيف', 'الفئة', 'نوع اللعبة', 'category', 'type'],
  quantity: ['الكمية', 'الرصيد', 'الاجمالي', 'إجمالي الكمية', 'عدد', 'العدد', 'quantity', 'qty', 'count', 'number', 'stock', 'total'],
  damaged_quantity: ['التالف', 'كمية التالف', 'damaged', 'damaged quantity'],
  missing_quantity: ['المفقود', 'كمية المفقود', 'missing', 'missing quantity'],
  used: ['used'],
  unit: ['الوحدة', 'وحدة القياس', 'unit', 'uom'],
  notes: ['ملاحظات', 'الوصف', 'notes', 'description', 'comment', 'comments']
}

const normalizeHeader = value => String(value || '')
  .normalize('NFKC')
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/[ىي]/g, 'ي')
  .replace(/[ًٌٍَُِّْـ]/g, '')
  .replace(/[\s_\-]+/g, '')

const HEADER_LOOKUP = Object.entries(FIELD_ALIASES).reduce((all, entry) => {
  entry[1].forEach(alias => { all[normalizeHeader(alias)] = entry[0] })
  return all
}, {})

const cellText = cell => {
  const value = cell?.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value.text) return String(value.text).trim()
  return String(cell.text || value).trim()
}

const asInteger = value => {
  if (value === '' || value === null || value === undefined) return null
  const normalized = String(value).replace(/,/g, '').trim()
  if (!/^\d+$/.test(normalized)) return NaN
  return Number(normalized)
}

const slugCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 3) || 'BR'

function findHeaderRow(sheet) {
  const max = Math.min(sheet.rowCount, 10)
  for (let rowNumber = 1; rowNumber <= max; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const headers = row.values.slice(1).map(normalizeHeader)
    const mapped = headers.map(header => HEADER_LOOKUP[header])
    if (mapped.includes('item_name') && mapped.includes('quantity')) {
      return { rowNumber, headers: mapped }
    }
  }
  return null
}

async function parseWorkbook(file) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('ملف Excel لا يحتوي على ورقة عمل.')
  const header = findHeaderRow(sheet)
  if (!header) throw new Error('لم أجد صف العناوين. يجب أن يحتوي الملف على عمود «اسم الصنف» وعمود «الكمية».')
  const rows = []
  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const source = sheet.getRow(rowNumber)
    const values = {}
    header.headers.forEach((field, index) => {
      if (field) values[field] = cellText(source.getCell(index + 1))
    })
    if (!Object.values(values).some(value => String(value || '').trim())) continue
    rows.push({
      sourceRow: rowNumber,
      item_name: String(values.item_name || '').trim(),
      item_code: String(values.item_code || '').trim(),
      category: String(values.category || '').trim(),
      quantity: asInteger(values.quantity),
      damaged_quantity: values.damaged_quantity ? asInteger(values.damaged_quantity) : 0,
      missing_quantity: values.missing_quantity ? asInteger(values.missing_quantity) : 0,
      unit: String(values.unit || 'قطعة').trim() || 'قطعة',
      notes: String(values.notes || '').trim()
    })
  }
  if (!rows.length) throw new Error('لا توجد صفوف بيانات أسفل العناوين.')
  if (rows.length > 5000) throw new Error('الحد الأقصى للاستيراد في المرة الواحدة هو 5,000 صف.')
  return rows
}


async function parseWordDocument(file) {
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
      const mapped = matrix[index].map(value => HEADER_LOOKUP[normalizeHeader(value)])
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
        if (field) values[field] = matrix[index][columnIndex] || ''
      })
      if (!Object.values(values).some(value => String(value || '').trim())) continue
      rows.push({
        sourceRow: 'WORD-' + tableNumber + '-' + (index + 1),
        item_name: String(values.item_name || '').trim(),
        item_code: String(values.item_code || '').trim(),
        category: String(values.category || '').trim(),
        quantity: asInteger(values.quantity),
        damaged_quantity: values.damaged_quantity ? asInteger(values.damaged_quantity) : 0,
        missing_quantity: values.missing_quantity ? asInteger(values.missing_quantity) : 0,
        unit: String(values.unit || 'قطعة').trim() || 'قطعة',
        notes: String(values.notes || '').trim()
      })
    }
  }

  if (!rows.length) {
    throw new Error('لم أجد جدولاً بعناوين واضحة في ملف Word. يجب أن يحتوي الجدول على «اسم الصنف» و«الكمية».')
  }
  if (rows.length > 5000) throw new Error('الحد الأقصى للاستيراد في المرة الواحدة هو 5,000 صف.')
  return rows
}

function mergePdfParts(parts) {
  const sorted = [...parts].sort((a, b) => a.x - b.x)
  const groups = []
  for (const part of sorted) {
    const current = groups[groups.length - 1]
    if (!current || part.x > current.maxX + 10) {
      groups.push({ parts: [part], minX: part.x, maxX: part.x + (part.width || 0) })
    } else {
      current.parts.push(part)
      current.maxX = Math.max(current.maxX, part.x + (part.width || 0))
    }
  }
  return groups.map(group => {
    const rtl = group.parts.some(part => /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(part.text))
    const ordered = [...group.parts].sort((a, b) => rtl ? b.x - a.x : a.x - b.x)
    return {
      text: ordered.map(part => part.text).join(''),
      minX: group.minX,
      maxX: group.maxX,
      center: (group.minX + group.maxX) / 2
    }
  })
}

function pdfCellText(parts) {
  if (!parts?.length) return ''
  const rtl = parts.some(part => /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(part.text))
  return [...parts]
    .sort((a, b) => rtl ? b.x - a.x : a.x - b.x)
    .map(part => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePdfQuantity(raw) {
  const value = String(raw || '')
    .normalize('NFKC')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٬,]/g, '')
    .replace(/\s+/g, '')
    .replace(/[✕✖×]/g, 'x')

  let match = value.match(/^(\d+)x(\d+(?:\.\d+)?)(kg|lb)$/i)
  if (match) return { quantity: Number(match[1]), variant: match[2] + match[3].toLowerCase() }

  match = value.match(/^\d+x\d+=(\d+)$/i)
  if (match) return { quantity: Number(match[1]), variant: '' }

  match = value.match(/^(\d+(?:\.\d+)?)(kg|lb)[\-–—−](\d+)$/i)
  if (match) return { quantity: Number(match[3]), variant: match[1] + match[2].toLowerCase() }

  match = value.match(/^(\d+)\/\d+$/)
  if (match) return { quantity: Number(match[1]), variant: '' }

  if (/^\d+$/.test(value)) return { quantity: Number(value), variant: '' }
  return null
}

async function parsePdf(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  let columns = null
  let headerY = null
  let headerPageNo = null
  const rows = []

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo)
    const content = await page.getTextContent()
    const positionedItems = content.items
      .filter(item => item.str && item.str.trim())
      .map(item => ({
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        text: item.str.trim()
      }))
      .sort((a, b) => b.y - a.y)

    // Group by baseline proximity rather than rounded buckets; PDF fonts often
    // place Arabic labels and adjacent numeric cells a fraction apart.
    const lines = []
    for (const part of positionedItems) {
      const current = lines[lines.length - 1]
      if (!current || Math.abs(part.y - current.y) > 8) {
        lines.push({ y: part.y, parts: [part], yTotal: part.y, count: 1 })
      } else {
        current.parts.push(part)
        current.yTotal += part.y
        current.count += 1
        current.y = current.yTotal / current.count
      }
    }

    if (!columns) {
      const headerCandidate = lines.map(line => ({
        ...line,
        groups: mergePdfParts(line.parts)
      })).find(line => {
        const fields = line.groups.map(group => HEADER_LOOKUP[normalizeHeader(group.text)])
        return fields.includes('item_name') && fields.includes('quantity')
      })

      if (!headerCandidate) continue

      // Arabic and English header labels can sit on slightly different baselines.
      const headerLines = lines.filter(line => Math.abs(line.y - headerCandidate.y) <= 12)
      const headerGroups = mergePdfParts(headerLines.flatMap(line => line.parts))
      columns = headerGroups
        .map(group => ({ ...group, field: HEADER_LOOKUP[normalizeHeader(group.text)] }))
        .filter(group => group.field)
        .sort((a, b) => a.center - b.center)

      if (!columns.some(column => column.field === 'item_name') ||
          !columns.some(column => column.field === 'quantity')) {
        columns = null
        continue
      }
      headerY = Math.min(...headerLines.map(line => line.y))
      headerPageNo = pageNo
    }

    const boundaries = columns.slice(0, -1).map((column, index) => {
      const next = columns[index + 1]
      const midpoint = (column.center + next.center) / 2
      // The item-name cells are wider than their short header label.
      return index === 0 ? Math.max(midpoint, next.minX - 5) : midpoint
    })

    let lastBaseName = ''
    let lastRow = null
    let lastRowY = null
    let pendingName = ''
    let pendingNameY = null

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]
      if (pageNo === headerPageNo && headerY !== null && line.y >= headerY) continue

      const cells = {}
      for (const column of columns) cells[column.field] = []
      for (const part of line.parts) {
        const x = part.x + (part.width || 0) / 2
        let columnIndex = boundaries.findIndex(boundary => x < boundary)
        if (columnIndex < 0) columnIndex = columns.length - 1
        const field = columns[columnIndex].field
        cells[field].push(part)
      }

      const itemName = pdfCellText(cells.item_name)
      const quantityText = pdfCellText(cells.quantity)
      const missingText = pdfCellText(cells.missing_quantity)
      const rawNotes = pdfCellText(cells.notes)
      const notes = /^[—–-]+$/.test(rawNotes) ? '' : rawNotes
      const hasQuantity = quantityText && !/^[—–-]+$/.test(quantityText)

      if (itemName && !hasQuantity) {
        if (lastRow && lastRowY !== null && Math.abs(line.y - lastRowY) <= 55) {
          lastRow.item_name = (lastRow.item_name + ' ' + itemName).trim()
          lastBaseName = lastRow.item_name
          lastRowY = line.y
        } else {
          pendingName = itemName
          pendingNameY = line.y
        }
        if (notes && lastRow && lastRowY !== null && Math.abs(line.y - lastRowY) <= 55) {
          lastRow.notes = [lastRow.notes, notes].filter(Boolean).join(' — ')
        }
        continue
      }

      if (!hasQuantity) {
        if (notes && lastRow && lastRowY !== null && Math.abs(line.y - lastRowY) <= 55) {
          lastRow.notes = [lastRow.notes, notes].filter(Boolean).join(' — ')
          lastRowY = line.y
        }
        continue
      }

      const parsed = parsePdfQuantity(quantityText)
      const pendingIsClose = pendingName && pendingNameY !== null && Math.abs(line.y - pendingNameY) <= 55
      let baseName = itemName || (pendingIsClose ? pendingName : '')
      if (!baseName && parsed?.variant && lastBaseName) baseName = lastBaseName
      if (!baseName) continue

      const itemLabel = parsed?.variant ? baseName + ' ' + parsed.variant : baseName
      const missingValue = missingText && !/^[—–-]+$/.test(missingText)
        ? asInteger(missingText)
        : 0

      const row = {
        sourceRow: 'PDF-' + pageNo + '-' + (lineIndex + 1),
        item_name: itemLabel.trim(),
        item_code: '',
        category: '',
        quantity: parsed ? parsed.quantity : NaN,
        damaged_quantity: 0,
        missing_quantity: missingValue === null ? 0 : missingValue,
        unit: 'قطعة',
        notes
      }
      rows.push(row)
      lastRow = row
      lastRowY = line.y
      lastBaseName = itemName || (pendingIsClose ? pendingName : lastBaseName)
      pendingName = ''
      pendingNameY = null
    }
  }

  if (!columns) {
    throw new Error('لم أتعرف على عناوين جدول PDF. استخدم أعمدة «الصنف» و«عدد» أو «اسم الصنف» و«الكمية».')
  }
  if (!rows.length) {
    throw new Error('تعرفت على عناوين PDF لكن لم أجد صفوف بيانات قابلة للقراءة. تأكد أن كل صنف أمامه عدد واضح.')
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
    if (!Number.isInteger(row.damaged_quantity) || row.damaged_quantity < 0) errors.push('قيمة التالف غير صحيحة')
    if (!Number.isInteger(row.missing_quantity) || row.missing_quantity < 0) errors.push('قيمة المفقود غير صحيحة')
    if (Number.isInteger(row.quantity) && row.damaged_quantity + row.missing_quantity > row.quantity) errors.push('التالف والمفقود أكبر من الكمية الإجمالية')
    const duplicateKey = row.item_code ? 'code:' + row.item_code.toLowerCase() : 'name:' + row.item_name.toLowerCase()
    if (row.item_code && seenCodes.has(duplicateKey)) errors.push('كود مكرر داخل الملف')
    if (!row.item_code && row.item_name && seenNames.has(duplicateKey)) errors.push('اسم مكرر داخل الملف بدون كود')
    if (row.item_code) seenCodes.add(duplicateKey)
    else if (row.item_name) seenNames.add(duplicateKey)
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
      const parsed = isPdf ? await parsePdf(file) : isWord ? await parseWordDocument(file) : await parseWorkbook(file)
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
      { header: 'الكمية', key: 'quantity', width: 14 },
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
          .from('inventory').select('id, quantity, damaged_quantity, missing_quantity')
          .eq('branch_id', targetBranchId).eq('equipment_id', equipment.id).maybeSingle()
        if (stockReadError) throw stockReadError

        const stockPayload = {
          branch_id: targetBranchId,
          equipment_id: equipment.id,
          quantity: row.quantity,
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
          Number(oldStock.damaged_quantity) !== row.damaged_quantity ||
          Number(oldStock.missing_quantity) !== row.missing_quantity
        if (changed) {
          if (oldStock) updated += 1
          else created += 1
          const movementQuantity = oldStock
            ? Math.max(1, Math.abs(row.quantity - Number(oldStock.quantity)), Math.abs(row.damaged_quantity - Number(oldStock.damaged_quantity)), Math.abs(row.missing_quantity - Number(oldStock.missing_quantity)))
            : row.quantity
          if (movementQuantity > 0) {
            const { error: movementError } = await supabase.from('inventory_movements').insert({
              branch_id: targetBranchId,
              equipment_id: equipment.id,
              movement_type: oldStock ? 'adjustment' : 'addition',
              quantity: movementQuantity,
              notes: 'استيراد ملف - رصيد جديد: ' + row.quantity + '، تالف: ' + row.damaged_quantity + '، مفقود: ' + row.missing_quantity,
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
                <thead><tr><th>صف المصدر</th><th>اسم الصنف</th><th>الكود</th><th>التصنيف</th><th>الكمية</th><th>التالف</th><th>المفقود</th><th>النتيجة</th></tr></thead>
                <tbody>
                  {rows.slice(0, 150).map(row => (
                    <tr key={row.sourceRow} className={row.errors.length ? 'invalid' : ''}>
                      <td>{row.sourceRow}</td><td>{row.item_name || '—'}</td><td>{row.item_code || 'تلقائي'}</td><td>{row.category || '—'}</td>
                      <td>{Number.isInteger(row.quantity) ? row.quantity : '—'}</td><td>{row.damaged_quantity}</td><td>{row.missing_quantity}</td>
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
