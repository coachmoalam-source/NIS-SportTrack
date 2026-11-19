import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('NIS SportTrack render failure:', error, info?.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <main dir="rtl" style={{ minHeight: '100vh', padding: '28px 18px', background: '#f4f7fb', color: '#102b46', fontFamily: 'Tahoma, sans-serif' }}>
          <section style={{ maxWidth: 620, margin: '8vh auto', padding: 24, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, boxShadow: '0 12px 36px #102b4614' }}>
            <h2 style={{ marginTop: 0 }}>تعذر تشغيل NIS SportTrack</h2>
            <p>حدث خطأ أثناء تحميل واجهة النظام. بيانات المخزون لم يتم تعديلها بواسطة هذه الرسالة.</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', direction: 'ltr', textAlign: 'left', padding: 14, borderRadius: 10, background: '#f8fafc', color: '#9f1239', fontSize: 12 }}>{String(this.state.error?.message || this.state.error)}</pre>
            <button onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, padding: '12px 18px', background: '#d7a94b', color: '#102b46', fontWeight: 700 }}>إعادة تحميل الصفحة</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(
  <React.StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </React.StrictMode>
)
