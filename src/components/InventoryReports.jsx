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
    const printWindow = window.open('', '_blank', 'width=1200,height=850')
    if (!printWindow) {
      onError('يرجى السماح بفتح النوافذ المنبثقة لطباعة التقرير بصيغة PDF.')
      return
    }
    const title = branchId === 'all' ? 'تقرير المخزون الشامل – جميع الفروع' : 'تقرير المخزون التفصيلي – ' + (branches.find(b => b.id === branchId)?.name || 'الفرع المحدد')
    const summaryCards = [
      ['عدد سجلات الأصناف', totals.records], ['إجمالي الكمية', totals.quantity],
      ['جديد', totals.newQuantity], ['مستعمل', totals.usedQuantity],
      ['متاح', totals.available], ['تالف', totals.damaged], ['مفقود', totals.missing]
    ].map(([label,value]) => '<div class="metric"><span>'+escapeHtml(label)+'</span><b>'+n(value).toLocaleString('en-US')+'</b></div>').join('')
    const branchTable = branchId === 'all' ? `
      <h2>ملخص المخزون حسب الفرع</h2>
      <table class="branch-table"><thead><tr><th>الفرع</th><th>عدد سجلات الأصناف</th><th>إجمالي الكمية</th><th>جديد</th><th>مستعمل</th><th>متاح</th><th>تالف</th><th>مفقود</th></tr></thead>
      <tbody>${branchSummaries.map(b => '<tr><td>'+escapeHtml(b.name)+'</td><td>'+b.records+'</td><td>'+b.quantity+'</td><td>'+b.newQuantity+'</td><td>'+b.usedQuantity+'</td><td>'+b.available+'</td><td>'+b.damaged+'</td><td>'+b.missing+'</td></tr>').join('')}</tbody></table>` : ''
    const detailRows = visibleRows.map(row => `
      <tr>
        <td class="photo">${row.image_url ? '<img src="'+escapeHtml(row.image_url)+'" alt="">' : '—'}</td>
        <td>${escapeHtml(row.branch_name)}</td><td>${escapeHtml(row.item_code)}</td>
        <td class="item-name"><b>${escapeHtml(row.item_name)}</b><small>${escapeHtml(row.description)}</small></td>
        <td>${escapeHtml(row.category)}</td><td>${n(row.quantity)}</td><td>${n(row.new_quantity)}</td>
        <td>${n(row.used_quantity)}</td><td>${n(row.damaged_quantity)}</td><td>${n(row.missing_quantity)}</td>
        <td class="available">${row.available}</td><td>${escapeHtml(row.unit)}</td>
        <td class="notes">${escapeHtml(row.notes)}</td><td>${escapeHtml(dateText(row.updated_at))}</td>
      </tr>`).join('')
    printWindow.document.open()
    printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      *{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#172033;margin:0;padding:18px;font-size:10px}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #c49a45;padding-bottom:12px}
      .brand{font-size:11px;font-weight:bold;color:#a27a2c;letter-spacing:1.5px}.header h1{font-size:20px;margin:7px 0}.meta{color:#5d6878;line-height:1.8;text-align:left}
      h2{font-size:14px;margin:18px 0 8px;color:#102849}
      .metrics{display:grid;grid-template-columns:repeat(7,1fr);gap:7px;margin:14px 0}
      .metric{border:1px solid #cbd3df;border-radius:6px;padding:8px;text-align:center}.metric span{display:block;color:#667085;font-size:9px}.metric b{display:block;font-size:17px;margin-top:4px;color:#102849}
      table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #c7ced8;padding:5px 4px;text-align:center;vertical-align:middle;overflow-wrap:anywhere}
      th{background:#102849;color:#fff;font-weight:bold}tbody tr:nth-child(even){background:#f4f6f9}
      .branch-table{font-size:9px}.detail-table{font-size:8px;margin-top:8px}
      .photo{width:48px}.photo img{width:38px;height:38px;object-fit:contain}
      .item-name{text-align:right;min-width:105px}.item-name small{display:block;color:#687385;margin-top:3px;line-height:1.4}
      .notes{min-width:80px;text-align:right}.available{font-weight:bold;color:#17633d}
      .footer{margin-top:12px;padding-top:7px;border-top:1px solid #cbd3df;color:#687385;display:flex;justify-content:space-between}
      @page{size:A3 landscape;margin:9mm}thead{display:table-header-group}tr{break-inside:avoid}img{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @media print{body{padding:0}.header{break-inside:avoid}.metrics{break-inside:avoid}}
    </style></head><body>
      <header class="header"><div><div class="brand">NIS SPORTTRACK · PHYSICAL EDUCATION DEPARTMENT</div><h1>${escapeHtml(title)}</h1><div>تقرير تفصيلي بحالة وكميات الأصناف المسجلة</div></div>
      <div class="meta">تاريخ الطباعة: ${escapeHtml(new Date().toLocaleString('ar-EG'))}<br>عدد السجلات: ${visibleRows.length}<br>نطاق التقرير: ${branchId === 'all' ? 'جميع الفروع' : 'الفرع المحدد'}</div></header>
      <div class="metrics">${summaryCards}</div>${branchTable}
      <h2>كشف تفاصيل الأصناف</h2>
      <table class="detail-table"><thead><tr><th>الصورة</th><th>الفرع</th><th>الكود</th><th>الصنف / الوصف</th><th>التصنيف</th><th>الإجمالي</th><th>جديد</th><th>مستعمل</th><th>تالف</th><th>مفقود</th><th>متاح</th><th>الوحدة</th><th>ملاحظات</th><th>آخر تحديث</th></tr></thead><tbody>${detailRows || '<tr><td colspan="14">لا توجد بيانات</td></tr>'}</tbody></table>
      <div class="footer"><span>NIS SportTrack – Physical Education Department</span><span>هذا التقرير يعكس البيانات المسجلة وقت الطباعة</span></div>
      <script>window.onload=()=>{const imgs=[...document.images];Promise.all(imgs.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve}))).then(()=>{window.focus();window.print()})}</script>
    </body></html>`)
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
