import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes,
  Building2, CheckCircle2, ChevronDown, CircleUserRound, ClipboardList,
  LogOut, Package, Plus, RefreshCw, Search, ShieldCheck, Trash2, X
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const BRANCHES = ['El Shorouk', 'O West', 'New Capital', 'El Tagamoa', 'Porto Said']
const emptyForm = { item_code: '', item_name: '', category: '', quantity: 0, damaged_quantity: 0, missing_quantity: 0, unit: 'قطعة', image_url: '', notes: '' }
const number = value => Number(value || 0)
const formatDate = value => value ? new Date(value).toLocaleDateString('en-GB') : '—'

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [branches, setBranches] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const isCentral = profile?.role === 'central_admin'
  const canManage = isCentral || profile?.role === 'branch_admin'
  const ownBranchId = profile?.branch_id

  const loadData = useCallback(async (activeSession = session) => {
    if (!activeSession || !supabase) return
    setLoading(true)
    setError('')
    const [profileResult, branchResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role, branch_id').eq('id', activeSession.user.id).single(),
      supabase.from('branches').select('id, name').order('name')
    ])
    if (profileResult.error) {
      setError('لم يتم العثور على ملف المستخدم. راجع جدول profiles وصلاحية المستخدم في قاعدة البيانات.')
      setLoading(false)
      return
    }
    if (branchResult.error) setError(branchResult.error.message)
    setProfile(profileResult.data)
    setBranches(branchResult.data || [])
    let query = supabase.from('inventory_items')
      .select('id, branch_id, item_code, item_name, category, quantity, damaged_quantity, missing_quantity, unit, image_url, notes, updated_at, branches(name)')
      .order('item_name')
    if (profileResult.data.role !== 'central_admin') {
      if (!profileResult.data.branch_id) {
        setItems([])
        setError('حسابك غير مرتبط بفرع. اطلب من مسؤول النظام تحديد branch_id في جدول profiles.')
        setLoading(false)
        return
      }
      query = query.eq('branch_id', profileResult.data.branch_id)
    }
    const { data, error: itemsError } = await query
    if (itemsError) setError(itemsError.message)
    setItems(data || [])
    setLoading(false)
  }, [session])

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadData(data.session)
      else setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession) loadData(nextSession)
      else { setProfile(null); setItems([]); setLoading(false) }
    })
    return () => listener.subscription.unsubscribe()
  }, [loadData])

  const filteredItems = useMemo(() => items.filter(item => {
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || [item.item_name, item.item_code, item.category, item.branches?.name]
      .some(value => String(value || '').toLowerCase().includes(term))
    const matchesBranch = branchFilter === 'all' || item.branch_id === branchFilter
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter
    return matchesSearch && matchesBranch && matchesCategory
  }), [items, search, branchFilter, categoryFilter])

  const totals = useMemo(() => filteredItems.reduce((acc, item) => {
    acc.items += 1
    acc.quantity += number(item.quantity)
    acc.damaged += number(item.damaged_quantity)
    acc.missing += number(item.missing_quantity)
    acc.available += Math.max(0, number(item.quantity) - number(item.damaged_quantity) - number(item.missing_quantity))
    return acc
  }, { items: 0, quantity: 0, damaged: 0, missing: 0, available: 0 }), [filteredItems])

  const categories = [...new Set(items.map(item => item.category).filter(Boolean))]

  async function signIn(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) { setError(signInError.message); setLoading(false) }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(item) {
    setEditing(item)
    setForm({
      item_code: item.item_code || '', item_name: item.item_name || '', category: item.category || '',
      quantity: number(item.quantity), damaged_quantity: number(item.damaged_quantity),
      missing_quantity: number(item.missing_quantity), unit: item.unit || 'قطعة',
      image_url: item.image_url || '', notes: item.notes || ''
    })
    setModalOpen(true)
  }

  async function saveItem(event) {
    event.preventDefault()
    if (!canManage) return
    if (number(form.damaged_quantity) + number(form.missing_quantity) > number(form.quantity)) {
      setError('إجمالي التالف والمفقود لا يمكن أن يتجاوز الكمية المسجلة.')
      return
    }
    setSaving(true)
    setError('')
    const branchId = editing?.branch_id || (isCentral ? branchFilter !== 'all' ? branchFilter : '' : ownBranchId)
    if (!branchId) {
      setError('اختر الفرع أولاً قبل إضافة الصنف.')
      setSaving(false)
      return
    }
    const payload = {
      ...form,
      quantity: number(form.quantity),
      damaged_quantity: number(form.damaged_quantity),
      missing_quantity: number(form.missing_quantity),
      branch_id: branchId,
      item_code: form.item_code.trim() || null,
      category: form.category.trim() || null,
      image_url: form.image_url.trim() || null,
      notes: form.notes.trim() || null
    }
    const result = editing
      ? await supabase.from('inventory_items').update(payload).eq('id', editing.id)
      : await supabase.from('inventory_items').insert(payload)
    if (result.error) setError(result.error.message)
    else {
      setNotice(editing ? 'تم تحديث بيانات الصنف.' : 'تمت إضافة الصنف بنجاح.')
      setModalOpen(false)
      await loadData()
    }
    setSaving(false)
  }

  async function deleteItem(item) {
    if (!isCentral) return
    if (!window.confirm(`هل أنت متأكد من حذف الصنف «${item.item_name}»؟`)) return
    const { error: deleteError } = await supabase.from('inventory_items').delete().eq('id', item.id)
    if (deleteError) setError(deleteError.message)
    else { setNotice('تم حذف الصنف.'); await loadData() }
  }

  if (!isSupabaseConfigured) return <SetupScreen />
  if (!session) return <LoginScreen email={email} setEmail={setEmail} password={password} setPassword={setPassword} onSubmit={signIn} loading={loading} error={error} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Boxes size={25}/></div><div><strong>NIS SportTrack</strong><small>PE Inventory Management</small></div></div>
        <div className="side-label">القائمة الرئيسية</div>
        <div className="nav-item active"><ClipboardList size={18}/> إدارة المخزون</div>
        <div className="nav-item"><Activity size={18}/> حركة الأدوات <span className="soon">قريباً</span></div>
        <div className="nav-item"><Building2 size={18}/> الفروع</div>
        <div className="sidebar-bottom"><ShieldCheck size={17}/><span>نظام متابعة مركزي للفروع</span></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><div className="eyebrow">NIS • PHYSICAL EDUCATION</div><h1>إدارة أدوات التربية الرياضية</h1></div>
          <div className="user-area"><div className="avatar"><CircleUserRound size={21}/></div><div className="user-copy"><strong>{profile?.full_name || session.user.email}</strong><small>{isCentral ? 'مسؤول مركزي' : 'مسؤول فرع'}</small></div><button className="icon-button" onClick={signOut} title="تسجيل الخروج"><LogOut size={18}/></button></div>
        </header>

        <section className="welcome-row">
          <div><h2>لوحة متابعة المخزون</h2><p>متابعة الكميات والمتاح والتالف والمفقود في فروع NIS.</p></div>
          <button className="button button-primary" onClick={openNew} disabled={!canManage}><Plus size={18}/> إضافة صنف جديد</button>
        </section>

        {error && <div className="alert alert-error"><AlertTriangle size={18}/>{error}<button onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="alert alert-success"><CheckCircle2 size={18}/>{notice}<button onClick={() => setNotice('')}><X size={16}/></button></div>}

        <section className="stats-grid">
          <Stat icon={<Package/>} label="عدد الأصناف" value={totals.items}/>
          <Stat icon={<Boxes/>} label="إجمالي الكمية" value={totals.quantity}/>
          <Stat icon={<CheckCircle2/>} label="المتاح للاستخدام" value={totals.available}/>
          <Stat icon={<AlertTriangle/>} label="التالف" value={totals.damaged} tone="warning"/>
          <Stat icon={<Trash2/>} label="المفقود" value={totals.missing} tone="danger"/>
        </section>

        <section className="panel">
          <div className="panel-heading"><div><h3>سجل الأدوات</h3><p>بيانات الجرد حسب الفرع</p></div><button className="button button-light" onClick={() => loadData()}><RefreshCw size={16}/> تحديث البيانات</button></div>
          <div className="filters">
            <label className="search-box"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث باسم الصنف أو الكود أو الفرع..."/></label>
            {isCentral && <label className="select-wrap"><Building2 size={17}/><select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}><option value="all">كل الفروع</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><ChevronDown size={15}/></label>}
            <label className="select-wrap"><select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="all">كل التصنيفات</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select><ChevronDown size={15}/></label>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>الصنف</th>{isCentral && <th>الفرع</th>}<th>التصنيف</th><th>الكمية</th><th>التالف</th><th>المفقود</th><th>المتاح</th><th>آخر تحديث</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={isCentral ? 9 : 8} className="empty-state">جاري تحميل البيانات...</td></tr> :
                  filteredItems.length === 0 ? <tr><td colSpan={isCentral ? 9 : 8} className="empty-state"><Package size={28}/><strong>لا توجد أصناف لعرضها</strong><span>ابدأ بإضافة أول صنف إلى سجل المخزون.</span></td></tr> :
                  filteredItems.map(item => <tr key={item.id}>
                    <td><div className="item-cell">{item.image_url ? <img src={item.image_url} alt="" onError={e => {e.currentTarget.style.display='none'}}/> : <div className="item-placeholder"><Package size={18}/></div>}<div><strong>{item.item_name}</strong><small>{item.item_code || 'بدون كود'}</small></div></div></td>
                    {isCentral && <td>{item.branches?.name || '—'}</td>}
                    <td>{item.category || '—'}</td><td className="numeric">{item.quantity} {item.unit}</td>
                    <td><span className="number-pill warning">{item.damaged_quantity}</span></td>
                    <td><span className="number-pill danger">{item.missing_quantity}</span></td>
                    <td><strong className="available">{Math.max(0, number(item.quantity)-number(item.damaged_quantity)-number(item.missing_quantity))}</strong></td>
                    <td>{formatDate(item.updated_at)}</td>
                    <td><div className="actions"><button className="small-action" onClick={() => openEdit(item)} disabled={!canManage} title="تعديل"><Activity size={16}/></button>{isCentral && <button className="small-action danger-action" onClick={() => deleteItem(item)} title="حذف"><Trash2 size={16}/></button>}</div></td>
                  </tr>)
                }
              </tbody>
            </table>
          </div>
          <div className="table-footer"><span>عدد النتائج: {filteredItems.length}</span><span>آخر تحديث حسب بيانات قاعدة البيانات</span></div>
        </section>
        <footer className="footer">NIS SportTrack <span>•</span> Physical Education Department</footer>
      </main>

      {modalOpen && <div className="modal-backdrop" onMouseDown={e => {if(e.target===e.currentTarget)setModalOpen(false)}}><form className="modal" onSubmit={saveItem}>
        <div className="modal-heading"><div><h3>{editing ? 'تعديل بيانات الصنف' : 'إضافة صنف جديد'}</h3><p>أدخل بيانات الأداة والكميات بدقة</p></div><button type="button" className="icon-button" onClick={() => setModalOpen(false)}><X/></button></div>
        {!editing && isCentral && <label className="field full">الفرع<select required value={branchFilter === 'all' ? '' : branchFilter} onChange={e => setBranchFilter(e.target.value)}><option value="">اختر الفرع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        <div className="form-grid">
          <label className="field">اسم الصنف *<input required value={form.item_name} onChange={e=>setForm({...form,item_name:e.target.value})} placeholder="مثال: كرة قدم"/></label>
          <label className="field">كود الصنف<input value={form.item_code} onChange={e=>setForm({...form,item_code:e.target.value})} placeholder="مثال: FB-001"/></label>
          <label className="field">التصنيف<input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="مثال: ألعاب جماعية"/></label>
          <label className="field">وحدة القياس<input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="قطعة"/></label>
          <label className="field">الكمية الإجمالية *<input type="number" min="0" required value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>
          <label className="field">التالف<input type="number" min="0" required value={form.damaged_quantity} onChange={e=>setForm({...form,damaged_quantity:e.target.value})}/></label>
          <label className="field">المفقود<input type="number" min="0" required value={form.missing_quantity} onChange={e=>setForm({...form,missing_quantity:e.target.value})}/></label>
          <label className="field">رابط صورة الأداة<input type="url" value={form.image_url} onChange={e=>setForm({...form,image_url:e.target.value})} placeholder="https://..."/></label>
          <label className="field full">ملاحظات<textarea rows="3" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="أي تفاصيل إضافية عن حالة الأداة..."/></label>
        </div>
        <div className="modal-actions"><button type="button" className="button button-light" onClick={()=>setModalOpen(false)}>إلغاء</button><button className="button button-primary" disabled={saving}>{saving ? 'جارٍ الحفظ...' : 'حفظ البيانات'}</button></div>
      </form></div>}
    </div>
  )
}

