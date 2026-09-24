import React, { useEffect, useState } from 'react'
import { FolderOpen, Image, Moon, Save, Sun, Trash2, HardDriveDownload } from 'lucide-react'
import { useApp } from '../state/store'
import { call, errMsg } from '../lib/api'
import { Field, Spinner } from '../components/ui'
import { MONTHS } from '../lib/format'

export default function SettingsView(): React.JSX.Element {
  const { settings, saveSettings, notify, bump } = useApp()
  const [f, setF] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)

  useEffect(() => setF(settings), [settings])
  if (!f || !settings) return <Spinner label="Loading settings…" />

  const dirty = JSON.stringify(f) !== JSON.stringify(settings)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await saveSettings({
        orgName: f.orgName.trim(),
        currency: f.currency.trim() || 'Nu.',
        gstRatePercent: Number(f.gstRatePercent),
        footerText: f.footerText,
        theme: f.theme,
        autoCalcGst: f.autoCalcGst,
        defaultMonth: f.defaultMonth,
        defaultYear: f.defaultYear
      })
      notify('Settings saved.', 'ok')
      bump()
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-[860px] flex flex-col gap-4">
      <div className="card p-5">
        <div className="panel-title mb-4">Organization & documents</div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">
          <Field label="Organization name" hint="Printed at the top of every report">
            <input className="input" value={f.orgName} onChange={(e) => setF({ ...f, orgName: e.target.value })} />
          </Field>
          <Field label="Organization logo">
            <div className="flex items-center gap-2">
              <button
                className="btn"
                disabled={logoBusy}
                onClick={async () => {
                  setLogoBusy(true)
                  try {
                    await call(window.api.settings.pickLogo())
                    notify('Logo updated.', 'ok')
                    bump()
                  } catch (err) {
                    notify(errMsg(err), 'err')
                  } finally {
                    setLogoBusy(false)
                  }
                }}
              >
                <Image size={14} /> Choose image…
              </button>
              {settings.orgLogoPath && (
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      await call(window.api.settings.removeLogo())
                      bump()
                    } catch (err) {
                      notify(errMsg(err), 'err')
                    }
                  }}
                >
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
            <div className="text-[11.5px] mt-1 truncate" style={{ color: 'var(--mut)' }}>
              {settings.orgLogoPath ? `Stored in the app data folder` : 'No logo selected (optional)'}
            </div>
          </Field>
          <Field label="Report footer text" hint="Small note printed under the table">
            <textarea className="textarea" rows={2} value={f.footerText} onChange={(e) => setF({ ...f, footerText: e.target.value })} />
          </Field>
          <Field label="Default export folder" hint="Suggested location when saving .xlsx / .pdf reports">
            <div className="flex gap-2">
              <input className="input" readOnly placeholder="(system documents folder)" value={f.exportFolder ?? ''} />
              <button
                className="btn shrink-0"
                onClick={async () => {
                  try {
                    await call(window.api.settings.pickExportFolder())
                    bump()
                  } catch (err) {
                    notify(errMsg(err), 'err')
                  }
                }}
              >
                <FolderOpen size={14} /> Browse…
              </button>
            </div>
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <div className="panel-title mb-4">Billing defaults</div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">
          <Field label="Default currency prefix">
            <input className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} />
          </Field>
          <Field label="Default GST rate (%)" hint="Used for auto-calculation when GST is missing in the PDF">
            <input
              className="input mono"
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={f.gstRatePercent}
              onChange={(e) => setF({ ...f, gstRatePercent: Number(e.target.value) })}
            />
          </Field>
          <Field label="Default billing month (prefills the header picker — nothing is created automatically)">
            <select className="select" value={f.defaultMonth ?? ''} onChange={(e) => setF({ ...f, defaultMonth: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Current month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Default billing year">
            <select className="select" value={f.defaultYear ?? ''} onChange={(e) => setF({ ...f, defaultYear: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Current year</option>
              {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2.5 text-[13.5px] cursor-pointer">
            <input type="checkbox" checked={f.autoCalcGst} onChange={(e) => setF({ ...f, autoCalcGst: e.target.checked })} />
            Auto-calculate GST when it is missing from the bill
          </label>
        </div>
      </div>

      <div className="card p-5">
        <div className="panel-title mb-4">Appearance & storage</div>
        <div className="flex items-center gap-2 mb-4">
          <span className="label mr-2" style={{ marginBottom: 0 }}>Application theme</span>
          <button className={`btn ${f.theme === 'light' ? 'btn-primary' : ''}`} onClick={() => setF({ ...f, theme: 'light' })}><Sun size={14} /> Light</button>
          <button className={`btn ${f.theme === 'dark' ? 'btn-primary' : ''}`} onClick={() => setF({ ...f, theme: 'dark' })}><Moon size={14} /> Dark</button>
        </div>
        <div className="text-[12.5px] leading-relaxed flex items-start gap-2" style={{ color: 'var(--mut)' }}>
          <HardDriveDownload size={15} style={{ marginTop: 1, flexShrink: 0 }} />
          All data (database, copied PDFs, settings, logo) is stored in the Windows application-data folder for this app
          (<code>%APPDATA%\Postpaid Bill Summary Manager</code>). Nothing is uploaded — the application works completely offline.
          Deleting the app also gives you the choice of keeping this data.
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Spinner label="Saving…" /> : <><Save size={14} /> Save settings</>}
        </button>
        {dirty && <span className="text-[12px]" style={{ color: 'var(--warn)' }}>Unsaved changes</span>}
      </div>
    </div>
  )
}
