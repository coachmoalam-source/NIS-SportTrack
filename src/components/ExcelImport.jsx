import { useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './ExcelImport.css'

const FIELD_ALIASES = {
  item_name: ['اسم الصنف', 'اسم الاداه', 'اسم الأداة', 'الصنف', 'الأداة', 'item name', 'item', 'name', 'equipment', 'equipment name'],
  item_code: ['كود الصنف', 'كود', 'الكود', 'item code', 'code', 'sku'],
  category: ['التصنيف', 'الفئة', 'نوع اللعبة', 'category', 'type'],
  quantity: ['الكمية', 'الرصيد', 'الاجمالي', 'إجمالي الكمية', 'quantity', 'qty', 'stock', 'total'],
  damaged_quantity: ['التالف', 'كمية التالف', 'damaged', 'damaged quantity'],
  missing_quantity: ['المفقود', 'كمية المفقود', 'missing', 'missing quantity'],
  unit: ['الوحدة', 'وحدة القياس', 'unit', 'uom'],
  notes: ['ملاحظات', 'الوصف', 'notes', 'description']
}

const normalizeHeader = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/[ىي]/g, 'ي')
  .replace(/[ًٌٍَُِّْـ]/g, '')
  .replace(/[\s_\-]+/g, ' ')

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
    if (!/\.xlsx$/i.test(file.name)) {
      setFileError('حالياً يدعم الاستيراد ملفات Excel بصيغة .xlsx فقط. احفظ ملفك بهذه الصيغة ثم أعد المحاولة.')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setFileError('حجم الملف يتجاوز 15 ميجابايت.')
      return
    }
    setParsing(true)
    try {
      const parsed = await parseWorkbook(file)
      setRows(validateRows(parsed))
    } catch (error) {
      setFileError(error.message || 'تعذر قراءة ملف Excel.')
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
          created += 1
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
        const { error: stockError } = await supabase
          .from('inventory')
          .upsert(stockPayload, { onConflict: 'branch_id,equipment_id' })
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
              notes: 'استيراد Excel - رصيد جديد: ' + row.quantity + '، تالف: ' + row.damaged_quantity + '، مفقود: ' + row.missing_quantity,
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
      onNotice('اكتمل استيراد ملف Excel بنجاح.')
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
          <h3>استيراد المخزون من Excel</h3>
          <p>ارفع ملف الفرع، راجع البيانات والأخطاء، ثم اعتمد تحديث الأرصدة.</p>
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
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} disabled={!canManage || parsing || importing} />
          <Upload size={24} />
          <strong>{parsing ? 'جارٍ قراءة الملف...' : fileName || 'اضغط لاختيار ملف Excel'}</strong>
          <span>صيغة XLSX • حتى 15 ميجابايت • حتى 5,000 صف</span>
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
                <thead><tr><th>صف Excel</th><th>اسم الصنف</th><th>الكود</th><th>التصنيف</th><th>الكمية</th><th>التالف</th><th>المفقود</th><th>النتيجة</th></tr></thead>
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
