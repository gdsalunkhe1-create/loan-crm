/* eslint-disable */
import React, { useState } from "react";
import { Calculator, Upload, FileText, IndianRupee, Info, Loader2, CheckCircle2 } from "lucide-react";

/*
  CALL-Q PRO CRM — Income Tax + Net Take-Home Calculator (New Regime)
  FY 2025-26 / FY 2026-27 (Budget 2026 kept slabs unchanged)

  Gives the EXACT net take-home the way a payslip works:
   - Annual income tax is computed on FULL income (regular salary + bonus)
   - Regular monthly take-home reflects only the regular salary's tax
   - Bonus (and its extra tax) is shown separately as a one-time item

  All inputs are ANNUAL. Upload mode auto-fills them from a CTC letter or payslip
  (payslip monthly figures are annualised x12 by the extractor).

  NEW REGIME rules:
   - Standard deduction Rs 75,000 (salaried)
   - Employer NPS 80CCD(2) deductible up to 14% of basic (only investment-linked deduction)
   - Slabs: 0-4L nil / 4-8L 5% / 8-12L 10% / 12-16L 15% / 16-20L 20% / 20-24L 25% / >24L 30%
   - 87A rebate: nil tax up to Rs 12L taxable, marginal relief just above
   - Surcharge 10/15/25% (>50L/1Cr/2Cr, capped 25%), Cess 4%
   Note: 80C, 80D, HRA and personal investments do NOT reduce tax in the new regime.

  PRODUCTION NOTE: the upload extractor calls the Anthropic API directly so it works
  in preview. In the CRM, point that fetch at your serverless proxy (e.g. /api/assist)
  so the API key stays server-side.
*/

const BRAND = "#185FA5";
const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

function taxNewRegime(taxable) {
  const slabs = [[400000,0],[800000,0.05],[1200000,0.1],[1600000,0.15],[2000000,0.2],[2400000,0.25],[Infinity,0.3]];
  let slabTax = 0, lo = 0;
  const breakup = [];
  for (const [up, rate] of slabs) {
    if (taxable > lo) {
      const amt = Math.min(taxable, up) - lo;
      const t = amt * rate;
      slabTax += t;
      if (amt > 0 && rate > 0) breakup.push({ from: lo, to: up === Infinity ? null : up, rate, tax: t });
    }
    lo = up;
    if (taxable <= up) break;
  }
  const afterRebate = taxable <= 1200000 ? 0 : Math.min(slabTax, taxable - 1200000);
  let sr = 0;
  if (taxable > 20000000) sr = 0.25; else if (taxable > 10000000) sr = 0.15; else if (taxable > 5000000) sr = 0.1;
  const surcharge = afterRebate * sr;
  const cess = (afterRebate + surcharge) * 0.04;
  return { taxable, slabTax, breakup, afterRebate, surcharge, surchargeRate: sr, cess, total: afterRebate + surcharge + cess, rebated: taxable <= 1200000 && slabTax > 0 };
}

function compute({ regular, bonus, basic, employerNPS, empPF, profTax }) {
  const nps = Math.min(employerNPS || 0, basic > 0 ? basic * 0.14 : (employerNPS || 0));
  const stdDeduction = 75000;
  const taxableReg = Math.max(0, regular - stdDeduction - nps);
  const taxableTot = Math.max(0, regular + (bonus || 0) - stdDeduction - nps);
  const tReg = taxNewRegime(taxableReg);
  const tTot = taxNewRegime(taxableTot);
  const regularNetAnnual = regular - (empPF || 0) - (profTax || 0) - tReg.total;
  const netAnnual = regular + (bonus || 0) - (empPF || 0) - (profTax || 0) - tTot.total;
  return {
    nps, stdDeduction, tReg, tTot,
    annualTax: tTot.total,
    bonusTax: tTot.total - tReg.total,
    bonusNet: (bonus || 0) - (tTot.total - tReg.total),
    regularNetAnnual,
    regularNetMonthly: regularNetAnnual / 12,
    netAnnual,
    effRate: (regular + (bonus || 0)) > 0 ? (tTot.total / (regular + (bonus || 0))) * 100 : 0,
  };
}

