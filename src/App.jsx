import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Wrench, ArrowDownToLine, ArrowUpFromLine, Boxes,
  Building2, CheckCircle2, ChevronDown, CircleUserRound, ClipboardList,
  LogOut, Package, Plus, RefreshCw, Search, ShieldCheck, Trash2, X, Download, Printer, SlidersHorizontal, ArrowUpDown
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import PeriodicAudits from './components/PeriodicAudits'
import DamageMaintenance from './components/DamageMaintenance'
import BranchComparison from './components/BranchComparison'
import Settings from './components/Settings'
import InventoryReports from './components/InventoryReports'

const BRANCHES = ['El Shorouk', 'O West', 'New Capital', 'El Tagamoa', 'Porto Said']
const emptyForm = { item_code: '', item_name: '', category: '', quantity: 0, damaged_quantity: 0, missing_quantity: 0, unit: 'قطعة', image_url: '', notes: '' }
const number = value => Number(value || 0)

const SPORT_CODES = [
  { prefix: 'AF', words: ['american football', 'كرة القدم الأمريكية', 'امريكية'] },
  { prefix: 'HY', words: ['hyrox', 'هايروكس'] },
  { prefix: 'BA', words: ['badminton', 'بادمنتون', 'ريشة طائرة'] },
  { prefix: 'TT', words: ['table tennis', 'تنس طاولة', 'بينج بونج', 'بينغ بونغ'] },
  { prefix: 'HO', words: ['hockey', 'هوكي'] },
  { prefix: 'PI', words: ['pickleball', 'بيكلبول'] },
  { prefix: 'BX', words: ['boxing', 'ملاكمة', 'بوكس'] },
  { prefix: 'BS', words: ['baseball', 'بيسبول'] },
  { prefix: 'BW', words: ['bowling', 'بولينج', 'بولينغ'] },
  { prefix: 'FB', words: ['football', 'soccer', 'كرة قدم', 'كره قدم'] },
  { prefix: 'FS', words: ['futsal', 'كرة صالات'] },
  { prefix: 'B', words: ['basketball', 'كرة سلة', 'كره سله'] },
  { prefix: 'V', words: ['volleyball', 'كرة طائرة', 'كره طائره'] },
  { prefix: 'H', words: ['handball', 'كرة يد', 'كره يد'] },
  { prefix: 'T', words: ['tennis', 'تنس'] },
  { prefix: 'P', words: ['padel', 'بادل'] },
  { prefix: 'S', words: ['swimming', 'سباحة', 'سباحه'] },
  { prefix: 'A', words: ['athletics', 'ألعاب قوى', 'العاب قوى'] },
  { prefix: 'FI', words: ['fitness', 'لياقة', 'لياقه'] },
  { prefix: 'G', words: ['gymnastics', 'جمباز'] },
  { prefix: 'C', words: ['crossfit', 'cross fit', 'كروس فيت'] },
  { prefix: 'J', words: ['judo', 'جودو'] },
  { prefix: 'K', words: ['karate', 'كاراتيه'] },
  { prefix: 'TK', words: ['taekwondo', 'تايكوندو'] },
  { prefix: 'F', words: ['fencing', 'مبارزة', 'مبارزه'] }
]
const getSportPrefix = value => {
  const name = String(value || '').toLowerCase().trim()
  if (!name) return ''
  const words = SPORT_CODES.flatMap(sport => sport.words.map(word => ({ prefix: sport.prefix, word: word.toLowerCase() })))
    .sort((a, b) => b.word.length - a.word.length)
  return words.find(entry => name.includes(entry.word))?.prefix || ''
}
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
  const [codeSuggestion, setCodeSuggestion] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [activeSection, setActiveSection] = useState('inventory')
  const [language, setLanguage] = useState(() => localStorage.getItem('nis-language') || 'ar')
  const t = (ar, en) => language === 'en' ? en : ar
  const [inventoryFocus, setInventoryFocus] = useState('all')
  const [visibleColumns, setVisibleColumns] = useState(['item','branch','category','quantity','damaged','missing','available','updated'])
  const [sortConfig, setSortConfig] = useState({ key: 'item_name', direction: 'asc' })

  useEffect(() => {
    const syncLanguage = () => setLanguage(localStorage.getItem('nis-language') || 'ar')
    window.addEventListener('nis-language-change', syncLanguage)
    return () => window.removeEventListener('nis-language-change', syncLanguage)
  }, [])

  const isCentral = profile?.role === 'super_admin'
  const canManage = isCentral || profile?.role === 'branch_manager'
  const ownBranchId = profile?.branch_id

  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [totalRows, setTotalRows] = useState(0)
  const [inventoryTotals, setInventoryTotals] = useState({ items: 0, quantity: 0, damaged: 0, missing: 0, available: 0 })

  const loadData = useCallback(async (activeSession = session, requestedPage = page, requestedBranch = branchFilter, requestedSearch = '') => {
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
    let query = supabase.from('inventory')
      .select('id, branch_id, quantity, damaged_quantity, missing_quantity, notes, updated_at, branches!inventory_branch_id_fkey(name), equipment!inventory_equipment_id_fkey(id, name, item_code, photo_url, unit, categories!equipment_category_id_fkey(name))', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(requestedPage * PAGE_SIZE, (requestedPage + 1) * PAGE_SIZE - 1)
    const searchTerm = String(requestedSearch || '').trim().replace(/[%,]/g, ' ')
    if (searchTerm) {
      const pattern = '%' + searchTerm + '%'
      query = query.or('name.ilike.' + pattern + ',item_code.ilike.' + pattern, { foreignTable: 'equipment' })
    }
    if (profileResult.data.role !== 'super_admin') {
      if (!profileResult.data.branch_id) {
        setItems([])
        setTotalRows(0)
        setInventoryTotals({ items: 0, quantity: 0, damaged: 0, missing: 0, available: 0 })
        setHasMore(false)
        setError('حسابك غير مرتبط بفرع. اطلب من مسؤول النظام تحديد branch_id في جدول profiles.')
        setLoading(false)
        return
      }
      query = query.eq('branch_id', profileResult.data.branch_id)
    } else if (requestedBranch !== 'all') {
      query = query.eq('branch_id', requestedBranch)
    }
    // احسب الإجماليات من كل سجلات نطاق صلاحية المستخدم، وليس من صفحة العرض الحالية.
    let totalsQuery = supabase.from('inventory')
      .select('quantity, damaged_quantity, missing_quantity', { count: 'exact' })
      .range(0, 999)
    if (profileResult.data.role !== 'super_admin') {
      totalsQuery = totalsQuery.eq('branch_id', profileResult.data.branch_id)
    } else if (requestedBranch !== 'all') {
      totalsQuery = totalsQuery.eq('branch_id', requestedBranch)
    }
    const totalsRows = []
    let totalsCount = 0
    let totalsError = null
    let totalsPage = 0
    while (true) {
      const { data: batch, error: batchError, count: batchCount } = totalsPage === 0
        ? await totalsQuery
        : await supabase.from('inventory')
            .select('quantity, damaged_quantity, missing_quantity', { count: 'exact' })
            .range(totalsPage * 1000, (totalsPage + 1) * 1000 - 1)
            .match(profileResult.data.role !== 'super_admin'
              ? { branch_id: profileResult.data.branch_id }
              : requestedBranch !== 'all' ? { branch_id: requestedBranch } : {})
      if (batchError) { totalsError = batchError; break }
      if (totalsPage === 0) totalsCount = batchCount || 0
      totalsRows.push(...(batch || []))
      if (!batch || batch.length < 1000 || totalsRows.length >= totalsCount) break
      totalsPage += 1
    }
    if (totalsError) {
      setError(totalsError.message)
    } else {
      setInventoryTotals(totalsRows.reduce((acc, row) => {
        const quantity = number(row.quantity)
        const damaged = number(row.damaged_quantity)
        const missing = number(row.missing_quantity)
        acc.items += 1
        acc.quantity += quantity
        acc.damaged += damaged
        acc.missing += missing
        acc.available += Math.max(0, quantity - damaged - missing)
        return acc
      }, { items: 0, quantity: 0, damaged: 0, missing: 0, available: 0 }))
    }

    const { data, error: itemsError, count } = await query
    if (itemsError) {
      setError(itemsError.message)
      setLoading(false)
      return
    }
    const mappedItems = await Promise.all((data || []).map(async row => {
      const storedPhoto = row.equipment?.photo_url || ''
      let displayPhoto = storedPhoto
      if (storedPhoto.startsWith('storage:')) {
        const path = storedPhoto.slice('storage:'.length)
        const { data: signed } = await supabase.storage.from('nis-sporttrack-evidence').createSignedUrl(path, 3600)
        displayPhoto = signed?.signedUrl || ''
      }
      return { ...row, item_name: row.equipment?.name || 'صنف غير معروف', item_code: row.equipment?.item_code || '', category: row.equipment?.categories?.name || '', image_url: displayPhoto, photo_storage_value: storedPhoto, unit: row.equipment?.unit || 'قطعة', equipment_id: row.equipment?.id }
    }))
    setItems(mappedItems)
    setTotalRows(count || 0)
    setHasMore((requestedPage + 1) * PAGE_SIZE < (count || 0))
    setLoading(false)
  }, [session, page, branchFilter])

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let mounted = true
    let initialSessionResolved = false
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return
      if (sessionError) setError(sessionError.message)
      initialSessionResolved = true
      setSession(data.session)
      if (data.session) loadData(data.session, 0, 'all')
      else setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      if (nextSession) {
        if (initialSessionResolved) loadData(nextSession, 0, 'all')
      } else {
        setProfile(null)
        setItems([])
        setTotalRows(0)
        setHasMore(false)
        setLoading(false)
      }
    })
    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => {
      setPage(0)
      loadData(session, 0, branchFilter, search)
    }, 350)
    return () => clearTimeout(timer)
  }, [search])

  const filteredItems = useMemo(() => items.filter(item => {
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || [item.item_name, item.item_code, item.category, item.branches?.name]
      .some(value => String(value || '').toLowerCase().includes(term))
    const matchesBranch = branchFilter === 'all' || item.branch_id === branchFilter
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter
    const available = Math.max(0, number(item.quantity) - number(item.damaged_quantity) - number(item.missing_quantity))
    const matchesFocus = inventoryFocus === 'all' || (inventoryFocus === 'damaged' && number(item.damaged_quantity) > 0) || (inventoryFocus === 'missing' && number(item.missing_quantity) > 0) || (inventoryFocus === 'available' && available > 0)
    return matchesSearch && matchesBranch && matchesCategory && matchesFocus
  }), [items, search, branchFilter, categoryFilter, inventoryFocus])

  const sortedFilteredItems = useMemo(() => [...filteredItems].sort((a,b) => {
    const key = sortConfig.key
    let av = key === 'branch_name' ? (a.branches?.name || '') : key === 'available' ? Math.max(0,number(a.quantity)-number(a.damaged_quantity)-number(a.missing_quantity)) : a[key]
    let bv = key === 'branch_name' ? (b.branches?.name || '') : key === 'available' ? Math.max(0,number(b.quantity)-number(b.damaged_quantity)-number(b.missing_quantity)) : b[key]
    if (typeof av === 'number' || typeof bv === 'number') return (number(av)-number(bv)) * (sortConfig.direction === 'asc' ? 1 : -1)
    return String(av || '').localeCompare(String(bv || ''), 'ar', {numeric:true}) * (sortConfig.direction === 'asc' ? 1 : -1)
  }), [filteredItems, sortConfig])

  const inventoryColumnDefs = [
    {key:'item',label:'الصنف'}, ...(isCentral ? [{key:'branch',label:'الفرع'}] : []),
    {key:'category',label:'التصنيف'}, {key:'quantity',label:'الكمية'}, {key:'damaged',label:'التالف'},
    {key:'missing',label:'المفقود'}, {key:'available',label:'المتاح'}, {key:'updated',label:'آخر تحديث'}
  ]
  const isColumnVisible = key => visibleColumns.includes(key)
  const toggleColumn = key => setVisibleColumns(current => current.includes(key) ? current.filter(v=>v!==key) : [...current,key])
  const sortBy = key => {
    const field = key === 'item' ? 'item_name' : key === 'branch' ? 'branch_name' : key === 'category' ? 'category' : key === 'quantity' ? 'quantity' : key === 'damaged' ? 'damaged_quantity' : key === 'missing' ? 'missing_quantity' : key === 'available' ? 'available' : 'updated_at'
    setSortConfig(current => ({key:field,direction:current.key===field && current.direction==='asc'?'desc':'asc'}))
  }
  const exportInventoryCsv = () => {
    const columns = inventoryColumnDefs.filter(col=>isColumnVisible(col.key))
    const valueFor = (item,key) => ({
      item: item.item_name, branch: item.branches?.name || '', category: item.category || '',
      quantity: item.quantity, damaged: item.damaged_quantity, missing: item.missing_quantity,
      available: Math.max(0,number(item.quantity)-number(item.damaged_quantity)-number(item.missing_quantity)),
      updated: formatDate(item.updated_at)
    }[key])
    const escapeCsv = value => '"' + String(value ?? '').replace(/"/g,'""') + '"'
    const csv = '\uFEFF' + [columns.map(col=>escapeCsv(col.label)).join(','), ...sortedFilteredItems.map(item=>columns.map(col=>escapeCsv(valueFor(item,col.key))).join(','))].join('\\r\\n')
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'})
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href=url; link.download='NIS-SportTrack-Inventory.csv'; link.click()
    URL.revokeObjectURL(url)
  }

  const categories = [...new Set(items.map(item => item.category).filter(Boolean))]

  useEffect(() => {
    if (!modalOpen || editing || !isCentral) {
      setCodeSuggestion('')
      return
    }
    const prefix = getSportPrefix(form.item_name)
    if (!prefix || !supabase) {
      setCodeSuggestion('')
      setForm(current => current.item_code ? { ...current, item_code: '' } : current)
      return
    }
    let cancelled = false
    const loadNextCode = async () => {
      const { data, error: codeError } = await supabase
        .from('equipment')
        .select('item_code')
        .like('item_code', prefix + '-%')
      if (cancelled) return
      if (codeError) {
        setCodeSuggestion('')
        return
      }
      const highest = (data || []).reduce((max, row) => {
        const code = String(row.item_code || '')
        if (!code.startsWith(prefix + '-')) return max
        const sequence = Number(code.slice(prefix.length + 1))
        return Number.isInteger(sequence) && sequence > max ? sequence : max
      }, 0)
      const nextCode = prefix + '-' + String(highest + 1).padStart(3, '0')
      setCodeSuggestion(nextCode)
      setForm(current => ({ ...current, item_code: nextCode }))
    }
    loadNextCode()
    return () => { cancelled = true }
  }, [modalOpen, editing, isCentral, form.item_name])

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
    setImageFile(null)
    setImagePreview('')
    setEditing(null)
    setForm(emptyForm)
    setCodeSuggestion('')
    setModalOpen(true)
  }

  function openEdit(item) {
    setImageFile(null)
    setImagePreview(item.image_url || '')
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
    const branchIdForUpload = editing?.branch_id || (isCentral ? branchFilter !== 'all' ? branchFilter : '' : ownBranchId)
    if (imageFile && !branchIdForUpload) { setError('اختر الفرع أولاً قبل رفع الصورة.'); setSaving(false); return }
    let savedPhoto = editing?.photo_storage_value || editing?.image_url || ''
    if (imageFile) {
      if (!['image/jpeg','image/png','image/webp'].includes(imageFile.type) || imageFile.size > 10 * 1024 * 1024) { setError('يرجى اختيار صورة JPG أو PNG أو WEBP بحجم لا يتجاوز 10 ميجابايت.'); setSaving(false); return }
      const extension = imageFile.type === 'image/png' ? 'png' : imageFile.type === 'image/webp' ? 'webp' : 'jpg'
      const storagePath = 'equipment/' + crypto.randomUUID() + '.' + extension
      const { error: uploadError } = await supabase.storage.from('nis-sporttrack-evidence').upload(storagePath, imageFile, { contentType: imageFile.type, upsert: false })
      if (uploadError) { setError('تعذر رفع الصورة: ' + uploadError.message); setSaving(false); return }
      savedPhoto = 'storage:' + storagePath
    }
    const stockPayload = {
      branch_id: branchId,
      quantity: number(form.quantity),
      damaged_quantity: number(form.damaged_quantity),
      missing_quantity: number(form.missing_quantity),
      notes: form.notes.trim() || null
    }
    let equipmentId = editing?.equipment_id || null

    if (!editing || isCentral) {
      let categoryId = null
      const categoryName = form.category.trim()
      if (categoryName) {
        const { data: categoryRow, error: categoryError } = await supabase
          .from('categories')
          .upsert({ name: categoryName }, { onConflict: 'name', ignoreDuplicates: true })
          .select('id')
          .maybeSingle()
        if (categoryError) {
          setError(categoryError.message); setSaving(false); return
        }
        if (categoryRow) categoryId = categoryRow.id
        else {
          const { data: existingCategory, error: lookupError } = await supabase
            .from('categories').select('id').eq('name', categoryName).single()
          if (lookupError) {
            setError(lookupError.message); setSaving(false); return
          }
          categoryId = existingCategory.id
        }
      }

      const equipmentPayload = {
        name: form.item_name.trim(),
        item_code: form.item_code.trim() || null,
        description: form.notes.trim() || null,
        photo_url: savedPhoto.startsWith('storage:') ? savedPhoto : (form.image_url.trim() || null),
        unit: form.unit.trim() || 'Piece',
        category_id: categoryId
      }

      if (!editing && isCentral && !equipmentPayload.item_code) {
        setError('لم يتم تحديد اللعبة من اسم الأداة. اكتب اسم اللعبة بوضوح أو أدخل كوداً يدوياً.');
        setSaving(false); return
      }

      if (editing && isCentral) {
        const { error: equipmentError } = await supabase.from('equipment')
          .update(equipmentPayload).eq('id', equipmentId)
        if (equipmentError) {
          setError(equipmentError.message); setSaving(false); return
        }
      } else if (!editing) {
        if (isCentral) {
          const { data: createdEquipment, error: equipmentError } = await supabase
            .from('equipment').insert(equipmentPayload).select('id').single()
          if (equipmentError) {
            setError(equipmentError.message); setSaving(false); return
          }
          equipmentId = createdEquipment.id
        } else {
          const { data: existingEquipment, error: equipmentLookupError } = await supabase
            .from('equipment').select('id').eq('name', equipmentPayload.name).maybeSingle()
          if (equipmentLookupError || !existingEquipment) {
            setError('هذا الصنف غير مسجل في دليل الأدوات. اطلب من المسؤول المركزي إضافته أولاً.')
            setSaving(false); return
          }
          equipmentId = existingEquipment.id
        }
      }
    }

    const result = editing
      ? await supabase.from('inventory').update(stockPayload).eq('id', editing.id)
      : await supabase.from('inventory')
          .upsert(
            { ...stockPayload, equipment_id: equipmentId },
            { onConflict: 'branch_id,equipment_id' }
          )
    if (result.error) setError(result.error.message)
    else {
      setNotice(editing ? 'تم تحديث بيانات الصنف.' : 'تمت إضافة الصنف بنجاح.')
      setModalOpen(false)
      setImageFile(null)
      setImagePreview('')
      await loadData(session, page, branchFilter)
    }
    setSaving(false)
  }

  async function deleteItem(item) {
    if (!isCentral) return
    if (!window.confirm(`هل أنت متأكد من حذف الصنف «${item.item_name}»؟`)) return
    const { error: deleteError } = await supabase.from('inventory').delete().eq('id', item.id)
    if (deleteError) setError(deleteError.message)
    else { setNotice('تم حذف الصنف.'); await loadData(session, page, branchFilter) }
  }

  if (!isSupabaseConfigured) return <SetupScreen />
  if (!session) return <LoginScreen email={email} setEmail={setEmail} password={password} setPassword={setPassword} onSubmit={signIn} loading={loading} error={error} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Boxes size={25}/></div><div><strong>NIS SportTrack</strong><small>PE Inventory Management</small></div></div>
        <div className="side-label">{t('القائمة الرئيسية','MAIN MENU')}</div>
        <button className={activeSection === 'inventory' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveSection('inventory')}><ClipboardList size={18}/> {t('إدارة المخزون','Inventory')}</button>
        <button className={activeSection === 'audits' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveSection('audits')}><Activity size={18}/> {t('الجرد الدوري','Periodic Audits')}</button>
        <button className={activeSection === 'services' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveSection('services')}><Wrench size={18}/> {t('الصيانة والتالف','Maintenance & Damage')}</button>
        {isCentral && <>
          <button className={activeSection === 'comparison' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveSection('comparison')}><Building2 size={18}/> {t('مقارنة الفروع','Branch Comparison')}</button>
          <button className={activeSection === 'reports' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveSection('reports')}><ClipboardList size={18}/> {t('تقارير الفروع','Branch Reports')}</button>
        </>}
        <button className={activeSection === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveSection('settings')}><ShieldCheck size={18}/> {t('الإعدادات','Settings')}</button>
        <button className={activeSection === 'branches' ? 'nav-item active' : 'nav-item'} onClick={() => { setActiveSection('inventory'); setBranchFilter('all'); setPage(0); setInventoryFocus('all'); loadData(session, 0, 'all') }}><Building2 size={18}/> الفروع</button>
        <div className="sidebar-bottom"><ShieldCheck size={17}/><span>{t('نظام متابعة مركزي للفروع','Central Branch Management')}</span></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><div className="eyebrow">NIS • PHYSICAL EDUCATION</div><h1>{t('{t('إدارة أدوات التربية الرياضية','PE Equipment Management')}','PE Equipment Management')}</h1></div>
          <div className="user-area"><div className="avatar"><CircleUserRound size={21}/></div><div className="user-copy"><strong>{profile?.full_name || session.user.email}</strong><small>{isCentral ? t('مسؤول مركزي','Central Administrator') : t('مسؤول فرع','Branch Administrator')}</small></div><button className="icon-button" onClick={signOut} title="تسجيل الخروج"><LogOut size={18}/></button></div>
        </header>

        <section className="welcome-row">
          <div><h2>{activeSection === 'inventory' ? '{t('لوحة متابعة المخزون','Inventory Dashboard')}' : activeSection === 'audits' ? 'إدارة {t('الجرد الدوري','Periodic Audits')}' : activeSection === 'services' ? 'إدارة {t('الصيانة والتالف','Maintenance & Damage')} والمفقود' : activeSection === 'comparison' ? '{t('مقارنة مخزون الفروع','Branch Inventory Comparison')}' : '{t('تقارير المخزون للفروع','Branch Inventory Reports')}'}</h2><p>{activeSection === 'inventory' ? '{t('متابعة الكميات والمتاح والتالف والمفقود في فروع NIS.','Track quantities, available, damaged and missing items across NIS branches.')}' : activeSection === 'audits' ? 'تنظيم جلسات الجرد وتوثيق النتائج ومراجعتها مركزيًا.' : activeSection === 'services' ? 'تسجيل بلاغات التلف والفقد وطلبات الصيانة ومتابعتها.' : activeSection === 'comparison' ? 'مراجعة توزيع الأصناف والكميات والمتاح والتالف والمفقود بين الفروع.' : 'استخراج تقارير تفصيلية وملخصات قابلة للتصدير لكل فرع.'}</p></div>
          {activeSection === 'inventory' && <button className="button button-primary" onClick={openNew} disabled={!canManage}><Plus size={18}/> {t('إضافة صنف جديد','Add New Item')}</button>}
        </section>

        {error && <div className="alert alert-error"><AlertTriangle size={18}/>{error}<button onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="alert alert-success"><CheckCircle2 size={18}/>{notice}<button onClick={() => setNotice('')}><X size={16}/></button></div>}

        {activeSection === 'inventory' && <>
        <section className="stats-grid">
          <Stat icon={<Package/>} label="إجمالي الأصناف" value={inventoryTotals.items} onClick={() => { setActiveSection('inventory'); setInventoryFocus('all') }}/>
          <Stat icon={<Boxes/>} label="إجمالي الكمية" value={inventoryTotals.quantity} onClick={() => { setActiveSection('inventory'); setInventoryFocus('all') }}/>
          <Stat icon={<CheckCircle2/>} label="إجمالي المتاح" value={inventoryTotals.available} onClick={() => { setActiveSection('inventory'); setInventoryFocus('available') }}/>
          <Stat icon={<AlertTriangle/>} label="إجمالي التالف" value={inventoryTotals.damaged} tone="warning" onClick={() => { setActiveSection('inventory'); setInventoryFocus('damaged') }}/>
          <Stat icon={<Trash2/>} label="إجمالي المفقود" value={inventoryTotals.missing} tone="danger" onClick={() => { setActiveSection('inventory'); setInventoryFocus('missing') }}/>
        </section>

        <section className="panel">
          <div className="panel-heading"><div><h3>{t('سجل الأدوات','Equipment Register')}</h3><p>{t('بيانات الجرد حسب الفرع','Inventory records by branch')} {inventoryFocus !== 'all' && <button className="inline-clear-filter" onClick={() => setInventoryFocus('all')}>إلغاء التصفية ×</button>}</p></div><button className="button button-light" onClick={() => loadData(session, page, branchFilter, search)}><RefreshCw size={16}/> {t('تحديث البيانات','Refresh Data')}</button></div>
          <div className="filters">
            <label className="search-box"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث في جميع سجلات المخزون باسم الصنف أو الكود..."/></label>
            {isCentral && <label className="select-wrap"><Building2 size={17}/><select value={branchFilter} onChange={e => { const next = e.target.value; setBranchFilter(next); setPage(0); loadData(session, 0, next, search) }}><option value="all">{t('كل الفروع','All Branches')}</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><ChevronDown size={15}/></label>}
            <label className="select-wrap"><select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="all">{t('كل التصنيفات','All Categories')}</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select><ChevronDown size={15}/></label>
          </div>
          <div className="inventory-table-tools">
            <div className="inventory-tool-group">
              <details className="column-picker"><summary><SlidersHorizontal size={16}/> الأعمدة الظاهرة</summary><div className="column-picker-menu">{inventoryColumnDefs.map(col=><label key={col.key}><input type="checkbox" checked={isColumnVisible(col.key)} disabled={col.key==='item'} onChange={()=>toggleColumn(col.key)}/>{col.label}</label>)}</div></details>
              <button className="button button-light" onClick={exportInventoryCsv}><Download size={16}/> تصدير Excel</button>
              <button className="button button-light" onClick={()=>window.print()}><Printer size={16}/> طباعة</button>
            </div>
            <span className="table-result-count">يعرض {sortedFilteredItems.length} سجلًا من الصفحة الحالية</span>
          </div>
          <div className="table-wrap">
            <table className="inventory-data-table">
              <thead><tr>
                {isColumnVisible('item') && <th><button className="table-sort" onClick={()=>sortBy('item')}>الصنف <ArrowUpDown size={13}/></button></th>}
                {isCentral && isColumnVisible('branch') && <th><button className="table-sort" onClick={()=>sortBy('branch')}>الفرع <ArrowUpDown size={13}/></button></th>}
                {isColumnVisible('category') && <th><button className="table-sort" onClick={()=>sortBy('category')}>التصنيف <ArrowUpDown size={13}/></button></th>}
                {isColumnVisible('quantity') && <th><button className="table-sort" onClick={()=>sortBy('quantity')}>الكمية <ArrowUpDown size={13}/></button></th>}
                {isColumnVisible('damaged') && <th><button className="table-sort" onClick={()=>sortBy('damaged')}>التالف <ArrowUpDown size={13}/></button></th>}
                {isColumnVisible('missing') && <th><button className="table-sort" onClick={()=>sortBy('missing')}>المفقود <ArrowUpDown size={13}/></button></th>}
                {isColumnVisible('available') && <th><button className="table-sort" onClick={()=>sortBy('available')}>المتاح <ArrowUpDown size={13}/></button></th>}
                {isColumnVisible('updated') && <th><button className="table-sort" onClick={()=>sortBy('updated_at')}>آخر تحديث <ArrowUpDown size={13}/></button></th>}
                <th className="no-print">الإجراءات</th>
              </tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={inventoryColumnDefs.filter(col=>isColumnVisible(col.key)).length+1} className="empty-state">جاري تحميل البيانات...</td></tr> :
                  sortedFilteredItems.length === 0 ? <tr><td colSpan={inventoryColumnDefs.filter(col=>isColumnVisible(col.key)).length+1} className="empty-state"><Package size={28}/><strong>لا توجد أصناف لعرضها</strong><span>ابدأ بإضافة أول صنف إلى سجل المخزون.</span></td></tr> :
                  sortedFilteredItems.map(item => <tr key={item.id}>
                    {isColumnVisible('item') && <td><div className="item-cell">{item.image_url ? <img src={item.image_url} alt="" onError={e => {e.currentTarget.style.display='none'}}/> : <div className="item-placeholder"><Package size={18}/></div>}<div><strong>{item.item_name}</strong><small>{item.item_code || 'بدون كود'}</small></div></div></td>}
                    {isCentral && isColumnVisible('branch') && <td>{item.branches?.name || '—'}</td>}
                    {isColumnVisible('category') && <td>{item.category || '—'}</td>}
                    {isColumnVisible('quantity') && <td className="numeric">{item.quantity} {item.unit}</td>}
                    {isColumnVisible('damaged') && <td><span className="number-pill warning">{item.damaged_quantity}</span></td>}
                    {isColumnVisible('missing') && <td><span className="number-pill danger">{item.missing_quantity}</span></td>}
                    {isColumnVisible('available') && <td><strong className="available">{Math.max(0, number(item.quantity)-number(item.damaged_quantity)-number(item.missing_quantity))}</strong></td>}
                    {isColumnVisible('updated') && <td>{formatDate(item.updated_at)}</td>}
                    <td className="no-print"><div className="actions"><button className="small-action" onClick={() => openEdit(item)} disabled={!canManage} title="تعديل"><Activity size={16}/></button>{isCentral && <button className="small-action danger-action" onClick={() => deleteItem(item)} title="حذف"><Trash2 size={16}/></button>}</div></td>
                  </tr>)
                }
              </tbody>
            </table>
          </div>
          <div className="table-footer"><span>{inventoryFocus !== 'all' ? `عرض ${inventoryFocus === 'available' ? 'الأدوات المتاحة' : inventoryFocus === 'damaged' ? 'الأدوات التالفة' : 'الأدوات المفقودة'} — ` : ''}المعروض {filteredItems.length} من إجمالي {totalRows} سجلًا — البحث الشامل في جميع السجلات، والتصنيف والترتيب ضمن الصفحة المعروضة</span><div className="pagination"><button className="button button-light" disabled={page === 0 || loading} onClick={() => { const next = page - 1; setPage(next); loadData(session, next, branchFilter, search) }}>السابق</button><span>صفحة {page + 1}</span><button className="button button-light" disabled={!hasMore || loading} onClick={() => { const next = page + 1; setPage(next); loadData(session, next, branchFilter, search) }}>التالي</button></div></div>
        </section>
        </>}
        {activeSection === 'audits' && <PeriodicAudits profile={profile} branches={branches} isCentral={isCentral} onNotice={setNotice} onError={setError}/>}
        {activeSection === 'services' && <DamageMaintenance profile={profile} branches={branches} isCentral={isCentral} onNotice={setNotice} onError={setError}/>}
        {activeSection === 'comparison' && isCentral && <BranchComparison branches={branches} onError={setError}/ >}
        {activeSection === 'reports' && isCentral && <InventoryReports branches={branches} onError={setError}/ >}
        {activeSection === 'settings' && <Settings session={session} profile={profile} isCentral={isCentral} onError={setError} onNotice={setNotice} onProfileUpdated={setProfile}/ >}
        <footer className="footer">NIS SportTrack <span>•</span> Physical Education Department</footer>
      </main>

      {modalOpen && <div className="modal-backdrop" onMouseDown={e => {if(e.target===e.currentTarget)setModalOpen(false)}}><form className="modal" onSubmit={saveItem}>
        <div className="modal-heading"><div><h3>{editing ? 'تعديل بيانات الصنف' : '{t('إضافة صنف جديد','Add New Item')}'}</h3><p>أدخل بيانات الأداة والكميات بدقة</p></div><button type="button" className="icon-button" onClick={() => setModalOpen(false)}><X/></button></div>
        {!editing && isCentral && <label className="field full">الفرع<select required value={branchFilter === 'all' ? '' : branchFilter} onChange={e => setBranchFilter(e.target.value)}><option value="">اختر الفرع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        <div className="form-grid">
          <label className="field">اسم الصنف *<input required value={form.item_name} onChange={e=>setForm({...form,item_name:e.target.value})} placeholder="مثال: كرة قدم"/></label>
          <label className="field">كود الصنف<input value={form.item_code} readOnly={!editing && isCentral} onChange={e=>setForm({...form,item_code:e.target.value})} placeholder={getSportPrefix(form.item_name) ? "جارٍ اقتراح الكود..." : "اكتب اسم اللعبة أولاً"} />{!editing && isCentral && <small className="field-hint">{codeSuggestion ? "تم اقتراح الكود تلقائياً حسب اللعبة." : "سيتم اقتراح الكود عند كتابة اسم الأداة."}</small>}</label>
          <label className="field">التصنيف<input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="مثال: ألعاب جماعية"/></label>
          <label className="field">وحدة القياس<input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="قطعة"/></label>
          <label className="field">الكمية الإجمالية *<input type="number" min="0" required value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>
          <label className="field">التالف<input type="number" min="0" required value={form.damaged_quantity} onChange={e=>setForm({...form,damaged_quantity:e.target.value})}/></label>
          <label className="field">المفقود<input type="number" min="0" required value={form.missing_quantity} onChange={e=>setForm({...form,missing_quantity:e.target.value})}/></label>
          {isCentral && <label className="field full">صورة الأداة<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file=e.target.files?.[0] || null; setImageFile(file); setImagePreview(file ? URL.createObjectURL(file) : (editing?.image_url || "")) }}/><small className="field-hint">ارفع الصورة مباشرة من جهازك — JPG أو PNG أو WEBP، بحد أقصى 10 ميجابايت. لا حاجة لإدخال رابط.</small>{imagePreview && <img className="upload-preview" src={imagePreview} alt="معاينة صورة الأداة"/>}</label>}
          <label className="field full">ملاحظات<textarea rows="3" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="أي تفاصيل إضافية عن حالة الأداة..."/></label>
        </div>
        <div className="modal-actions"><button type="button" className="button button-light" onClick={()=>setModalOpen(false)}>إلغاء</button><button className="button button-primary" disabled={saving}>{saving ? 'جارٍ الحفظ...' : 'حفظ البيانات'}</button></div>
      </form></div>}
    </div>
  )
}

