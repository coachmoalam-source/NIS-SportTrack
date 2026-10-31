import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, RefreshCw, Search, Package, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'

const n = value => Number(value || 0)

export default function BranchComparison({ branches, onError }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [view, setView] = useState('quantity')

  const load = useCallback(async () => {
    setLoading(true)
    onError('')
    let all = []
    let from = 0
    while (true) {
      const { data, error } = await supabase.from('inventory')
        .select('id, branch_id, equipment_id, quantity, damaged_quantity, missing_quantity, branches!inventory_branch_id_fkey(name), equipment!inventory_equipment_id_fkey(id,name,item_code,unit,categories!equipment_category_id_fkey(name))')
        .order('equipment_id')
        .range(from, from + 499)
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
    setRows(all)
    setLoading(false)
  }, [onError])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => [...new Set(rows.map(r => r.equipment?.categories?.name).filter(Boolean))].sort(), [rows])
  const matrix = useMemo(() => {
    const grouped = new Map()
    rows.forEach(row => {
      const equipment = row.equipment
      if (!equipment) return
      if (!grouped.has(equipment.id)) grouped.set(equipment.id, {
        id: equipment.id, name: equipment.name, code: equipment.item_code || '—',
        category: equipment.categories?.name || '—', unit: equipment.unit || 'قطعة', branches: {}
      })
      grouped.get(equipment.id).branches[row.branch_id] = {
        quantity: n(row.quantity), damaged: n(row.damaged_quantity), missing: n(row.missing_quantity),
        available: Math.max(0, n(row.quantity) - n(row.damaged_quantity) - n(row.missing_quantity))
      }
    })
    const term = search.trim().toLowerCase()
    return [...grouped.values()].filter(item =>
      (category === 'all' || item.category === category) &&
      (!term || [item.name, item.code, item.category].some(v => String(v).toLowerCase().includes(term)))
    ).sort((a,b) => a.name.localeCompare(b.name, 'ar'))
  }, [rows, search, category])

  const branchTotals = useMemo(() => branches.map(branch => {
    const values = rows.filter(r => r.branch_id === branch.id)
    return {
      id: branch.id, name: branch.name, items: values.length,
      quantity: values.reduce((s,r) => s + n(r.quantity), 0),
      available: values.reduce((s,r) => s + Math.max(0,n(r.quantity)-n(r.damaged_quantity)-n(r.missing_quantity)), 0),
      damaged: values.reduce((s,r) => s + n(r.damaged_quantity), 0),
      missing: values.reduce((s,r) => s + n(r.missing_quantity), 0)
    }
  }), [branches, rows])

  const fieldLabel = view === 'quantity' ? 'الإجمالي' : view === 'available' ? 'المتاح' : view === 'damaged' ? 'التالف' : 'المفقود'

  return <section className="panel comparison-panel">
    <div className="panel-heading">
      <div><h3><Building2 size={19}/> مقارنة مخزون الفروع</h3><p>مقارنة الصنف نفسه بين الفروع الخمسة في جدول واحد</p></div>
      <button className="button button-light" onClick={load} disabled={loading}><RefreshCw size={16}/> تحديث</button>
    </div>
    <div className="comparison-summary">
      {branchTotals.map(branch => <div className="comparison-branch-card" key={branch.id}>
        <span>{branch.name}</span><strong>{branch.quantity.toLocaleString('en-US')}</strong>
        <small>إجمالي القطع · متاح {branch.available.toLocaleString('en-US')}</small>
        <div><em>تالف {branch.damaged}</em><em>مفقود {branch.missing}</em></div>
      </div>)}
    </div>
    <div className="comparison-toolbar">
      <label className="search-box"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث باسم الأداة أو الكود..."/></label>
      <label className="select-wrap"><select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">كل التصنيفات</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <div className="comparison-switch">{[['quantity','الإجمالي'],['available','المتاح'],['damaged','التالف'],['missing','المفقود']].map(([key,label])=><button key={key} className={view===key?'active':''} onClick={()=>setView(key)}>{label}</button>)}</div>
    </div>
    <div className="table-wrap comparison-table-wrap">
      <table className="comparison-table">
        <thead><tr><th className="comparison-sticky">الصنف / الكود</th><th>التصنيف</th>{branches.map(b=><th key={b.id}>{b.name}</th>)}<th>الإجمالي</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={branches.length+3} className="empty-state">جاري تحميل المقارنة...</td></tr> :
            matrix.length ? matrix.map(item => {
              const total = branches.reduce((sum,b)=>sum+n(item.branches[b.id]?.[view]),0)
              return <tr key={item.id}>
                <td className="comparison-sticky"><strong>{item.name}</strong><small>{item.code}</small></td>
                <td>{item.category}</td>
                {branches.map(b=><td key={b.id} className="numeric">{item.branches[b.id] ? item.branches[b.id][view].toLocaleString('en-US') : '—'}</td>)}
                <td><strong className="comparison-total">{total.toLocaleString('en-US')}</strong></td>
              </tr>
            }) : <tr><td colSpan={branches.length+3} className="empty-state"><Package size={26}/><strong>لا توجد بيانات للمقارنة</strong><span>ستظهر الأصناف بعد تسجيل مخزونها في الفروع.</span></td></tr>
          }
        </tbody>
        {!loading && matrix.length>0 && <tfoot><tr><th className="comparison-sticky" colSpan="2">إجمالي الفروع</th>{branches.map(b=><th key={b.id}>{branchTotals.find(x=>x.id===b.id)?.[view]?.toLocaleString('en-US') || 0}</th>)}<th>{branchTotals.reduce((s,b)=>s+n(b[view]),0).toLocaleString('en-US')}</th></tr></tfoot>}
      </table>
    </div>
    <div className="comparison-footnote"><AlertTriangle size={15}/> القيم المعروضة حسب السجلات المسجلة، والشرطة (—) تعني عدم وجود سجل لهذا الصنف في الفرع.</div>
    <div className="table-footer"><span>عرض {matrix.length} صنفًا · نوع القيمة: {fieldLabel}</span></div>
  </section>
}
