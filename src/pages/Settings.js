/* eslint-disable */
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { IconSettings, IconBuildingStore, IconDeviceMobile } from '@tabler/icons-react'

export default function Settings() {
  const [settings, setSettings] = useState({
    crm_name: 'CALL-Q PRO CRM',
    crm_tagline: 'Personal Loan Sales Platform',
    company_name: 'Capital Volts Financial Services',
  })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { fetchSettings() }, [])

  const fetchSettings = async () => {
    const { data } = await supabase.from('settings').select('*')
    if (data) {
      const obj = {}
      data.forEach(s => { obj[s.key] = s.value })
      setSettings(prev => ({...prev, ...obj}))
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setLoading(true)
    await Promise.all(
      Object.entries(settings).map(([key,value]) =>
        supabase.from('settings').upsert({key, value, updated_at: new Date().toISOString()}, {onConflict:'key'})
      )
    )
    setLoading(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <IconSettings size={22} strokeWidth={1.6}/> Settings
          </h1>
          <p>Customize your CRM name and branding</p>
        </div>
      </div>
      <div className="page-body">

        <div className="card" style={{maxWidth:'580px',marginBottom:'20px'}}>
          <div className="card-header">
            <h3 style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <IconBuildingStore size={18} strokeWidth={1.6}/> Branding Settings
            </h3>
          </div>
          <div className="card-body">
            <form onSubmit={handleSave}>
              {[
                {key:'crm_name', label:'CRM Name', ph:'e.g. CALL-Q PRO CRM', help:'Appears in sidebar and login page'},
                {key:'crm_tagline', label:'Tagline', ph:'e.g. Personal Loan Sales Platform', help:'Shown below the CRM name'},
                {key:'company_name', label:'Company Name', ph:'e.g. Capital Volts Financial Services', help:'Your company name'},
              ].map(f=>(
                <div className="form-group" key={f.key}>
                  <label className="form-label">{f.label}</label>
                  <input type="text" className="form-input"
                    value={settings[f.key]||''}
                    onChange={e=>setSettings({...settings,[f.key]:e.target.value})}
                    placeholder={f.ph}/>
                  <p style={{fontSize:'12px',color:'#A0AEC0',marginTop:'5px'}}>{f.help}</p>
                </div>
              ))}
              {saved && (
                <div style={{background:'#F0FFF4',border:'0.5px solid #9AE6B4',borderRadius:'8px',padding:'11px 14px',marginBottom:'16px',fontSize:'13px',color:'#276749',fontWeight:'500'}}>
                  ✅ Settings saved successfully! Refresh the page to see changes.
                </div>
              )}
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading?'Saving...':'Save Settings'}
              </button>
            </form>
          </div>
        </div>

        <div className="card" style={{maxWidth:'580px'}}>
          <div className="card-header">
            <h3 style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <IconDeviceMobile size={18} strokeWidth={1.6}/> Mobile Access
            </h3>
          </div>
          <div className="card-body">
            {[
              {icon:'🌐', title:'Web App', desc:'Works on all browsers on desktop and mobile. Share the URL with your team.'},
              {icon:'📱', title:'Mobile Browser', desc:'Team members can open the CRM on their phone browser — fully functional.'},
              {icon:'📲', title:'Install as App', desc:'On mobile, tap "Add to Home Screen" in browser to install as an app icon on the phone.'},
            ].map(item=>(
              <div key={item.title} style={{display:'flex',gap:'14px',padding:'13px',background:'#F7FAFC',borderRadius:'10px',marginBottom:'10px'}}>
                <div style={{fontSize:'26px',flexShrink:0}}>{item.icon}</div>
                <div>
                  <div style={{fontWeight:'600',fontSize:'14px',color:'#2D3748',marginBottom:'3px'}}>{item.title}</div>
                  <div style={{fontSize:'13px',color:'#718096'}}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}