function Stat({ icon, label, value, tone='', onClick }) {
  return <button type="button" className="stat-card stat-card-clickable" onClick={onClick} title={`عرض ${label}`}><div className={`stat-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value.toLocaleString('en-US')}</strong></div><span className="stat-open-hint">عرض التفاصيل ←</span></button>
}

function LoginScreen({ email, setEmail, password, setPassword, onSubmit, loading, error }) {
  return (
    <div className="login-screen">
      <section className="login-showcase" aria-label="NIS SportTrack">
        <div className="showcase-ribbon ribbon-one" />
        <div className="showcase-ribbon ribbon-two" />
        <div className="nis-lockup">
          <div className="nis-emblem"><span>NIS</span><i /></div>
          <div className="nis-school-name">NATIONAL<br/>INTERNATIONAL<br/>SCHOOLS</div>
        </div>
        <div className="showcase-copy">
          <span className="showcase-kicker">NIS • PHYSICAL EDUCATION</span>
          <h2>Move with purpose.<br/><em>Manage with excellence.</em></h2>
          <p>منصة موحدة لإدارة ومتابعة أدوات التربية الرياضية في جميع فروع مدارس NIS.</p>
        </div>
        <div className="sports-stage" aria-hidden="true">
          <div className="sport-orbit orbit-a"/><div className="sport-orbit orbit-b"/>
          <div className="sport-ball ball-football">⚽</div><div className="sport-ball ball-basket">🏀</div>
          <div className="sport-ball ball-volley">🏐</div><div className="sport-ball ball-tennis">🎾</div>
          <div className="sport-trophy">🏆</div>
        </div>
        <div className="showcase-footer"><span>MANAGE</span><b>•</b><span>TRACK</span><b>•</b><span>ACHIEVE</span></div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="login-card-brand"><div className="login-logo"><Boxes size={27}/></div><span>WELCOME TO</span></div>
          <div className="eyebrow">NIS • PHYSICAL EDUCATION</div>
          <h1>NIS <em>SportTrack</em></h1>
          <p>Physical Education Equipment Management System</p>
          <div className="login-divider"><span/></div>
          <h2>تسجيل الدخول</h2>
          <p className="login-intro">سجّل الدخول لمتابعة وإدارة مخزون أدوات التربية الرياضية.</p>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={onSubmit}>
            <label className="field">البريد الإلكتروني<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@school.com"/></label>
            <label className="field">كلمة المرور<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></label>
            <button className="button button-primary login-button" disabled={loading}>{loading ? 'جارٍ الدخول...' : 'دخول إلى النظام'} <span>←</span></button>
          </form>
          <small className="login-note">يتم إنشاء الحسابات وإدارة صلاحياتها بواسطة مسؤول النظام.</small>
          <div className="login-signature">NIS PE DEPARTMENT <span>•</span> STRONGER TOGETHER</div>
        </div>
      </section>
    </div>
  )
}

function SetupScreen() {
  return <div className="login-screen"><div className="login-card"><div className="login-logo"><Boxes size={30}/></div><div className="eyebrow">NIS • PHYSICAL EDUCATION</div><h1>NIS SportTrack</h1><p>المنصة جاهزة للاتصال بقاعدة بيانات Supabase.</p><div className="setup-steps"><strong>خطوات الإعداد:</strong><ol><li>أنشئ مشروع Supabase أو استخدم المشروع الحالي.</li><li>نفّذ ملف <code>supabase/schema.sql</code> من SQL Editor.</li><li>أضف متغيري البيئة في ملف <code>.env.local</code> ثم أعد تشغيل التطبيق.</li></ol></div><div className="alert alert-error">لم يتم ضبط بيانات الاتصال بعد.</div></div></div>
}

export default App
