# NIS SportTrack

منصة ويب لإدارة ومتابعة أدوات التربية الرياضية في فروع NIS، مع صلاحيات منفصلة لكل فرع ولوحة متابعة مركزية.

## الفروع الحالية
- El Shorouk
- O West
- New Capital
- El Tagamoa
- Porto Said

## الوظائف في النسخة الأولى
- تسجيل دخول بالبريد الإلكتروني وكلمة المرور عبر Supabase Auth.
- مسؤول مركزي يستطيع متابعة جميع الفروع.
- مسؤول فرع يستطيع متابعة وإدارة مخزون فرعه فقط.
- تسجيل الأصناف والكود والتصنيف والكمية والتالف والمفقود والوحدة والصورة والملاحظات.
- البحث والتصفية حسب الفرع والتصنيف.
- مؤشرات إجمالي الأصناف والكميات والمتاح والتالف والمفقود.
- حماية البيانات بسياسات Supabase Row Level Security.

## إعداد قاعدة البيانات
1. افتح مشروع Supabase ثم SQL Editor.
2. انسخ ونفّذ محتوى الملف `supabase/schema.sql`.
3. من Authentication > Users أنشئ حسابات المستخدمين.
4. أضف صفًا لكل مستخدم في جدول `profiles` وحدد دوره والفرع المرتبط به.
5. أنشئ أول مستخدم بدور `central_admin` باستخدام UUID الخاص به من Authentication > Users.

الأدوار:
- `central_admin`: متابعة وإدارة كل الفروع والمستخدمين والأصناف.
- `branch_admin`: إدارة أصناف فرعه فقط.
- `viewer`: قراءة بيانات فرعه فقط.

## التشغيل محليًا
يتطلب Node.js 20 أو أحدث.

```bash
npm install
cp .env.example .env.local
```

ضع رابط مشروع Supabase ومفتاح Publishable/Anon في `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

ثم:

```bash
npm run dev
```

إنشاء نسخة الإنتاج:

```bash
npm run build
```

## النشر على Cloudflare Pages
- Framework preset: Vite
- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`

أضف متغيري البيئة التاليين في Cloudflare Pages > Settings > Environment variables لكل من Production وPreview:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## ملاحظات أمنية وحدود النسخة الحالية
- لا تضع مفتاح `service_role` أو أي مفتاح سري داخل كود الواجهة أو متغيرات `VITE_*`.
- صلاحيات الوصول الفعلية تفرضها سياسات RLS في قاعدة البيانات، وليس إخفاء عناصر الواجهة فقط.
- سجل الحركات التفصيلي موجود في قاعدة البيانات، لكن واجهته لم تُنفّذ بعد.
- حقل الصورة في هذه النسخة يقبل رابط صورة؛ رفع الملفات إلى Supabase Storage سيتم ربطه في مرحلة لاحقة.
