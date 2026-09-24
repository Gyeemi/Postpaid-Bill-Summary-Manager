/**
 * Secure sign-in gate. Credentials are verified in the MAIN process
 * (bcrypt against the SQLite `users` table); this component only collects
 * them and shows the outcome — no password ever reaches the database or the
 * renderer's storage in clear text.
 */
import React, { useState } from 'react'
import { ShieldCheck, LogIn, Lock, User as UserIcon, WifiOff } from 'lucide-react'
import { useApp } from '../state/store'
import { errMsg } from '../lib/api'

export default function LoginView(): React.JSX.Element {
  const { signIn } = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await signIn(username.trim(), password)
      setPassword('')
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="h-full w-full flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #16324f 0%, #0f2438 55%, #0b1a2b 100%)' }}
    >
      <div className="w-full" style={{ maxWidth: 880 }}>
        <div className="grid gap-0 rounded-2xl overflow-hidden shadow-2xl" style={{ gridTemplateColumns: '1.05fr 1fr' }}>
          {/* brand side */}
          <div className="p-8 flex flex-col justify-between text-[#dbe7f5]" style={{ background: '#122c47' }}>
            <div>
              <div className="flex items-center gap-3">
                <div className="rounded-xl flex items-center justify-center" style={{ width: 44, height: 44, background: '#2f6db3' }}>
                  <ShieldCheck size={24} color="#fff" />
                </div>
                <div>
                  <div className="font-bold text-[17px] leading-tight text-white">Postpaid Bill</div>
                  <div className="font-bold text-[17px] leading-tight text-white">Summary Manager</div>
                </div>
              </div>
              <p className="mt-6 text-[13px] leading-relaxed" style={{ color: '#a9c4e0' }}>
                Sign in to open the billing workspace. Bills, employee records and saved reports stay on this computer —
                the database is locked until you authenticate.
              </p>
              <ul className="mt-5 flex flex-col gap-2 text-[12.5px]" style={{ color: '#8fb0d4' }}>
                <li className="flex items-center gap-2"><Lock size={14} /> Passwords stored as bcrypt hashes (never plain text)</li>
                <li className="flex items-center gap-2"><ShieldCheck size={14} /> Administrator &amp; Standard User roles</li>
                <li className="flex items-center gap-2"><WifiOff size={14} /> 100% offline — no cloud, no internet</li>
              </ul>
            </div>
            <div className="mt-8 text-[11.5px]" style={{ color: '#7e9cc0' }}>
              v1.0.0 · local SQLite database
            </div>
          </div>

          {/* form side */}
          <div className="p-8" style={{ background: '#ffffff' }}>
            <h1 className="text-[19px] font-bold m-0" style={{ color: '#16324f' }}>Sign in</h1>
            <p className="mt-1 text-[12.5px]" style={{ color: '#5b6b80' }}>
              Enter your username and password to continue.
            </p>

            <form id="login-form" className="mt-6 flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
              <label className="block">
                <span className="label">Username</span>
                <div className="relative">
                  <UserIcon size={15} style={{ position: 'absolute', left: 10, top: 11, color: '#8b98ab' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 32 }}
                    name="username"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. admin"
                  />
                </div>
              </label>

              <label className="block">
                <span className="label">Password</span>
                <div className="relative">
                  <Lock size={15} style={{ position: 'absolute', left: 10, top: 11, color: '#8b98ab' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 32 }}
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              </label>

              {error && (
                <div
                  className="login-error rounded-lg px-3 py-2 text-[12.5px] flex items-start gap-2"
                  style={{ background: '#fdeaea', color: '#9d2222', border: '1px solid #f3c7c7' }}
                  role="alert"
                >
                  <Lock size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}

              <button className="btn btn-primary justify-center" type="submit" disabled={busy || !username || !password}>
                <LogIn size={15} /> {busy ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 text-[11.5px] leading-relaxed" style={{ color: '#8b98ab' }}>
              Accounts are managed locally by your administrator. Contact them if you have forgotten your password.
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-[11.5px]" style={{ color: '#7e9cc0' }}>
          Access is required before any billing, directory or report data can be read or changed.
        </div>
      </div>
    </div>
  )
}
