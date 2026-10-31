import { useEffect, useState } from 'react'
import { Camera, Download, Globe2, KeyRound, Save, ShieldCheck, UserRound, Database } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function Settings({ session, profile, isCentral, onError, onNotice, onProfileUpdated }) {
  const [language, setLanguage] = useState(() => localStorage.getItem('nis-language') || 'ar')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState('')

  const en = language === 'en'
  const t = (ar, english) => en ? english : ar

  useEffect(() => {
    localStorage.setItem('nis-language', language)
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  useEffect(() => {
    let alive = true
    const loadAvatar = async () => {
      const path = profile?.avatar_url
      if (!path) { setAvatarUrl(''); return }
      const { data } = await supabase.storage.from('nis-sporttrack-evidence').createSignedUrl(path, 3600)
      if (alive) setAvatarUrl(data?.signedUrl || '')
    }
    loadAvatar()
    return () => { alive = false }
  }, [profile?.avatar_url])

  const savePassword = async event => {
    event.preventDefault()
    onError('')
    if (password.length < 8) return onError(t('كلمة المرور يجب ألا تقل عن 8 أحرف.','Password must be at least 8 characters.'))
    if (password !== confirmPassword) return onError(t('تأكيد كلمة المرور غير مطابق.','Password confirmation does not match.'))
    setPasswordBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setPasswordBusy(false)
    if (error) onError(error.message)
    else { setPassword(''); setConfirmPassword(''); onNotice(t('تم تغيير كلمة المرور بنجاح.','Password updated successfully.')) }
  }

  const uploadAvatar = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    onError('')
    if (!file.type.startsWith('image/')) return onError(t('اختر ملف صورة صالحًا.','Choose a valid image file.'))
    if (file.size > 3 * 1024 * 1024) return onError(t('حجم الصورة يجب ألا يتجاوز 3 ميجابايت.','Image must be 3 MB or smaller.'))
    const folder = profile?.branch_id || 'profiles'
    const path = folder + '/profiles/' + session.user.id + '/avatar-' + Date.now() + '.' + (file.name.split('.').pop() || 'jpg')
    setAvatarBusy(true)
    const { error: uploadError } = await supabase.storage.from('nis-sporttrack-evidence').upload(path, file, { upsert: true, contentType: file.type })
    if (uploadError) { setAvatarBusy(false); return onError(uploadError.message) }
    const { error: updateError } = await supabase.from('profiles').update({ avatar_url: path }).eq('id', session.user.id)
    setAvatarBusy(false)
    if (updateError) return onError(updateError.message)
    onProfileUpdated({ ...profile, avatar_url: path })
    const { data } = await supabase.storage.from('nis-sporttrack-evidence').createSignedUrl(path, 3600)
    setAvatarUrl(data?.signedUrl || '')
    onNotice(t('تم تحديث الصورة الشخصية.','Profile photo updated.'))
  }

  const downloadBackup = async () => {
    onError('')
    setBackupBusy(true)
    const sections = ['inventory','inventory_movements','damage_reports','maintenance_requests','inventory_audits','inventory_audit_items']
    const backup = { system: 'NIS SportTrack', exported_at: new Date().toISOString(), branch: profile?.branch_id || 'all', data: {} }
    for (const table of sections) {
      let collected = []
      let start = 0
      while (true) {
        let query = supabase.from(table).select('*').range(start, start + 499)
        if (!isCentral && profile?.branch_id && ['inventory','inventory_movements','damage_reports','maintenance_requests','inventory_audits'].includes(table)) query = query.eq('branch_id', profile.branch_id)
        const { data, error } = await query
        if (error) {
          setBackupBusy(false)
          return onError(t('تعذر إكمال النسخة الاحتياطية: ','Backup could not be completed: ') + table + ' — ' + error.message)
        }
        collected = collected.concat(data || [])
        if (!data || data.length < 500) break
        start += 500
      }
      backup.data[table] = collected
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'NIS-SportTrack-Backup-' + (profile?.branch_id || 'ALL') + '-' + new Date().toISOString().slice(0,10) + '.json'
    link.click()
    URL.revokeObjectURL(url)
    setBackupBusy(false)
    onNotice(t('تم تنزيل النسخة الاحتياطية. احتفظ بها في مكان آمن.','Backup downloaded. Store it in a secure location.'))
  }

  return <section className="settings-page">
    <div className="settings-intro"><h2>{t('إعدادات الحساب والنظام','Account & System Settings')}</h2><p>{t('إدارة تفضيلات الحساب وأمانه والنسخ الاحتياطية.','Manage your account preferences, security and backups.')}</p></div>
    <div className="settings-grid">
      <article className="settings-card">
        <h3><Globe2 size={19}/>{t('لغة الصفحة','Page Language')}</h3>
        <p>{t('اختر اللغة المناسبة لواجهة النظام.','Choose your preferred interface language.')}</p>
        <div className="language-options">
          <button className={language==='ar'?'selected':''} onClick={()=>setLanguage('ar')}>العربية</button>
          <button className={language==='en'?'selected':''} onClick={()=>setLanguage('en')}>English</button>
        </div>
        <small>{t('يتم حفظ اختيار اللغة على هذا الجهاز.','Language preference is saved on this device.')}</small>
      </article>
      <article className="settings-card">
        <h3><UserRound size={19}/>{t('الصورة الشخصية','Profile Photo')}</h3>
        <div className="profile-photo-row">
          <div className="profile-photo">{avatarUrl?<img src={avatarUrl} alt="Profile"/>:<UserRound size={34}/>}</div>
          <label className="button button-light upload-avatar">{avatarBusy?t('جارٍ الرفع...','Uploading...'):t('إضافة / تغيير الصورة','Add / Change Photo')}<Camera size={16}/><input type="file" accept="image/*" onChange={uploadAvatar} disabled={avatarBusy}/></label>
        </div>
        <small>{t('صورة JPG أو PNG أو WEBP، بحد أقصى 3 ميجابايت.','JPG, PNG or WEBP, up to 3 MB.')}</small>
      </article>
      <article className="settings-card">
        <h3><KeyRound size={19}/>{t('تغيير كلمة المرور','Change Password')}</h3>
        <form className="settings-form" onSubmit={savePassword}>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={t('كلمة المرور الجديدة','New password')} minLength={8} required/>
          <input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder={t('تأكيد كلمة المرور','Confirm password')} minLength={8} required/>
          <button className="button button-primary" disabled={passwordBusy}>{passwordBusy?t('جارٍ الحفظ...','Saving...'):t('حفظ كلمة المرور','Save Password')}<Save size={16}/></button>
        </form>
      </article>
      <article className="settings-card backup-card">
        <h3><Database size={19}/>{t('النسخ الاحتياطي','Data Backup')}</h3>
        <p>{isCentral?t('تنزيل نسخة بيانات شاملة للنظام والفروع.':'Download a complete backup of system data and all branches.'):t('تنزيل نسخة من بيانات الفرع المرتبط بحسابك.','Download a backup of the branch assigned to your account.')}</p>
        <button className="button button-primary" onClick={downloadBackup} disabled={backupBusy}>{backupBusy?t('جارٍ تجهيز النسخة...','Preparing backup...'):t('تنزيل النسخة الاحتياطية','Download Backup')}<Download size={17}/></button>
        <small><ShieldCheck size={14}/>{t('النسخة بصيغة JSON وتشمل سجلات المخزون والحركة والبلاغات والصيانة والجرد المتاحة لصلاحيتك.','JSON backup includes inventory, movements, reports, maintenance and audit records permitted by your access.')}</small>
      </article>
    </div>
  </section>
}
