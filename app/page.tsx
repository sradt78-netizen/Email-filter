'use client';
import { useMemo, useState } from 'react';
import { Search, Download, Mail, Globe2, ShieldCheck, Users, Building2, UserRound, Loader2, CheckCircle2, AlertCircle, ExternalLink, MapPin, Activity, PauseCircle } from 'lucide-react';

type Lead={email:string;domain:string;source:string;title:string;status:'valid'|'unverified';reason:string};
type Page={url:string;title:string};
type JobState={pages:Page[];cursor:number;seen:string[];scanned:number;sourceCount:number;found:number};
type Progress={target:number;found:number;scanned:number;totalSources:number;processedPages:number;totalPages:number};
const COUNTRIES=['Worldwide','Nigeria','Ghana','Kenya','South Africa','Egypt','United States','Canada','United Kingdom','Ireland','Germany','France','Netherlands','Spain','Italy','Switzerland','Sweden','Norway','Denmark','Finland','Poland','Portugal','Belgium','Austria','Australia','New Zealand','India','Pakistan','Bangladesh','United Arab Emirates','Saudi Arabia','Qatar','Singapore','Malaysia','Indonesia','Philippines','Japan','South Korea','Brazil','Mexico','Argentina','Colombia','Turkey','Israel','Ukraine','Russia'];
export default function Home(){
 const [query,setQuery]=useState('');const [scope,setScope]=useState('both');const [country,setCountry]=useState('Worldwide');const [limit,setLimit]=useState('500');const [custom,setCustom]=useState('1000');
 const [rows,setRows]=useState<Lead[]>([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [searchNote,setSearchNote]=useState('');
 const [progress,setProgress]=useState<Progress>({target:0,found:0,scanned:0,totalSources:0,processedPages:0,totalPages:0});
 const [statusText,setStatusText]=useState('Ready to discover public contacts');const [filter,setFilter]=useState('all');
 const [jobState,setJobState]=useState<JobState|null>(null);
 const effectiveLimit=limit==='custom'?Number(custom):Number(limit);
 const visible=useMemo(()=>rows.filter(r=>filter==='all'||(filter==='valid'?r.status==='valid':r.status==='unverified')),[rows,filter]);
 const percent=progress.target?Math.min(100,Math.round(progress.found/progress.target*100)):0;
 function appendRows(next:Lead[]){if(!next?.length)return;setRows(prev=>{const existing=new Set(prev.map(x=>x.email));return [...prev,...next.filter(x=>!existing.has(x.email))]});}
 async function runExtraction(e?:React.FormEvent){
  e?.preventDefault();if(loading)return;
  if(!Number.isInteger(effectiveLimit)||effectiveLimit<1||effectiveLimit>10000){setError('Choose an amount between 1 and 10,000.');return;}
  setError('');setRows([]);setFilter('all');setSearchNote('');setJobState(null);setLoading(true);
  setProgress({target:effectiveLimit,found:0,scanned:0,totalSources:0,processedPages:0,totalPages:0});
  setStatusText('Searching public web indexes…');
  let state:JobState|null=null;let phase:'start'|'continue'='start';let keepGoing=true;
  try{
   while(keepGoing){
    const response: Response=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase,query,scope,country,limit:effectiveLimit,state})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Search failed');
    appendRows(data.results||[]);state=data.state||state;setJobState(state);
    if(data.progress)setProgress(data.progress);
    if(data.note)setSearchNote(data.note);
    keepGoing=!data.done&&!!state;
    phase='continue';
    if(keepGoing)setStatusText(`Scanning public pages… ${data.progress?.found||0} of ${effectiveLimit} found`);
    else setStatusText(data.progress?.found>=effectiveLimit?'Target reached. Extraction complete.':'Available public sources scanned. Extraction complete.');
   }
  }catch(err){setError(err instanceof Error?err.message:'Search failed');setStatusText('Extraction paused. You can resume the remaining pages.');}
  finally{setLoading(false);}
 }
 async function resumeExtraction(){
  if(loading||!jobState)return;
  setError('');setLoading(true);let state=jobState;
  try{
   while(state.cursor<state.pages.length&&rows.length<effectiveLimit){
    const response: Response=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:'continue',query,scope,country,limit:effectiveLimit,state})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Search failed');
    appendRows(data.results||[]);state=data.state;setJobState(state);if(data.progress)setProgress(data.progress);if(data.note)setSearchNote(data.note);
    if(data.done)break;setStatusText(`Resuming scan… ${data.progress?.found||0} of ${effectiveLimit} found`);
   }
   setStatusText('Extraction complete.');
  }catch(err){setError(err instanceof Error?err.message:'Resume failed');}
  finally{setLoading(false);}
 }
 function exportCsv(){const esc=(s:string)=>`"${String(s).replace(/"/g,'""')}"`;const csv=[['Email','Domain','MX status','Check details','Source URL'],...visible.map(r=>[r.email,r.domain,r.status==='valid'?'MX found — mailbox unconfirmed':'Not confirmed',r.reason,r.source])].map(row=>row.map(esc).join(',')).join('\\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='opencontact-leads.csv';a.click();URL.revokeObjectURL(url);}
 return <main className="shell"><aside className="sidebar"><div className="brand"><div className="brand-icon"><Mail size={21}/></div><div><b>OpenContact</b><small>PUBLIC EMAIL FINDER</small></div></div><div className="nav-label">WORKSPACE</div><div className="nav active"><Search size={17}/> Discover contacts</div><div className="side-bottom"><div className="secure"><ShieldCheck size={18}/><div><b>Privacy-first discovery</b><small>Public pages only · robots.txt respected</small></div></div><small className="version">OPENCONTACT · 1.1.0</small></div></aside>
 <section className="main"><header className="topbar"><div><span className="eyebrow">CONTACT INTELLIGENCE</span><h1>Find the right people to reach.</h1><p>Discover publicly published business, professional and personal contact emails across the web.</p></div><div className="top-pill"><span/> Tavily search integration</div></header>
 <div className="content"><form className="search-card" onSubmit={runExtraction}><div className="card-heading"><div><span className="eyebrow">NEW DISCOVERY</span><h2>Build a contact list</h2></div><span className="secure-tag"><ShieldCheck size={14}/> Public sources only</span></div>
 <label>What are you looking for?</label><div className="query-wrap"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="e.g. fintech companies, marketing consultants, authors" required minLength={2}/><button disabled={loading||!query.trim()}>{loading?<><Loader2 className="spin" size={17}/> Scanning</>:<><Search size={17}/> Find emails</>}</button></div>
 <div className="options"><div className="option"><label>CONTACT TYPE</label><div className="segmented"><button type="button" className={scope==='both'?'chosen':''} onClick={()=>setScope('both')}><Users size={15}/> Both</button><button type="button" className={scope==='business'?'chosen':''} onClick={()=>setScope('business')}><Building2 size={15}/> Business</button><button type="button" className={scope==='professional'?'chosen':''} onClick={()=>setScope('professional')}><Mail size={15}/> Professional</button><button type="button" className={scope==='personal'?'chosen':''} onClick={()=>setScope('personal')}><UserRound size={15}/> Personal</button></div></div>
 <div className="option country-option"><label><MapPin size={13}/> COUNTRY</label><select value={country} onChange={e=>setCountry(e.target.value)}>{COUNTRIES.map(c=><option key={c} value={c}>{c==='Worldwide'?'All countries':c}</option>)}</select></div>
 <div className="option limit-option"><label>MAXIMUM EMAILS</label><select value={limit} onChange={e=>setLimit(e.target.value)}><option value="100">100</option><option value="250">250</option><option value="500">500</option><option value="1000">1,000</option><option value="2500">2,500</option><option value="5000">5,000</option><option value="10000">10,000</option><option value="custom">Custom</option></select>{limit==='custom'&&<input className="custom-limit" aria-label="Custom maximum" type="number" min="1" max="10000" value={custom} onChange={e=>setCustom(e.target.value)}/>}</div></div>
 {error&&<div className="error"><AlertCircle size={16}/>{error}</div>}<div className="footnote"><ShieldCheck size={14}/> Searches inspect public pages that permit automated access. The selected country is included in search queries.</div></form>
 <section className="progress-card"><div className="progress-top"><div><span className="eyebrow">LIVE EXTRACTION</span><h2>{statusText}</h2></div><span className={loading?'running-pill':'idle-pill'}>{loading?<><Activity size={13}/> RUNNING</>:<><CheckCircle2 size={13}/> {progress.found?'FINISHED':'IDLE'}</>}</span></div><div className="progress-meta"><b>{progress.found.toLocaleString()}</b><span>of {progress.target.toLocaleString()} requested</span><strong>{percent}%</strong></div><div className="progress-track"><div className="progress-fill" style={{width:`${percent}%`}}/></div><div className="progress-foot"><span>{progress.processedPages.toLocaleString()} / {progress.totalPages.toLocaleString()} pages processed</span><span>{progress.scanned.toLocaleString()} pages successfully scanned · {progress.totalSources.toLocaleString()} sources found</span></div>{loading&&<div className="live-indicator"><Loader2 className="spin" size={14}/> New addresses appear below after each scan batch. Keep this page open while extraction runs.</div>}{!loading&&jobState&&jobState.cursor<jobState.pages.length&&progress.found<effectiveLimit&&<button className="resume-button" onClick={resumeExtraction}><PauseCircle size={15}/> Resume remaining scan</button>}</section>
 <div className="stats-grid"><Stat icon={<Globe2/>} label="SOURCES FOUND" value={progress.totalSources}/><Stat icon={<Mail/>} label="EMAILS DISCOVERED" value={rows.length}/><Stat icon={<CheckCircle2/>} label="MX FOUND (NOT MAILBOX VERIFIED)" value={rows.filter(x=>x.status==='valid').length}/><Stat icon={<AlertCircle/>} label="NOT CONFIRMED" value={rows.filter(x=>x.status==='unverified').length}/></div>
 <section className="results-card"><div className="results-head"><div><span className="eyebrow">DISCOVERY RESULTS · LIVE</span><h2>Contact emails <span className="total">{rows.length.toLocaleString()}</span></h2></div><button className="export" onClick={exportCsv} disabled={!visible.length}><Download size={16}/> Export CSV</button></div><div className="filters"><div className="tabs">{[['all','All contacts'],['valid','MX found'],['unverified','Not confirmed']].map(([v,l])=><button key={v} className={filter===v?'selected':''} onClick={()=>setFilter(v)}>{l}{v==='all'?` (${rows.length})`:''}</button>)}</div><span className="result-hint">{visible.length.toLocaleString()} shown · maximum {effectiveLimit.toLocaleString()}</span></div>{searchNote&&<p className="search-note">{searchNote}</p>}{visible.length?<div className="table-wrap"><table><thead><tr><th>EMAIL ADDRESS</th><th>DOMAIN</th><th>MAIL CHECK</th><th>SOURCE</th></tr></thead><tbody>{visible.map((r,i)=><tr key={r.email+i}><td><div className="email-cell"><span className="mail-dot"><Mail size={14}/></span><b>{r.email}</b></div></td><td>{r.domain}</td><td><span className={`status ${r.status}`}>{r.status==='valid'?'MX FOUND':'NOT CONFIRMED'}</span><small className="reason">{r.reason}</small></td><td><a className="source" href={r.source} target="_blank" rel="noreferrer">{r.title||'Open source'} <ExternalLink size={12}/></a></td></tr>)}</tbody></table></div>:<div className="empty"><div className="empty-icon"><Mail size={23}/></div><b>{loading?'Searching and scanning public sources…':'Your live contact list will appear here'}</b><p>{loading?'The list updates after each batch of public pages is scanned.':'Enter a keyword, choose a country and start discovering publicly published contact emails.'}</p></div>}</section>
 <div className="bottom-note"><ShieldCheck size={15}/><span><b>About email checks.</b> “MX found” means the domain advertises mail servers. It does not prove that the individual mailbox exists, is active, or will accept a message. This app does not perform SMTP mailbox probing. Results are published addresses from public sources, not guessed addresses. Follow applicable privacy and anti-spam laws.</span></div></div></section></main>
}
function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:number}){return <div className="stat"><div className="stat-icon">{icon}</div><div><span>{label}</span><b>{value.toLocaleString()}</b></div></div>}