function Stat({ icon, label, value, tone='' }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value.toLocaleString('en-US')}</strong></div></div>
}

function LoginScreen({ email, setEmail, password, setPassword, onSubmit, loading, error }) {
  return <div className="login-screen"><div className="login-card"><div className="login-logo"><Boxes size={30}/></div><div className="eyebrow">NIS • PHYSICAL EDUCATION</div><h1>NIS SportTrack</h1><p>منصة إدارة ومتابعة أدوات التربية الرياضية في جميع الفروع</p>{error && <div className="alert alert-error">{error}</div>}<form onSubmit={onSubmit}><label className="field">البريد الإلكتروني<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@school.com"/></label><label className="field">كلمة المرور<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></label><button className="button button-primary login-button" disabled={loading}>{loading ? 'جارٍ الدخول...' : 'تسجيل الدخول'}</button></form><small className="login-note">يتم إنشاء الحسابات وإدارة صلاحياتها بواسطة مسؤول النظام.</small></div></div>
}

function SetupScreen() {
  return <div className="login-screen"><div className="login-card"><div className="login-logo"><Boxes size={30}/></div><div className="eyebrow">NIS • PHYSICAL EDUCATION</div><h1>NIS SportTrack</h1><p>المنصة جاهزة للاتصال بقاعدة بيانات Supabase.</p><div className="setup-steps"><strong>خطوات الإعداد:</strong><ol><li>أنشئ مشروع Supabase أو استخدم المشروع الحالي.</li><li>نفّذ ملف <code>supabase/schema.sql</code> من SQL Editor.</li><li>أضف متغيري البيئة في ملف <code>.env.local</code> ثم أعد تشغيل التطبيق.</li></ol></div><div className="alert alert-error">لم يتم ضبط بيانات الاتصال بعد.</div></div></div>
}

export default App