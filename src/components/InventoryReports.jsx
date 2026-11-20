import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, Search, FileSpreadsheet, Package, Building2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const n = value => Number(value || 0)
const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"'
const escapeHtml = value => String(value ?? '—').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const dateText = value => value ? new Date(value).toLocaleString('ar-EG') : '—'

export default function InventoryReports({ branches, onError }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [branchId, setBranchId] = useState('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    onError('')
    let all = []
    let from = 0
    while (true) {
      let query = supabase.from('inventory')
        .select('id, branch_id, quantity, new_quantity, used_quantity, damaged_quantity, missing_quantity, notes, updated_at, branches!inventory_branch_id_fkey(name), equipment!inventory_equipment_id_fkey(id,name,description,item_code,photo_url,unit,custom_category,categories!equipment_category_id_fkey(name))')
        .order('updated_at', { ascending: false })
        .range(from, from + 499)
      if (branchId !== 'all') query = query.eq('branch_id', branchId)
      const { data, error } = await query
      if (error) {
        onError(error.message)
        setRows([])
        setLoading(false)
        return
      }
      all = all.concat(data || [])
      if (!data || data.length < 500) break
      from += 500
    }
    const mapped = await Promise.all(all.map(async row => {
      const storedPhoto = row.equipment?.photo_url || ''
      let photoUrl = storedPhoto
      if (storedPhoto.startsWith('storage:')) {
        const { data } = await supabase.storage.from('nis-sporttrack-evidence').createSignedUrl(storedPhoto.slice(8), 3600)
        photoUrl = data?.signedUrl || ''
      }
      return {
        ...row,
        item_name: row.equipment?.name || 'صنف غير معروف',
        item_code: row.equipment?.item_code || '',
        description: row.equipment?.description || '',
        category: row.equipment?.categories?.name || row.equipment?.custom_category || '—',
        branch_name: row.branches?.name || '—',
        unit: row.equipment?.unit || 'قطعة',
        image_url: photoUrl,
        available: Math.max(0, n(row.quantity) - n(row.damaged_quantity) - n(row.missing_quantity))
      }
    }))
    setRows(mapped)
    setLoading(false)
  }, [branchId, onError])

  useEffect(() => { load() }, [load])

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(row => !term || [row.item_name, row.item_code, row.category, row.branch_name, row.description, row.notes].some(v => String(v || '').toLowerCase().includes(term)))
  }, [rows, search])

  const totals = useMemo(() => visibleRows.reduce((acc, row) => {
    acc.records += 1
    acc.quantity += n(row.quantity)
    acc.newQuantity += n(row.new_quantity)
    acc.usedQuantity += n(row.used_quantity)
    acc.damaged += n(row.damaged_quantity)
    acc.missing += n(row.missing_quantity)
    acc.available += row.available
    return acc
  }, { records: 0, quantity: 0, newQuantity: 0, usedQuantity: 0, damaged: 0, missing: 0, available: 0 }), [visibleRows])

  const branchSummaries = useMemo(() => branches
    .filter(branch => branchId === 'all' || branch.id === branchId)
    .map(branch => {
      const list = visibleRows.filter(row => row.branch_id === branch.id)
      return {
        ...branch,
        records: list.length,
        quantity: list.reduce((s,r) => s+n(r.quantity),0),
        newQuantity: list.reduce((s,r) => s+n(r.new_quantity),0),
        usedQuantity: list.reduce((s,r) => s+n(r.used_quantity),0),
        available: list.reduce((s,r) => s+r.available,0),
        damaged: list.reduce((s,r) => s+n(r.damaged_quantity),0),
        missing: list.reduce((s,r) => s+n(r.missing_quantity),0)
      }
    }), [branches, branchId, visibleRows])

  const exportReport = () => {
    const headers = ['الفرع','كود الصنف','اسم الصنف','وصف الصنف','التصنيف','الكمية الإجمالية','جديد','مستعمل','التالف','المفقود','المتاح','الوحدة','ملاحظات','آخر تحديث']
    const lines = visibleRows.map(row => [
      row.branch_name,row.item_code,row.item_name,row.description,row.category,row.quantity,
      row.new_quantity,row.used_quantity,row.damaged_quantity,row.missing_quantity,row.available,row.unit,
      row.notes,row.updated_at ? new Date(row.updated_at).toLocaleString('en-GB') : ''
    ])
    const csv = '\uFEFF' + [headers, ...lines].map(line => line.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = branchId === 'all' ? 'NIS-SportTrack-All-Branches-Full-Report.csv' : 'NIS-SportTrack-Branch-Full-Report.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportPdf = () => {
    const printWindow = window.open('', '_blank', 'width=1100,height=850')
    if (!printWindow) {
      onError('يرجى السماح بفتح النوافذ المنبثقة لطباعة التقرير بصيغة PDF.')
      return
    }
    const title = branchId === 'all' ? 'تقرير المخزون الشامل – جميع الفروع' : 'تقرير المخزون التفصيلي – ' + (branches.find(b => b.id === branchId)?.name || 'الفرع المحدد')
    const metrics = [
      ['عدد سجلات الأصناف', totals.records], ['إجمالي الكمية', totals.quantity],
      ['جديد', totals.newQuantity], ['مستعمل', totals.usedQuantity],
      ['متاح', totals.available], ['تالف', totals.damaged], ['مفقود', totals.missing]
    ].map(([label,value]) => '<div class="metric"><span>'+escapeHtml(label)+'</span><b>'+n(value).toLocaleString('en-US')+'</b></div>').join('')
    const branchSummary = branchId === 'all' ? `
      <section class="summary-section"><h2>ملخص المخزون حسب الفرع</h2>
      <table><thead><tr><th>الفرع</th><th>عدد السجلات</th><th>الإجمالي</th><th>جديد</th><th>مستعمل</th><th>متاح</th><th>تالف</th><th>مفقود</th></tr></thead>
      <tbody>${branchSummaries.map(b => '<tr><td>'+escapeHtml(b.name)+'</td><td>'+b.records+'</td><td>'+b.quantity+'</td><td>'+b.newQuantity+'</td><td>'+b.usedQuantity+'</td><td>'+b.available+'</td><td>'+b.damaged+'</td><td>'+b.missing+'</td></tr>').join('')}</tbody></table></section>` : ''
    const itemCards = visibleRows.map((row,index) => `
      <article class="item-card">
        <div class="item-head">
          <div class="photo">${row.image_url ? '<img src="'+escapeHtml(row.image_url)+'" alt="">' : '<span>بدون صورة</span>'}</div>
          <div class="item-title"><b>${escapeHtml(row.item_name)}</b><small>كود الصنف: ${escapeHtml(row.item_code || '—')} · ${escapeHtml(row.category)}</small></div>
          <div class="item-total"><small>إجمالي الكمية</small><strong>${n(row.quantity)} ${escapeHtml(row.unit)}</strong></div>
        </div>
        <div class="details-grid">
          <div><span>الفرع</span><b>${escapeHtml(row.branch_name)}</b></div>
          <div><span>التصنيف</span><b>${escapeHtml(row.category)}</b></div>
          <div><span>الكمية الجديدة</span><b>${n(row.new_quantity)}</b></div>
          <div><span>الكمية المستعملة</span><b>${n(row.used_quantity)}</b></div>
          <div><span>التالف</span><b>${n(row.damaged_quantity)}</b></div>
          <div><span>المفقود</span><b>${n(row.missing_quantity)}</b></div>
          <div><span>المتاح</span><b class="available">${row.available}</b></div>
          <div><span>الوحدة</span><b>${escapeHtml(row.unit)}</b></div>
        </div>
        <div class="description"><b>وصف الصنف:</b> ${escapeHtml(row.description || 'لا يوجد وصف مسجل')}</div>
        <div class="notes"><b>ملاحظات:</b> ${escapeHtml(row.notes || 'لا توجد ملاحظات')}</div>
        <div class="updated">آخر تحديث: ${escapeHtml(dateText(row.updated_at))}</div>
      </article>`).join('')
    printWindow.document.open()
    printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
      /* Print canvas: let the printer define the usable A4 area; never add a second page margin. */
      *{box-sizing:border-box}
      html,body{margin:0!important;padding:0!important;width:100%!important;min-width:0!important;background:#fff!important}
      body{font-family:Arial,Tahoma,sans-serif;color:#172033;font-size:10pt;line-height:1.35}
      .report{width:100%;max-width:100%;margin:0;padding:0;overflow:visible}
      .header{display:flex;justify-content:space-between;gap:5mm;align-items:flex-start;border-bottom:2px solid #c49a45;padding:0 0 4mm;margin:0 0 4mm;width:100%;min-width:0}
      .header>div:first-child{min-width:0;flex:1}
      .brand{font-size:8pt;font-weight:bold;color:#a27a2c;letter-spacing:.5px}.header h1{font-size:16pt;line-height:1.25;margin:2mm 0}.meta{color:#5d6878;line-height:1.6;text-align:left;white-space:normal;max-width:42%;font-size:8pt}
      h2{font-size:12pt;margin:5mm 0 2mm;color:#102849;break-after:avoid}
      .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2mm;margin:3mm 0;width:100%}
      .metric{border:1px solid #cbd3df;border-radius:2mm;padding:2mm;text-align:center;min-width:0}
      .metric span{display:block;color:#667085;font-size:7.5pt}.metric b{display:block;font-size:12pt;margin-top:1mm;color:#102849}
      table{width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed;font-size:7pt}
      th,td{border:1px solid #c7ced8;padding:1.5mm 1mm;text-align:center;overflow-wrap:anywhere;word-break:normal}
      th{background:#102849!important;color:#fff!important}tbody tr:nth-child(even){background:#f4f6f9!important}
      .summary-section{width:100%;max-width:100%;break-inside:avoid;page-break-inside:avoid}
      .items-heading{margin-top:5mm;padding-top:3mm;border-top:1px solid #d5dce5}
      .item-card{display:block;width:100%;max-width:100%;border:1px solid #bfc9d7;border-radius:2mm;padding:3mm;margin:0 0 3mm;overflow:visible;break-inside:auto;page-break-inside:auto}
      .item-head{display:flex;align-items:center;gap:3mm;border-bottom:1px solid #e1e6ed;padding-bottom:2mm;margin-bottom:2mm;min-width:0;break-inside:avoid;page-break-inside:avoid}
      .photo{width:15mm;height:15mm;flex:0 0 15mm;border:1px solid #e0e5ec;border-radius:1mm;display:flex;align-items:center;justify-content:center;color:#7a8492;font-size:6pt;overflow:hidden}
      .photo img{width:100%;height:100%;object-fit:contain}
      .item-title{flex:1;min-width:0;overflow-wrap:anywhere}.item-title b{font-size:11pt;color:#102849}.item-title small{display:block;color:#667085;margin-top:1mm;font-size:7.5pt;overflow-wrap:anywhere}
      .item-total{text-align:center;border-right:1px solid #e1e6ed;padding-right:3mm;min-width:24mm}.item-total small{display:block;color:#667085;font-size:7pt}.item-total strong{font-size:12pt;color:#102849}
      .details-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1.5mm;width:100%;break-inside:avoid;page-break-inside:avoid}
      .details-grid div{background:#f5f7fa!important;border:1px solid #e3e8ef;border-radius:1mm;padding:1.5mm;min-width:0;overflow-wrap:anywhere}
      .details-grid span{display:block;color:#667085;font-size:7pt;margin-bottom:.5mm}.details-grid b{font-size:8.5pt;overflow-wrap:anywhere}
      .available{color:#17633d}.description,.notes{margin-top:2mm;line-height:1.4;overflow-wrap:anywhere;word-break:normal}.updated{font-size:7pt;color:#687385;margin-top:1.5mm}
      .footer{margin-top:4mm;padding-top:2mm;border-top:1px solid #cbd3df;color:#687385;display:flex;justify-content:space-between;gap:3mm;font-size:7pt}
      @page{size:A4 portrait;margin:8mm}
      thead{display:table-header-group}
      img{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @media print{
        html,body{width:auto!important;height:auto!important;overflow:visible!important}
        body{margin:0!important;padding:0!important}
        .report{width:100%!important;max-width:100%!important;padding:0!important;margin:0!important}
        .header,.metrics,.summary-section{break-inside:avoid;page-break-inside:avoid}
        .item-card{break-inside:auto;page-break-inside:auto}
        .item-head,.details-grid{break-inside:avoid;page-break-inside:avoid}
        *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      }
    </style></head><body><main class="report">
      <header class="header"><div><div class="brand">NIS SPORTTRACK · PHYSICAL EDUCATION DEPARTMENT</div><h1>${escapeHtml(title)}</h1><div>كشف كامل بتفاصيل الأصناف والكميات وحالة المخزون</div></div>
      <div class="meta">تاريخ الطباعة: ${escapeHtml(new Date().toLocaleString('ar-EG'))}<br>عدد السجلات: ${visibleRows.length}<br>النطاق: ${branchId === 'all' ? 'جميع الفروع' : 'الفرع المحدد'}</div></header>
      <div class="metrics">${metrics}</div>${branchSummary}
      <h2 class="items-heading">التفاصيل الكاملة لكل صنف</h2>
      ${itemCards || '<p>لا توجد بيانات مطابقة.</p>'}
      <div class="footer"><span>NIS SportTrack – Physical Education Department</span><span>التقرير يعرض البيانات المسجلة وقت الطباعة</span></div>
      <script>window.onload=()=>{const imgs=[...document.images];Promise.all(imgs.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve}))).then(()=>{window.focus();window.print()})}</script>
    </main></body></html>`)
    printWindow.document.close()
  }

  return <section className="panel reports-panel">
    <div className="panel-heading">
      <div><h3><FileSpreadsheet size={19}/> تقارير المخزون</h3><p>تقرير شامل بتفاصيل الأصناف والكميات وحالة كل فرع، قابل للطباعة والحفظ PDF أو التصدير إلى Excel</p></div>
      <div className="reports-actions">
        <button className="button button-light" onClick={load} disabled={loading}><RefreshCw size={16}/> تحديث</button>
        <button className="button button-light" onClick={exportReport} disabled={loading || !visibleRows.length}><Download size={16}/> Excel / CSV</button>
        <button className="button button-primary" onClick={exportPdf} disabled={loading || !visibleRows.length}><Download size={16}/> طباعة التقرير / PDF</button>
      </div>
    </div>
    <div className="filters reports-filters">
      <label className="search-box"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث في التقرير باسم الصنف أو الكود أو الفرع أو الملاحظات..."/></label>
      <label className="select-wrap"><Building2 size={17}/><select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="all">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    </div>
    <div className="reports-summary-grid">
      {[['عدد السجلات',totals.records],['إجمالي الكمية',totals.quantity],['جديد',totals.newQuantity],['مستعمل',totals.usedQuantity],['المتاح',totals.available],['التالف',totals.damaged],['المفقود',totals.missing]].map(([label,value])=><div className="reports-summary-card" key={label}><span>{label}</span><strong>{value.toLocaleString('en-US')}</strong></div>)}
    </div>
    {branchId === 'all' && <><h4 className="reports-subtitle">ملخص الفروع</h4><div className="reports-branch-grid">
      {branchSummaries.map(branch=><div className="reports-branch-card" key={branch.id}>
        <div><Building2 size={16}/><strong>{branch.name}</strong></div><strong className="reports-branch-quantity">{branch.quantity.toLocaleString('en-US')}</strong>
        <small>إجمالي الكمية · {branch.records} سجل</small>
        <div className="reports-branch-metrics"><span>جديد {branch.newQuantity}</span><span>مستعمل {branch.usedQuantity}</span><span>متاح {branch.available}</span><span>تالف {branch.damaged}</span><span>مفقود {branch.missing}</span></div>
      </div>)}
    </div></>}
    <h4 className="reports-subtitle">تفاصيل المخزون</h4>
    <div className="table-wrap"><table className="reports-table">
      <thead><tr><th>الفرع</th><th>الكود</th><th>اسم الصنف</th><th>الوصف</th><th>التصنيف</th><th>الإجمالي</th><th>جديد</th><th>مستعمل</th><th>التالف</th><th>المفقود</th><th>المتاح</th><th>الوحدة</th><th>ملاحظات</th><th>آخر تحديث</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan="14" className="empty-state">جاري تحميل التقرير...</td></tr> :
        visibleRows.length ? visibleRows.map(row=><tr key={row.id}><td>{row.branch_name}</td><td>{row.item_code || '—'}</td><td><strong>{row.item_name}</strong></td><td>{row.description || '—'}</td><td>{row.category}</td><td className="numeric">{row.quantity} {row.unit}</td><td>{n(row.new_quantity)}</td><td>{n(row.used_quantity)}</td><td>{row.damaged_quantity}</td><td>{row.missing_quantity}</td><td><strong className="available">{row.available}</strong></td><td>{row.unit}</td><td>{row.notes || '—'}</td><td>{row.updated_at ? new Date(row.updated_at).toLocaleDateString('en-GB') : '—'}</td></tr>) :
        <tr><td colSpan="14" className="empty-state"><Package size={26}/><strong>لا توجد بيانات مطابقة</strong></td></tr>}</tbody>
    </table></div>
    <div className="table-footer"><span>{loading ? '...' : 'عدد السجلات المعروضة: ' + visibleRows.length.toLocaleString('en-US')}</span><span>التقرير يعكس السجلات المسجلة حاليًا في قاعدة البيانات.</span></div>
  </section>
}