export default function TaxCalculator() {
  const [mode, setMode] = useState("manual");
  const [regular, setRegular] = useState("");
  const [bonus, setBonus] = useState("");
  const [basic, setBasic] = useState("");
  const [employerNPS, setEmployerNPS] = useState("");
  const [empPF, setEmpPF] = useState("");
  const [profTax, setProfTax] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState("");
  const [extractErr, setExtractErr] = useState("");

  const nums = {
    regular: parseFloat(regular) || 0,
    bonus: parseFloat(bonus) || 0,
    basic: parseFloat(basic) || 0,
    employerNPS: parseFloat(employerNPS) || 0,
    empPF: parseFloat(empPF) || 0,
    profTax: parseFloat(profTax) || 0,
  };
  const r = nums.regular > 0 ? compute(nums) : null;

  const toBase64 = (file) => new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(",")[1]);
    reader.onerror = () => rej(new Error("read failed"));
    reader.readAsDataURL(file);
  });

  const handleUpload = async (file) => {
    if (!file) return;
    setExtractErr(""); setExtractMsg(""); setExtracting(true);
    try {
      const data = await toBase64(file);
      const isPdf = file.type === "application/pdf";
      const docBlock = isPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data } };
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: [docBlock, { type: "text", text:
            "This is an Indian CTC letter or salary payslip. Return ONLY JSON (no markdown): " +
            '{"regularGrossAnnual":<number>,"bonusAnnual":<number>,"basicAnnual":<number>,"employerNPSAnnual":<number>,"employeePFAnnual":<number>,"professionalTaxAnnual":<number>}. ' +
            "regularGrossAnnual = annual gross salary EXCLUDING any one-time bonus (Basic+HRA+allowances). " +
            "bonusAnnual = one-time/annual bonus or incentive (0 if none). basicAnnual = annual basic pay. " +
            "employerNPSAnnual = employer NPS per year (0 if none). employeePFAnnual = employee PF deduction per year. " +
            "professionalTaxAnnual = professional tax per year. If a value is monthly, multiply by 12. Use 0 for anything not found." }] }],
        }),
      });
      const out = await res.json();
      const text = (out.content || []).filter((i) => i.type === "text").map((i) => i.text).join("");
      const p = JSON.parse(text.replace(/```json|```/g, "").trim());
      if (p.regularGrossAnnual) setRegular(String(Math.round(p.regularGrossAnnual)));
      if (p.bonusAnnual) setBonus(String(Math.round(p.bonusAnnual)));
      if (p.basicAnnual) setBasic(String(Math.round(p.basicAnnual)));
      if (p.employerNPSAnnual) setEmployerNPS(String(Math.round(p.employerNPSAnnual)));
      if (p.employeePFAnnual) setEmpPF(String(Math.round(p.employeePFAnnual)));
      if (p.professionalTaxAnnual) setProfTax(String(Math.round(p.professionalTaxAnnual)));
      setExtractMsg("Extracted — please review each value below and correct if needed.");
    } catch (e) {
      setExtractErr("Couldn't read that document. Please enter the figures manually.");
    } finally { setExtracting(false); }
  };

  const label = { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6, display: "block" };
  const input = { width: "100%", padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" };
  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20 };

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "#e6f0fb", color: BRAND, display: "flex", alignItems: "center", justifyContent: "center" }}><Calculator size={22} /></div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Income Tax & Net Take-Home</h1>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "#64748b" }}>New Regime · FY 2025-26 & 2026-27</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "18px 0" }}>
        {[{ k: "manual", t: "Enter manually", icon: <IndianRupee size={15} /> }, { k: "upload", t: "Upload CTC / Payslip", icon: <Upload size={15} /> }].map((m) => (
          <button key={m.k} onClick={() => setMode(m.k)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", border: mode === m.k ? `1px solid ${BRAND}` : "1px solid #e2e8f0", background: mode === m.k ? BRAND : "#fff", color: mode === m.k ? "#fff" : "#334155" }}>{m.icon} {m.t}</button>
        ))}
      </div>

      {mode === "upload" && (
        <div style={{ ...card, marginBottom: 16, borderStyle: "dashed", textAlign: "center" }}>
          <FileText size={26} color={BRAND} />
          <p style={{ fontSize: 13, color: "#475569", margin: "8px 0 12px" }}>Upload a CTC letter or payslip (PDF or image). Figures auto-fill below for you to confirm.</p>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: BRAND, color: "#fff", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {extracting ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}{extracting ? "Reading…" : "Choose file"}
            <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => handleUpload(e.target.files?.[0])} disabled={extracting} />
          </label>
          {extractMsg && <div style={{ marginTop: 12, fontSize: 12, color: "#166534", display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}><CheckCircle2 size={14} /> {extractMsg}</div>}
          {extractErr && <div style={{ marginTop: 12, fontSize: 12, color: "#dc2626" }}>{extractErr}</div>}
        </div>
      )}

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <Field label="Regular Gross Annual (excl. bonus) *" val={regular} set={setRegular} ph="16,90,296" />
          <Field label="Annual Bonus / One-time" val={bonus} set={setBonus} ph="1,41,558" />
          <Field label="Annual Basic (for NPS cap)" val={basic} set={setBasic} ph="7,60,634" />
          <Field label="Employee PF (annual)" val={empPF} set={setEmpPF} ph="91,272" />
          <Field label="Professional Tax (annual)" val={profTax} set={setProfTax} ph="2,400" />
          <Field label="Employer NPS 80CCD(2) (annual)" val={employerNPS} set={setEmployerNPS} ph="0" />
        </div>
        <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 6, marginTop: 12 }}>
          <Info size={16} color="#94a3b8" style={{ flexShrink: 0 }} />
          <span>New regime allows only the ₹75,000 standard deduction and employer NPS. Bonus is taxed but kept out of the regular monthly figure. PF &amp; Professional Tax reduce take-home but are not income tax.</span>
        </div>
      </div>

      {r ? (
        <div style={{ ...card }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
            <Tile label="Net Monthly Take-Home (bonus excluded)" value={inr(r.regularNetMonthly)} big color="#166534" />
            <Tile label="Annual Income Tax (incl. bonus)" value={inr(r.annualTax)} big color="#dc2626" />
            <Tile label="Net Annual Take-Home (incl. bonus)" value={inr(r.netAnnual)} />
            <Tile label="Effective Tax Rate" value={r.effRate.toFixed(2) + "%"} />
          </div>

          <SectionTitle>Income tax (new regime)</SectionTitle>
          <div style={{ fontSize: 13 }}>
            <Row k="Regular gross salary" v={inr(nums.regular)} />
            {nums.bonus > 0 && <Row k="Bonus / one-time pay" v={inr(nums.bonus)} />}
            <Row k="Standard deduction" v={"– " + inr(r.stdDeduction)} />
            {r.nps > 0 && <Row k="Employer NPS 80CCD(2)" v={"– " + inr(r.nps)} />}
            <Row k="Taxable income (incl. bonus)" v={inr(r.tTot.taxable)} bold />
            <div style={{ height: 1, background: "#e2e8f0", margin: "8px 0" }} />
            {r.tTot.breakup.map((s, i) => (
              <Row key={i} k={`${inr(s.from)} – ${s.to ? inr(s.to) : "above"} @ ${s.rate * 100}%`} v={inr(s.tax)} sub />
            ))}
            <Row k="Tax as per slabs" v={inr(r.tTot.slabTax)} bold />
            {r.tTot.rebated && <Row k="Section 87A rebate (≤ ₹12L)" v={"– " + inr(r.tTot.slabTax)} green />}
            {r.tTot.surcharge > 0 && <Row k={`Surcharge (${r.tTot.surchargeRate * 100}%)`} v={"+ " + inr(r.tTot.surcharge)} />}
            <Row k="Health & Education cess (4%)" v={"+ " + inr(r.tTot.cess)} />
            <Row k="Total annual income tax" v={inr(r.annualTax)} bold />
          </div>

          <SectionTitle>Regular monthly take-home (bonus excluded)</SectionTitle>
          <div style={{ fontSize: 13 }}>
            <Row k="Regular gross ÷ 12" v={inr(nums.regular / 12)} />
            <Row k="Employee PF ÷ 12" v={"– " + inr(nums.empPF / 12)} />
            <Row k="Professional Tax ÷ 12" v={"– " + inr(nums.profTax / 12)} />
            <Row k="Income tax on regular salary ÷ 12" v={"– " + inr(r.tReg.total / 12)} />
            <div style={{ height: 1, background: "#e2e8f0", margin: "8px 0" }} />
            <Row k="Net monthly take-home" v={inr(r.regularNetMonthly)} bold green />
          </div>

          {nums.bonus > 0 && (
            <>
              <SectionTitle>Bonus (one-time, separate)</SectionTitle>
              <div style={{ fontSize: 13 }}>
                <Row k="Bonus amount" v={inr(nums.bonus)} />
                <Row k="Extra tax on bonus" v={"– " + inr(r.bonusTax)} />
                <Row k="Bonus received (net)" v={inr(r.bonusNet)} bold />
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Paid once, in the bonus month — not part of regular monthly salary.</div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ ...card, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Enter the regular gross annual salary to see the net take-home.</div>
      )}

      <style>{`.spin{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Field({ label, val, set, ph }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6, display: "block" }}>{label}</label>
      <input style={{ width: "100%", padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }} type="number" placeholder={ph} value={val} onChange={(e) => set(e.target.value)} />
    </div>
  );
}
function SectionTitle({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: BRAND, textTransform: "uppercase", letterSpacing: 0.5, margin: "18px 0 8px" }}>{children}</div>;
}
function Tile({ label, value, big, color }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: big ? 22 : 16, fontWeight: 700, color: color || "#0f172a", marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Row({ k, v, bold, sub, green }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: sub ? "3px 0 3px 12px" : "5px 0" }}>
      <span style={{ color: sub ? "#64748b" : green ? "#166534" : "#475569", fontSize: sub ? 12 : 13, fontWeight: bold ? 700 : 400 }}>{k}</span>
      <span style={{ fontWeight: bold ? 700 : green ? 600 : 500, color: green ? "#166534" : "#0f172a", fontSize: sub ? 12 : 13 }}>{v}</span>
    </div>
  );
}

