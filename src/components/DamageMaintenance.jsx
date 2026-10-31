import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Wrench, RefreshCw, Plus, ImagePlus, Eye, CheckCircle2, Clock3, XCircle, Save } from 'lucide-react'
import { supabase } from '../lib/supabase'

const labels = {
  pending: 'جديد', reviewed: 'تمت المراجعة', resolved: 'تم الحل', rejected: 'مرفوض',
  in_progress: 'قيد التنفيذ', completed: 'مكتمل'
}
const dateLabel = value => value ? new Date(value).toLocaleDateString('en-GB') : '—'
const n = value => Number(value || 0)

export default function DamageMaintenance({ profile, branches, isCentral, onNotice, onError }) {
  const [section, setSection] = useState('damage')
  const [branchId, setBranchId] = useState(profile?.branch_id || '')
  const [equipment, setEquipment] = useState([])
  const [damageRows, setDamageRows] = useState([])
  const [maintenanceRows, setMaintenanceRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [damageForm, setDamageForm] = useState({ equipment_id: '', report_type: 'damaged', quantity: 1, description: '' })
  const [maintenanceForm, setMaintenanceForm] = useState({ equipment_id: '', description: '' })
  const [damagePhoto, setDamagePhoto] = useState(null)
  const [maintenancePhoto, setMaintenancePhoto] = useState(null)

  const targetBranch = isCentral ? branchId : profile?.branch_id

  const signedPhoto = async value => {
    if (!value) return ''
    if (!value.startsWith('storage:')) return value
    const { data } = await supabase.storage.from('nis-sporttrack-evidence').createSignedUrl(value.slice(8), 3600)
    return data?.signedUrl || ''
  }

  const loadData = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    const [damageResult, maintenanceResult, stockResult] = await Promise.all([
      (() => { let q = supabase.from('damage_reports').select('id,branch_id,equipment_id,report_type,quantity,description,photo_url,status,created_at,reported_by,equipment!damage_reports_equipment_id_fkey(name,item_code,unit),branches!damage_reports_branch_id_fkey(name)').order('created_at',{ascending:false}); if (!isCentral) q=q.eq('branch_id',profile.branch_id); else if (branchId) q=q.eq('branch_id',branchId); return q })(),
      (() => { let q = supabase.from('maintenance_requests').select('id,branch_id,equipment_id,description,photo_url,status,created_at,requested_by,equipment!maintenance_requests_equipment_id_fkey(name,item_code,unit),branches!maintenance_requests_branch_id_fkey(name)').order('created_at',{ascending:false}); if (!isCentral) q=q.eq('branch_id',profile.branch_id); else if (branchId) q=q.eq('branch_id',branchId); return q })(),
      (() => { let q = supabase.from('inventory').select('equipment_id,equipment!inventory_equipment_id_fkey(id,name,item_code,unit)').order('updated_at',{ascending:false}); if (!isCentral) q=q.eq('branch_id',profile.branch_id); else if (branchId) q=q.eq('branch_id',branchId); return q })()
    ])()
    if (damageResult.error) onError(damageResult.error.message)
    if (maintenanceResult.error) onError(maintenanceResult.error.message)
    if (stockResult.error) onError(stockResult.error.message)
    const hydrate = async rows => Promise.all((rows || []).map(async row => ({ ...row, photo_display: await signedPhoto(row.photo_url) })))
    setDamageRows(await hydrate(damageResult.data))
    setMaintenanceRows(await hydrate(maintenanceResult.data))
    const unique = new Map()
    ;(stockResult.data || []).forEach(row => { if (row.equipment) unique.set(row.equipment_id, row.equipment) })
    setEquipment([...unique.values()])
    setLoading(false)
  }, [profile?.id, profile?.branch_id, isCentral, branchId, onError])

  useEffect(() => { loadData() }, [loadData])

  async function uploadPhoto(file, kind, rowId, branch) {
    if (!file) return null
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('اختر صورة JPG أو PNG أو WEBP بحجم لا يتجاوز 10 ميجابايت.')
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = branch + '/' + kind + '/' + rowId + '/' + crypto.randomUUID() + '.' + ext
    const { error } = await supabase.storage.from('nis-sporttrack-evidence').upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw error
    return 'storage:' + path
  }

  async function createDamage(event) {
    event.preventDefault()
    if (!targetBranch || !damageForm.equipment_id) { onError('اختر الأداة أولاً.'); return }
    setSaving(true)
    const { data, error } = await supabase.from('damage_reports').insert({
      branch_id: targetBranch, equipment_id: damageForm.equipment_id, report_type: damageForm.report_type,
      quantity: n(damageForm.quantity), description: damageForm.description.trim() || null,
      status: 'pending', reported_by: profile.id
    }).select('id').single()
    if (error) onError(error.message)
    else {
      try {
        const photo = await uploadPhoto(damagePhoto, 'damage', data.id, targetBranch)
        if (photo) {
          const { error: updateError } = await supabase.from('damage_reports').update({ photo_url: photo }).eq('id', data.id)
          if (updateError) throw updateError
        }
        onNotice('تم تسجيل بلاغ التالف/المفقود بنجاح.')
        setDamageForm({ equipment_id: '', report_type: 'damaged', quantity: 1, description: '' })
        setDamagePhoto(null)
        await loadData()
      } catch (uploadError) { onError('تم تسجيل البلاغ، لكن تعذر حفظ الصورة: ' + uploadError.message); await loadData() }
    }
    setSaving(false)
  }

  async function createMaintenance(event) {
    event.preventDefault()
    if (!targetBranch || !maintenanceForm.description.trim()) { onError('اكتب وصف العطل أو الصيانة المطلوبة.'); return }
    setSaving(true)
    const { data, error } = await supabase.from('maintenance_requests').insert({
      branch_id: targetBranch, equipment_id: maintenanceForm.equipment_id || null,
      description: maintenanceForm.description.trim(), status: 'pending', requested_by: profile.id
    }).select('id').single()
    if (error) onError(error.message)
    else {
      try {
        const photo = await uploadPhoto(maintenancePhoto, 'maintenance', data.id, targetBranch)
        if (photo) {
          const { error: updateError } = await supabase.from('maintenance_requests').update({ photo_url: photo }).eq('id', data.id)
          if (updateError) throw updateError
        }
        onNotice('تم إرسال طلب الصيانة بنجاح.')
        setMaintenanceForm({ equipment_id: '', description: '' })
        setMaintenancePhoto(null)
        await loadData()
      } catch (uploadError) { onError('تم تسجيل الطلب، لكن تعذر حفظ الصورة: ' + uploadError.message); await loadData() }
    }
    setSaving(false)
  }

  async function updateStatus(kind, id, status) {
    setBusyId(id)
    const table = kind === 'damage' ? 'damage_reports' : 'maintenance_requests'
    const { error } = await supabase.from(table).update({ status }).eq('id', id)
    if (error) onError(error.message)
    else { onNotice('تم تحديث حالة الطلب.'); await loadData() }
    setBusyId('')
  }

  const rows = section === 'damage' ? damageRows : maintenanceRows
  const counts = useMemo(() => ({
    pending: rows.filter(r => r.status === 'pending').length,
    active: rows.filter(r => ['reviewed','in_progress'].includes(r.status)).length,
    done: rows.filter(r => ['resolved','completed'].includes(r.status)).length
  }), [rows])

  return <section className="panel service-panel">
    <div className="panel-heading"><div><h3><Wrench size={20}/> الصيانة والتالف والمفقود</h3><p>تسجيل البلاغات وطلبات الصيانة ومتابعة الإجراء مركزيًا</p></div><button className="button button-light" onClick={loadData}><RefreshCw size={16}/> تحديث</button></div>
    {isCentral && <label className="field service-branch">تصفية حسب الفرع<select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
    <div className="service-tabs">
      <button className={section==='damage'?'active':''} onClick={()=>setSection('damage')}><AlertTriangle size={17}/> بلاغ تالف / مفقود</button>
      <button className={section==='maintenance'?'active':''} onClick={()=>setSection('maintenance')}><Wrench size={17}/> طلب صيانة</button>
    </div>
    {!isCentral && <form className="service-create" onSubmit={section==='damage'?createDamage:createMaintenance}>
      <strong>{section==='damage'?'تسجيل بلاغ جديد':'إرسال طلب صيانة جديد'}</strong>
      {section==='damage' ? <>
        <div className="service-form-grid">
          <label className="field">الأداة<select required value={damageForm.equipment_id} onChange={e=>setDamageForm({...damageForm,equipment_id:e.target.value})}><option value="">اختر الأداة</option>{equipment.map(e=><option key={e.id} value={e.id}>{e.name} {e.item_code?'• '+e.item_code:''}</option>)}</select></label>
          <label className="field">نوع البلاغ<select value={damageForm.report_type} onChange={e=>setDamageForm({...damageForm,report_type:e.target.value})}><option value="damaged">تالف</option><option value="missing">مفقود</option></select></label>
          <label className="field">الكمية<input type="number" min="1" required value={damageForm.quantity} onChange={e=>setDamageForm({...damageForm,quantity:e.target.value})}/></label>
          <label className="field">وصف / تفاصيل<input value={damageForm.description} onChange={e=>setDamageForm({...damageForm,description:e.target.value})} placeholder="وصف حالة الأداة أو سبب الفقد"/></label>
        </div>
        <label className="field service-photo"><ImagePlus size={16}/> صورة من الجهاز<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setDamagePhoto(e.target.files?.[0]||null)}/></label>
      </> : <>
        <div className="service-form-grid">
          <label className="field">الأداة (اختياري)<select value={maintenanceForm.equipment_id} onChange={e=>setMaintenanceForm({...maintenanceForm,equipment_id:e.target.value})}><option value="">مرفق / ملعب / أخرى</option>{equipment.map(e=><option key={e.id} value={e.id}>{e.name} {e.item_code?'• '+e.item_code:''}</option>)}</select></label>
          <label className="field">وصف العطل أو الصيانة المطلوبة<input required value={maintenanceForm.description} onChange={e=>setMaintenanceForm({...maintenanceForm,description:e.target.value})} placeholder="اكتب تفاصيل المشكلة"/></label>
        </div>
        <label className="field service-photo"><ImagePlus size={16}/> صورة توضيحية من الجهاز<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setMaintenancePhoto(e.target.files?.[0]||null)}/></label>
      </>}
      <button className="button button-primary" disabled={saving}><Plus size={16}/>{saving?'جارٍ الإرسال...':'إرسال الطلب'}</button>
      <small className="field-hint">الصور JPG أو PNG أو WEBP وبحد أقصى 10 ميجابايت.</small>
    </form>}
    <div className="service-metrics"><div><small>طلبات جديدة</small><strong>{counts.pending}</strong></div><div><small>قيد الإجراء</small><strong>{counts.active}</strong></div><div><small>تم الحل</small><strong>{counts.done}</strong></div></div>
    <div className="service-list">
      {loading ? <div className="empty-state">جارٍ تحميل الطلبات...</div> : rows.length===0 ? <div className="empty-state">لا توجد طلبات مسجلة في هذا القسم.</div> : rows.map(row=><article className="service-row" key={row.id}>
        <div className="service-row-main"><div><strong>{section==='damage'?(row.report_type==='damaged'?'بلاغ تالف':'بلاغ مفقود'):'طلب صيانة'} — {row.equipment?.name||'مرفق / ملعب / أخرى'}</strong><small>{row.branches?.name||'الفرع'} • {dateLabel(row.created_at)} {row.equipment?.item_code?'• '+row.equipment.item_code:''}</small><p>{section==='damage'?'الكمية: '+row.quantity+' '+(row.equipment?.unit||'قطعة')+' — ':''}{row.description||'لا توجد تفاصيل إضافية'}</p></div><span className={'audit-status status-'+row.status}>{labels[row.status]||row.status}</span></div>
        <div className="service-row-bottom">
          {row.photo_display && <a className="audit-photo-link" href={row.photo_display} target="_blank" rel="noreferrer"><img src={row.photo_display} alt="صورة مرفقة"/><span><Eye size={14}/> عرض الصورة</span></a>}
          {isCentral && <div className="service-status-actions">
            {section==='damage' ? <>
              {row.status==='pending' && <button className="button button-light" disabled={busyId===row.id} onClick={()=>updateStatus('damage',row.id,'reviewed')}><Clock3 size={15}/> تمت المراجعة</button>}
              {['pending','reviewed'].includes(row.status) && <button className="button button-primary" disabled={busyId===row.id} onClick={()=>updateStatus('damage',row.id,'resolved')}><CheckCircle2 size={15}/> تم الحل</button>}
            </> : <>
              {row.status==='pending' && <button className="button button-light" disabled={busyId===row.id} onClick={()=>updateStatus('maintenance',row.id,'in_progress')}><Clock3 size={15}/> بدء الصيانة</button>}
              {['pending','in_progress'].includes(row.status) && <button className="button button-primary" disabled={busyId===row.id} onClick={()=>updateStatus('maintenance',row.id,'completed')}><CheckCircle2 size={15}/> مكتمل</button>}
            </>}
            {!['resolved','completed','rejected'].includes(row.status) && <button className="button button-danger" disabled={busyId===row.id} onClick={()=>updateStatus(section,row.id,'rejected')}><XCircle size={15}/> رفض</button>}
          </div>}
        </div>
      </article>)}
    </div>
  </section>
}
