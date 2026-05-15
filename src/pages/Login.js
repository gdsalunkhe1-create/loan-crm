/* eslint-disable */
import { useState } from 'react'
import { supabase } from '../supabase'
import {
  IconUsers, IconPhoneIncoming, IconChartBar,
  IconMail, IconLock, IconShieldCheck, IconPhone
} from '@tabler/icons-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const features = [
    {
      icon: <IconUsers size={18} color="white" strokeWidth={1.8}/>,
      title: 'Lead Management',
      desc: 'Track and manage all your loan leads in one place'
    },
    {
      icon: <IconPhoneIncoming size={18} color="white" strokeWidth={1.8}/>,
      title: 'Call Logs',
      desc: 'Log every call with dispositions and follow-ups'
    },
    {
      icon: <IconChartBar size={18} color="white" strokeWidth={1.8}/>,
      title: 'Reports & Analytics',
      desc: 'Real-time performance reports for your team'
    },
  ]

  return (
    <div style={{
      display:'flex',
      minHeight:'100vh',
      fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      <style>
        {`
          .mobile-brand { display: none; }
          @media (max-width: 768px) {
            .left-panel { display: none !important; }
            .right-panel { padding: 24px !important; width: 100% !important; min-height: 100vh !important; }
            .right-panel > div { max-width: 100% !important; width: 100% !important; margin: 0 auto !important; }
            .mobile-brand { display: flex !important; align-items: center !important; gap: 12px !important; margin-bottom: 24px !important; }
            .login-input { padding: 16px 16px 16px 44px !important; min-height: 52px !important; font-size: 16px !important; }
            .login-button { padding: 16px !important; min-height: 52px !important; font-size: 16px !important; width: 100% !important; }
            .login-heading { font-size: 24px !important; }
            .login-subheading { font-size: 16px !important; }
            .right-panel { justify-content: flex-start !important; }
            .right-panel form { width: 100% !important; }
          }
        `}
      </style>

      {/* LEFT PANEL */}
      <div className="left-panel" style={{
        width:'42%',
        minWidth:'380px',
        background:'#185FA5',
        display:'flex',
        flexDirection:'column',
        padding:'48px 52px',
        position:'relative',
        overflow:'hidden'
      }}>

        {/* Background decoration circles */}
        <div style={{
          position:'absolute',top:'-80px',right:'-80px',
          width:'300px',height:'300px',borderRadius:'50%',
          background:'rgba(255,255,255,0.04)',pointerEvents:'none'
        }}/>
        <div style={{
          position:'absolute',bottom:'-60px',left:'-60px',
          width:'250px',height:'250px',borderRadius:'50%',
          background:'rgba(255,255,255,0.04)',pointerEvents:'none'
        }}/>

        {/* Logo + Brand */}
        <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'64px'}}>
          <div style={{
            width:'36px',height:'36px',
            background:'rgba(255,255,255,0.15)',
            borderRadius:'10px',
            display:'flex',alignItems:'center',justifyContent:'center',
            backdropFilter:'blur(4px)'
          }}>
            <IconPhone size={18} color="white" strokeWidth={2}/>
          </div>
          <span style={{
            color:'white',fontSize:'18px',fontWeight:'600',letterSpacing:'-0.3px'
          }}>
            CALL-Q PRO CRM
          </span>
        </div>

        {/* Headline */}
        <div style={{flex:1}}>
          <h1 style={{
            color:'white',
            fontSize:'32px',
            fontWeight:'700',
            lineHeight:'1.25',
            letterSpacing:'-0.5px',
            marginBottom:'16px'
          }}>
            Close more deals.<br/>Track every call.
          </h1>
          <p style={{
            color:'rgba(255,255,255,0.65)',
            fontSize:'15px',
            lineHeight:'1.6',
            marginBottom:'48px',
            maxWidth:'320px'
          }}>
            The complete CRM for personal loan sales teams — built for speed, built for results.
          </p>

          {/* Feature highlights */}
          <div style={{display:'flex',flexDirection:'column',gap:'20px'}}>
            {features.map((f,i)=>(
              <div key={i} style={{display:'flex',alignItems:'flex-start',gap:'14px'}}>
                <div style={{
                  width:'36px',height:'36px',borderRadius:'8px',
                  background:'rgba(255,255,255,0.12)',
                  display:'flex',alignItems:'center',justifyContent:'center',
                  flexShrink:0,marginTop:'1px'
                }}>
                  {f.icon}
                </div>
                <div>
                  <div style={{
                    color:'white',fontSize:'14px',fontWeight:'600',marginBottom:'3px'
                  }}>
                    {f.title}
                  </div>
                  <div style={{
                    color:'rgba(255,255,255,0.55)',fontSize:'13px',lineHeight:'1.5'
                  }}>
                    {f.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom note */}
        <div style={{
          marginTop:'48px',
          paddingTop:'24px',
          borderTop:'1px solid rgba(255,255,255,0.1)',
          color:'rgba(255,255,255,0.4)',
          fontSize:'12px'
        }}>
          © 2026 CALL-Q PRO CRM · Personal Loan Sales Platform
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="right-panel" style={{
        flex:1,
        background:'white',
        display:'flex',
        alignItems:'center',
        justifyContent:'center',
        padding:'48px',
      }}>
        <div style={{width:'100%',maxWidth:'380px'}}>

          <div className="mobile-brand" style={{display:'none'}}>
            <div style={{width:42,height:42,borderRadius:12,background:'#185FA5',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:20,fontWeight:700}}>
              Q
            </div>
            <div>
              <div style={{fontSize:18,fontWeight:700,color:'#111827',letterSpacing:'-0.4px'}}>CALL-Q PRO CRM</div>
              <div style={{fontSize:14,color:'#6B7280'}}>Agent Login</div>
            </div>
          </div>

          {/* Heading */}
          <div style={{marginBottom:'36px'}}>
            <h2 className="login-heading" style={{
              fontSize:'26px',fontWeight:'700',color:'#111827',
              letterSpacing:'-0.4px',marginBottom:'8px'
            }}>
              Welcome back
            </h2>
            <p className="login-subheading" style={{fontSize:'14px',color:'#9CA3AF'}}>
              Sign in to your CALL-Q PRO CRM account
            </p>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background:'#FFF5F5',border:'1px solid #FED7D7',
              borderRadius:'8px',padding:'12px 14px',
              marginBottom:'20px',fontSize:'13px',color:'#A32D2D',
              display:'flex',alignItems:'center',gap:'8px'
            }}>
              <span style={{flexShrink:0}}>⚠️</span> {error}
            </div>
          )}

          <form onSubmit={handleLogin}>

            {/* Email input */}
            <div style={{marginBottom:'16px'}}>
              <label style={{
                display:'block',fontSize:'13px',fontWeight:'600',
                color:'#374151',marginBottom:'7px'
              }}>
                Email address
              </label>
              <div style={{position:'relative'}}>
                <div style={{
                  position:'absolute',left:'13px',top:'50%',
                  transform:'translateY(-50%)',
                  color:'#9CA3AF',pointerEvents:'none',
                  display:'flex',alignItems:'center'
                }}>
                  <IconMail size={16} strokeWidth={1.8}/>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={e=>setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="login-input"
                  style={{
                    width:'100%',
                    padding:'11px 14px 11px 40px',
                    border:'1.5px solid #E5E7EB',
                    borderRadius:'8px',
                    fontSize:'14px',
                    color:'#111827',
                    outline:'none',
                    transition:'border-color 0.15s',
                    boxSizing:'border-box'
                  }}
                  onFocus={e=>e.target.style.borderColor='#185FA5'}
                  onBlur={e=>e.target.style.borderColor='#E5E7EB'}
                />
              </div>
            </div>

            {/* Password input */}
            <div style={{marginBottom:'12px'}}>
              <label style={{
                display:'block',fontSize:'13px',fontWeight:'600',
                color:'#374151',marginBottom:'7px'
              }}>
                Password
              </label>
              <div style={{position:'relative'}}>
                <div style={{
                  position:'absolute',left:'13px',top:'50%',
                  transform:'translateY(-50%)',
                  color:'#9CA3AF',pointerEvents:'none',
                  display:'flex',alignItems:'center'
                }}>
                  <IconLock size={16} strokeWidth={1.8}/>
                </div>
                <input
                  type={showPassword?'text':'password'}
                  value={password}
                  onChange={e=>setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                  className="login-input"
                  style={{
                    width:'100%',
                    padding:'11px 14px 11px 40px',
                    border:'1.5px solid #E5E7EB',
                    borderRadius:'8px',
                    fontSize:'14px',
                    color:'#111827',
                    outline:'none',
                    transition:'border-color 0.15s',
                    boxSizing:'border-box'
                  }}
                  onFocus={e=>e.target.style.borderColor='#185FA5'}
                  onBlur={e=>e.target.style.borderColor='#E5E7EB'}
                />
                <button
                  type="button"
                  onClick={()=>setShowPassword(!showPassword)}
                  style={{
                    position:'absolute',right:'12px',top:'50%',
                    transform:'translateY(-50%)',
                    background:'none',border:'none',cursor:'pointer',
                    color:'#9CA3AF',fontSize:'12px',fontWeight:'500',
                    padding:'2px 4px'
                  }}>
                  {showPassword?'Hide':'Show'}
                </button>
              </div>
            </div>

            {/* Forgot password */}
            <div style={{textAlign:'right',marginBottom:'24px'}}>
              <span style={{
                fontSize:'13px',color:'#185FA5',
                cursor:'pointer',fontWeight:'500'
              }}>
                Forgot password?
              </span>
            </div>

            {/* Sign in button */}
            <button
              type="submit"
              disabled={loading}
              className="login-button"
              style={{
                width:'100%',
                padding:'12px',
                background: loading ? '#93C5FD' : '#185FA5',
                color:'white',
                border:'none',
                borderRadius:'8px',
                fontSize:'15px',
                fontWeight:'600',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition:'background 0.15s',
                marginBottom:'24px',
                letterSpacing:'-0.1px'
              }}
              onMouseEnter={e=>{ if(!loading) e.target.style.background='#1251891' }}
              onMouseLeave={e=>{ if(!loading) e.target.style.background='#185FA5' }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>

            {/* Security notice */}
            <div style={{
              display:'flex',alignItems:'flex-start',gap:'10px',
              padding:'13px 14px',
              background:'#F9FAFB',
              border:'1px solid #F3F4F6',
              borderRadius:'8px',
            }}>
              <div style={{color:'#185FA5',flexShrink:0,marginTop:'1px'}}>
                <IconShieldCheck size={16} strokeWidth={1.8}/>
              </div>
              <p style={{
                fontSize:'12px',color:'#6B7280',lineHeight:'1.5',margin:0
              }}>
                Your data is protected with enterprise-grade encryption. We never share your information.
              </p>
            </div>

          </form>
        </div>
      </div>
    </div>
  )
}