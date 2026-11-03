import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, Search, FileSpreadsheet, Package, Building2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const n = value => Number(value || 0)
const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"'

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
        .select('id, branch_id, quantity, damaged_quantity, missing_quantity, updated_at, branches!inventory_branch_id_fkey(name), equipment!inventory_equipment_id_fkey(id,name,item_code,unit,categories!equipment_category_id_fkey(name))')
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
    setRows(all.map(row => ({
      ...row,
      item_name: row.equipment?.name || 'صنف غير معروف',
      item_code: row.equipment?.item_code || '',
      category: row.equipment?.categories?.name || '—',
      branch_name: row.branches?.name || '—',
      unit: row.equipment?.unit || 'قطعة',
      available: Math.max(0, n(row.quantity) - n(row.damaged_quantity) - n(row.missing_quantity))
    })))
    setLoading(false)
  }, [branchId, onError])

  useEffect(() => { load() }, [load])

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(row => !term || [row.item_name, row.item_code, row.category, row.branch_name].some(v => String(v).toLowerCase().includes(term)))
  }, [rows, search])

  const totals = useMemo(() => visibleRows.reduce((acc, row) => {
    acc.records += 1
    acc.quantity += n(row.quantity)
    acc.damaged += n(row.damaged_quantity)
    acc.missing += n(row.missing_quantity)
    acc.available += row.available
    return acc
  }, { records: 0, quantity: 0, damaged: 0, missing: 0, available: 0 }), [visibleRows])

  const branchSummaries = useMemo(() => branches
    .filter(branch => branchId === 'all' || branch.id === branchId)
    .map(branch => {
      const list = visibleRows.filter(row => row.branch_id === branch.id)
      return {
        ...branch,
        records: list.length,
        quantity: list.reduce((s,r) => s+n(r.quantity),0),
        available: list.reduce((s,r) => s+r.available,0),
        damaged: list.reduce((s,r) => s+n(r.damaged_quantity),0),
        missing: list.reduce((s,r) => s+n(r.missing_quantity),0)
      }
    }), [branches, branchId, visibleRows])

  const exportReport = () => {
    const headers = ['الفرع','كود الصنف','اسم الصنف','التصنيف','الكمية الإجمالية','التالف','المفقود','المتاح','الوحدة','آخر تحديث']
    const lines = visibleRows.map(row => [
      row.branch_name,row.item_code,row.item_name,row.category,row.quantity,
      row.damaged_quantity,row.missing_quantity,row.available,row.unit,
      row.updated_at ? new Date(row.updated_at).toLocaleDateString('en-GB') : ''
    ])
    const csv = '\uFEFF' + [headers, ...lines].map(line => line.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = branchId === 'all' ? 'NIS-SportTrack-All-Branches-Report.csv' : 'NIS-SportTrack-Branch-Report.csv'
    link.click()
    URL.revokeObjectURL(url)
  }


  const exportPdf = () => {
    const panel = document.querySelector('.reports-panel')
    if (!panel) return
    const printWindow = window.open('', '_blank', 'width=1100,height=800')
    if (!printWindow) {
      onError('يرجى السماح بفتح النوافذ المنبثقة لطباعة التقرير بصيغة PDF.')
      return
    }
    const title = branchId === 'all' ? 'تقرير مخزون جميع الفروع' : 'تقرير مخزون الفرع'
    printWindow.document.open()
    printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>
      body{font-family:Arial,Tahoma,sans-serif;color:#172033;padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#555}
      .reports-actions,.reports-filters{display:none!important}.reports-summary-grid,.reports-branch-grid{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
      .reports-summary-card,.reports-branch-card{border:1px solid #ccd2dc;padding:10px;min-width:110px;border-radius:6px}
      .reports-summary-card span,.reports-branch-card small{display:block}.reports-summary-card strong{font-size:18px}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:12px}th,td{border:1px solid #bbb;padding:7px;text-align:right}th{background:#edf0f5}
      .table-wrap{overflow:visible}.reports-subtitle{margin-top:18px}@page{size:A4 landscape;margin:12mm}
      tr{break-inside:avoid}thead{display:table-header-group}
    </style></head><body><h1>${title} – NIS SportTrack</h1><p>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')} | عدد السجلات: ${visibleRows.length}</p>${panel.innerHTML}</body></html>`)
    printWindow.document.close()
    printWindow.onload = () => { printWindow.focus(); printWindow.print() }
  }

  return <section className="panel reports-panel">
    <div className="panel-heading">
      <div><h3><FileSpreadsheet size={19}/> تقارير المخزون</h3><p>تقرير تفصيلي وملخص كميات لكل فرع، قابل للتصدير إلى Excel وPDF</p></div>
      <div className="reports-actions">
        <button className="button button-light" onClick={load} disabled={loading}><RefreshCw size={16}/> تحديث</button>
        <button className="button button-light" onClick={exportReport} disabled={loading || !visibleRows.length}><Download size={16}/> Excel / CSV</button><button className="button button-primary" onClick={exportPdf} disabled={loading || !visibleRows.length}><Download size={16}/> PDF / طباعة</button>
      </div>
    </div>
    <div className="filters reports-filters">
      <label className="search-box"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث في التقرير باسم الصنف أو الكود أو الفرع..."/></label>
      <label className="select-wrap"><Building2 size={17}/><select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="all">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    </div>
    <div className="reports-summary-grid">
      {[['عدد السجلات',totals.records],['إجمالي الكمية',totals.quantity],['المتاح',totals.available],['التالف',totals.damaged],['المفقود',totals.missing]].map(([label,value])=><div className="reports-summary-card" key={label}><span>{label}</span><strong>{value.toLocaleString('en-US')}</strong></div>)}
    </div>
    <h4 className="reports-subtitle">ملخص الفروع</h4>
    <div className="reports-branch-grid">
      {branchSummaries.map(branch=><div className="reports-branch-card" key={branch.id}>
        <div><Building2 size={16}/><strong>{branch.name}</strong></div>
        <strong className="reports-branch-quantity">{branch.quantity.toLocaleString('en-US')}</strong>
        <small>إجمالي الكمية</small>
        <div className="reports-branch-metrics"><span>متاح {branch.available}</span><span>تالف {branch.damaged}</span><span>مفقود {branch.missing}</span></div>
      </div>)}
    </div>
    <h4 className="reports-subtitle">تفاصيل المخزون</h4>
    <div className="table-wrap">
      <table className="reports-table">
        <thead><tr><th>الفرع</th><th>كود الصنف</th><th>اسم الصنف</th><th>التصنيف</th><th>الكمية</th><th>التالف</th><th>المفقود</th><th>المتاح</th><th>آخر تحديث</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan="9" className="empty-state">جاري تحميل التقرير...</td></tr> :
            visibleRows.length ? visibleRows.map(row=><tr key={row.id}><td>{row.branch_name}</td><td>{row.item_code || '—'}</td><td><strong>{row.item_name}</strong></td><td>{row.category}</td><td className="numeric">{row.quantity} {row.unit}</td><td>{row.damaged_quantity}</td><td>{row.missing_quantity}</td><td><strong className="available">{row.available}</strong></td><td>{row.updated_at ? new Date(row.updated_at).toLocaleDateString('en-GB') : '—'}</td></tr>) :
              <tr><td colSpan="9" className="empty-state"><Package size={26}/><strong>لا توجد بيانات مطابقة</strong></td></tr>}
        </tbody>
      </table>
    </div>
    <div className="table-footer"><span>{loading ? '...' : 'عدد السجلات المعروضة: ' + visibleRows.length.toLocaleString('en-US')}</span><span>التقرير يعكس السجلات المسجلة حاليًا في قاعدة البيانات.</span></div>
  </section>
}
