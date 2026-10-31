import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, ClipboardCheck, Camera, CheckCircle2, ChevronRight, Eye, ImagePlus, Plus, RefreshCw, Save, Send, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const n = value => Number(value || 0)
const dateLabel = value => value ? new Date(value).toLocaleDateString('en-GB') : '—'
const statusLabels = {
  draft: 'مسودة', in_progress: 'قيد التنفيذ', submitted: 'تم الإرسال',
  under_review: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', closed: 'مغلق'
}

export default function PeriodicAudits({ profile, branches, isCentral, onNotice, onError }) {
  const [audits, setAudits] = useState([])
  const [selected, setSelected] = useState(null)
  const [auditItems, setAuditItems] = useState([])
  const [branchId, setBranchId] = useState(isCentral ? '' : profile?.branch_id || '')
  const [title, setTitle] = useState('جرد دوري')
  const [auditDate, setAuditDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [savingItem, setSavingItem] = useState('')
  const [photoBusy, setPhotoBusy] = useState('')

  const loadAudits = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('inventory_audits')
      .select('id, branch_id, title, audit_date, status, notes, created_at, submitted_at, reviewed_at, branches!inventory_audits_branch_id_fkey(name)')
      .order('created_at', { ascending: false })
    if (!isCentral) query = query.eq('branch_id', profile.branch_id)
    const { data, error } = await query
    if (error) onError(error.message)
    else setAudits(data || [])
    setLoading(false)
  }, [isCentral, profile?.branch_id, onError])

  useEffect(() => { if (profile?.id) loadAudits() }, [profile?.id, loadAudits])

  async function createAudit(event) {
    event.preventDefault()
    const targetBranch = isCentral ? branchId : profile.branch_id
    if (!targetBranch) { onError('اختر الفرع أولاً.'); return }
    setCreating(true)
    const { data: audit, error: auditError } = await supabase.from('inventory_audits')
      .insert({ branch_id: targetBranch, title: title.trim(), audit_date: auditDate, notes: notes.trim() || null, created_by: profile.id, status: 'in_progress' })
      .select('id').single()
    if (auditError) { onError(auditError.message); setCreating(false); return }
    let allRows = []
    let from = 0
    while (true) {
      const { data, error } = await supabase.from('inventory')
        .select('id, branch_id, equipment_id, quantity, damaged_quantity, missing_quantity, equipment!inventory_equipment_id_fkey(id,name,item_code,unit,photo_url)')
        .eq('branch_id', targetBranch).range(from, from + 499)
      if (error) { onError(error.message); setCreating(false); return }
      allRows = allRows.concat(data || [])
      if (!data || data.length < 500) break
      from += 500
    }
    if (allRows.length) {
      const rows = allRows.map(row => ({
        audit_id: audit.id, inventory_id: row.id, equipment_id: row.equipment_id,
        expected_quantity: n(row.quantity), counted_quantity: null,
        damaged_count: n(row.damaged_quantity), missing_count: n(row.missing_quantity)
      }))
      const { error: rowsError } = await supabase.from('inventory_audit_items').insert(rows)
      if (rowsError) { onError('تم إنشاء جلسة الجرد لكن تعذر تجهيز الأصناف: ' + rowsError.message); setCreating(false); return }
    }
    onNotice('تم إنشاء جلسة الجرد وتجهيز الأصناف المسجلة في الفرع.')
    setTitle('جرد دوري'); setNotes(''); setCreating(false)
    await loadAudits()
    await openAudit(audit.id)
  }

  async function openAudit(id) {
    setLoading(true)
    const { data: header, error: headerError } = await supabase.from('inventory_audits')
      .select('id, branch_id, title, audit_date, status, notes, created_by, branches!inventory_audits_branch_id_fkey(name)')
      .eq('id', id).single()
    if (headerError) { onError(headerError.message); setLoading(false); return }
    const { data: rows, error: rowsError } = await supabase.from('inventory_audit_items')
      .select('id,audit_id,inventory_id,equipment_id,expected_quantity,counted_quantity,damaged_count,missing_count,notes,photo_path,equipment!inventory_audit_items_equipment_id_fkey(name,item_code,unit)')
      .eq('audit_id', id).order('created_at')
    if (rowsError) onError(rowsError.message)
    const hydrated = await Promise.all((rows || []).map(async row => {
      if (!row.photo_path) return { ...row, photo_url: '' }
      const { data } = await supabase.storage.from('nis-sporttrack-evidence').createSignedUrl(row.photo_path, 3600)
      return { ...row, photo_url: data?.signedUrl || '' }
    }))
    setSelected(header)
    setAuditItems(hydrated)
    setLoading(false)
  }

  function patchItem(id, patch) {
    setAuditItems(current => current.map(row => row.id === id ? { ...row, ...patch } : row))
  }

  async function saveAuditItem(row) {
    setSavingItem(row.id)
    const { error } = await supabase.from('inventory_audit_items').update({
      counted_quantity: row.counted_quantity === '' ? null : row.counted_quantity === null ? null : n(row.counted_quantity),
      damaged_count: n(row.damaged_count), missing_count: n(row.missing_count), notes: row.notes || null
    }).eq('id', row.id)
    if (error) onError(error.message)
    else onNotice('تم حفظ نتيجة الجرد للصنف.')
    setSavingItem('')
  }

  async function uploadEvidence(row, file) {
    if (!file) return
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      onError('اختر صورة JPG أو PNG أو WEBP بحجم لا يتجاوز 10 ميجابايت.'); return
    }
    setPhotoBusy(row.id)
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = selected.branch_id + '/audits/' + selected.id + '/' + row.id + '-' + crypto.randomUUID() + '.' + ext
    const { error: uploadError } = await supabase.storage.from('nis-sporttrack-evidence')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (uploadError) { onError(uploadError.message); setPhotoBusy(''); return }
    const { error } = await supabase.from('inventory_audit_items').update({ photo_path: path }).eq('id', row.id)
    if (error) onError(error.message)
    else {
      const { data } = await supabase.storage.from('nis-sporttrack-evidence').createSignedUrl(path, 3600)
      patchItem(row.id, { photo_path: path, photo_url: data?.signedUrl || '' })
      onNotice('تم رفع صورة الإثبات بنجاح.')
    }
    setPhotoBusy('')
  }

  async function changeStatus(status) {
    if (!selected) return
    const payload = { status }
    if (status === 'submitted') payload.submitted_at = new Date().toISOString()
    if (['approved','rejected'].includes(status)) {
      payload.reviewed_by = profile.id
      payload.reviewed_at = new Date().toISOString()
    }
    const { error } = await supabase.from('inventory_audits').update(payload).eq('id', selected.id)
    if (error) onError(error.message)
    else {
      onNotice(status === 'submitted' ? 'تم إرسال الجرد للمراجعة المركزية.' : status === 'approved' ? 'تم اعتماد الجرد. لم يتم تغيير أرصدة المخزون.' : 'تم رفض الجرد.')
      await loadAudits()
      await openAudit(selected.id)
    }
  }

  const editable = selected && ['draft','in_progress','rejected'].includes(selected.status)
  const completeCount = auditItems.filter(row => row.counted_quantity !== null && row.counted_quantity !== '').length
  const discrepancyCount = auditItems.filter(row => row.counted_quantity !== null && n(row.counted_quantity) !== n(row.expected_quantity)).length

  return <section className="panel audit-panel">
    <div className="panel-heading"><div><h3><ClipboardCheck size={20}/> الجرد الدوري</h3><p>جلسات جرد موثقة لكل فرع مع مراجعة واعتماد مركزي</p></div><button className="button button-light" onClick={loadAudits}><RefreshCw size={16}/> تحديث</button></div>
    {!selected ? <>
      <form className="audit-create" onSubmit={createAudit}>
        <div className="audit-form-heading"><div><strong>إنشاء جلسة جرد جديدة</strong><small>سيتم أخذ لقطة بالكميات الحالية عند بدء الجرد.</small></div><CalendarDays size={22}/></div>
        <div className="audit-create-grid">
          {isCentral && <label className="field">الفرع<select required value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">اختر الفرع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          <label className="field">اسم الجرد<input required value={title} onChange={e=>setTitle(e.target.value)}/></label>
          <label className="field">تاريخ الجرد<input required type="date" value={auditDate} onChange={e=>setAuditDate(e.target.value)}/></label>
          <label className="field audit-notes">ملاحظات<textarea rows="2" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="ملاحظات أو نطاق الجرد..."/></label>
        </div>
        <button className="button button-primary" disabled={creating}>{creating ? 'جارٍ تجهيز الجرد...' : <><Plus size={17}/> إنشاء جلسة الجرد</>}</button>
      </form>
      <div className="audit-list-heading"><strong>سجل جلسات الجرد</strong><span>{audits.length} جلسة</span></div>
      <div className="audit-list">
        {loading ? <div className="empty-state">جارٍ تحميل جلسات الجرد...</div> : audits.length === 0 ? <div className="empty-state">لا توجد جلسات جرد حتى الآن.</div> : audits.map(audit=><button className="audit-list-row" key={audit.id} onClick={()=>openAudit(audit.id)}>
          <div className="audit-list-icon"><ClipboardCheck size={19}/></div><div className="audit-list-copy"><strong>{audit.title}</strong><small>{audit.branches?.name || 'الفرع'} • {dateLabel(audit.audit_date)}</small></div><span className={'audit-status status-'+audit.status}>{statusLabels[audit.status] || audit.status}</span><ChevronRight size={17}/>
        </button>)}
      </div>
    </> : <>
      <div className="audit-detail-head"><button className="button button-light" onClick={()=>setSelected(null)}><ChevronRight size={16}/> العودة للجلسات</button><div><h4>{selected.title}</h4><p>{selected.branches?.name} • {dateLabel(selected.audit_date)} • {statusLabels[selected.status]}</p></div></div>
      <div className="audit-metrics"><div><small>الأصناف</small><strong>{auditItems.length}</strong></div><div><small>تم جردها</small><strong>{completeCount}</strong></div><div><small>الفروق</small><strong>{discrepancyCount}</strong></div></div>
      <div className="audit-items">
        {auditItems.map(row=><article className="audit-item" key={row.id}>
          <div className="audit-item-title"><div><strong>{row.equipment?.name || 'صنف'}</strong><small>{row.equipment?.item_code || 'بدون كود'} • المتوقع: {row.expected_quantity} {row.equipment?.unit || ''}</small></div><span className={row.counted_quantity !== null && n(row.counted_quantity)!==n(row.expected_quantity) ? 'difference' : 'no-difference'}>{row.counted_quantity === null ? 'لم يتم الجرد' : (n(row.counted_quantity)-n(row.expected_quantity)>0?'+':'')+(n(row.counted_quantity)-n(row.expected_quantity))}</span></div>
          <div className="audit-item-fields">
            <label className="field">العدد الفعلي<input type="number" min="0" disabled={!editable} value={row.counted_quantity ?? ''} placeholder="أدخل العدد" onChange={e=>patchItem(row.id,{counted_quantity:e.target.value})}/></label>
            <label className="field">التالف<input type="number" min="0" disabled={!editable} value={row.damaged_count} onChange={e=>patchItem(row.id,{damaged_count:e.target.value})}/></label>
            <label className="field">المفقود<input type="number" min="0" disabled={!editable} value={row.missing_count} onChange={e=>patchItem(row.id,{missing_count:e.target.value})}/></label>
            <label className="field audit-item-notes">ملاحظات<input disabled={!editable} value={row.notes || ''} onChange={e=>patchItem(row.id,{notes:e.target.value})} placeholder="سبب الفرق أو حالة الأداة"/></label>
          </div>
          <div className="audit-item-bottom">
            <label className="button button-light audit-photo-button"><ImagePlus size={16}/>{photoBusy===row.id?'جارٍ رفع الصورة...':'إرفاق صورة إثبات'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!editable || photoBusy===row.id} onChange={e=>uploadEvidence(row,e.target.files?.[0])}/></label>
            {row.photo_url && <a href={row.photo_url} target="_blank" rel="noreferrer" className="audit-photo-link"><img src={row.photo_url} alt="صورة إثبات الجرد"/><span><Eye size={14}/> عرض الصورة</span></a>}
            {editable && <button className="button button-primary" disabled={savingItem===row.id} onClick={()=>saveAuditItem(row)}><Save size={15}/>{savingItem===row.id?'حفظ...':'حفظ الصنف'}</button>}
          </div>
        </article>)}
      </div>
      <div className="audit-actions">
        {editable && <button className="button button-primary" disabled={completeCount!==auditItems.length || auditItems.length===0} onClick={()=>changeStatus('submitted')}><Send size={16}/> إرسال للمراجعة المركزية</button>}
        {isCentral && selected.status==='submitted' && <><button className="button button-primary" onClick={()=>changeStatus('approved')}><CheckCircle2 size={16}/> اعتماد الجرد</button><button className="button button-danger" onClick={()=>changeStatus('rejected')}><X size={16}/> رفض وإعادة للمسؤول</button></>}
        {isCentral && selected.status==='approved' && <button className="button button-light" onClick={()=>changeStatus('closed')}>إغلاق الجلسة</button>}
        <small>اعتماد الجرد لا يغيّر أرصدة المخزون تلقائيًا؛ الفروق تُراجع قبل أي تسوية.</small>
      </div>
    </>}
  </section>
}
