import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';
import robotsParser from 'robots-parser';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Status = 'valid' | 'invalid' | 'unverified';
type Result = { email:string; domain:string; source:string; title:string; status:Status; reason:string };
const EMAIL_RE = /[a-zA-Z0-9.!#$%&'*+/=?^`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;
const BLOCKED = new Set(['example.com','example.org','example.net','test.com','domain.com','yourdomain.com']);
function isPublicIp(ip:string) {
  const v=net.isIP(ip);
  if(v===4){const p=ip.split('.').map(Number);return !(p[0]===10||p[0]===127||p[0]===0||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168));}
  if(v===6){const x=ip.toLowerCase();return !(x==='::1'||x==='::'||x.startsWith('fc')||x.startsWith('fd')||x.startsWith('fe80:')||x.startsWith('::ffff:'));}
  return false;
}
async function allowedByRobots(url:URL):Promise<boolean>{
  try {
    const r=await fetch(new URL('/robots.txt',url.origin),{signal:AbortSignal.timeout(4000),headers:{'User-Agent':'OpenContactBot/1.0 (+public contact discovery)'}});
    if(!r.ok) return r.status===404;
    return robotsParser(url.origin+'/robots.txt',await r.text()).isAllowed(url.href,'OpenContactBot')!==false;
  } catch { return false; }
}
async function fetchPage(raw:string):Promise<{text:string;url:string}|null>{
  try {
    const u=new URL(raw); if(!['http:','https:'].includes(u.protocol)||u.username||u.password) return null;
    const host=u.hostname.toLowerCase(); if(host==='localhost'||host.endsWith('.local')) return null;
    const ips=await dns.lookup(host,{all:true,verbatim:true}); if(!ips.length||ips.some(x=>!isPublicIp(x.address))) return null;
    if(!(await allowedByRobots(u))) return null;
    const res=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'User-Agent':'OpenContactBot/1.0 (+public contact discovery)','Accept':'text/html,application/xhtml+xml'}});
    if(res.status>=300&&res.status<400) return null;
    const type=res.headers.get('content-type')||''; if(!res.ok||!type.includes('text/html')) return null;
    const len=Number(res.headers.get('content-length')||0); if(len>1000000) return null;
    const html=(await res.text()).slice(0,1000000);
    const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&commat;|&#64;|&#x40;/gi,'@').replace(/&period;|&#46;|&#x2e;/gi,'.').replace(/&amp;/gi,'&').replace(/\s+/g,' ');
    return {text,url:u.href};
  } catch { return null; }
}
async function validate(email:string):Promise<{status:Status;reason:string}>{
  const [local,domain]=email.toLowerCase().split('@');
  if(!local||local.length>64||!domain||domain.length>253||BLOCKED.has(domain)||local.startsWith('.')||local.endsWith('.')||local.includes('..')) return {status:'invalid',reason:'Malformed or placeholder address'};
  try { const mx=await dns.resolveMx(domain); return mx.length?{status:'valid',reason:'Domain has MX mail-routing records'}:{status:'invalid',reason:'Domain has no MX records'}; }
  catch { try { await dns.resolve4(domain); return {status:'unverified',reason:'Domain resolves but MX could not be confirmed'}; } catch { return {status:'invalid',reason:'Domain does not resolve'}; } }
}
export async function POST(req:NextRequest){
  try {
    const key=process.env.TAVILY_API_KEY;
    if(!key) return NextResponse.json({error:'Search is not configured. Add TAVILY_API_KEY in Vercel environment variables.'},{status:503});
    const body=await req.json(); const query=String(body.query||'').trim(); const limit=Math.floor(Number(body.limit));
    const scope=body.scope==='business'?'business':body.scope==='professional'?'professional':body.scope==='personal'?'personal':'both';
    if(query.length<2||query.length>180) return NextResponse.json({error:'Enter a search phrase between 2 and 180 characters.'},{status:400});
    if(!Number.isInteger(limit)||limit<1||limit>500) return NextResponse.json({error:'Result limit must be between 1 and 500.'},{status:400});
    const hints=scope==='business'?'business contact email':scope==='professional'?'professional contact email':scope==='personal'?'publicly listed personal contact email (personal email address)': 'business OR professional OR publicly listed personal contact email';
    const sr=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({api_key:key,query:`${query} ${hints} (contact OR about OR team)`,search_depth:'basic',max_results:20,include_raw_content:false}),signal:AbortSignal.timeout(12000)});
    if(!sr.ok) return NextResponse.json({error:`Tavily returned ${sr.status}. Check your API key and available credits.`},{status:502});
    const data=await sr.json(); const items=(data.results||[]) as Array<{url:string;title?:string;content?:string}>;
    const maxPages=Math.min(20,Math.max(1,Number(process.env.MAX_PAGES_PER_SEARCH)||12));
    const pages=items.filter(x=>x.url).slice(0,maxPages);
    const scraped=await Promise.all(pages.map(async item=>({item,page:await fetchPage(item.url)})));
    const seen=new Set<string>(); const candidates:Array<{email:string;source:string;title:string}>=[];
    for(const {item,page} of scraped){if(!page)continue;for(const raw of (page.text.match(EMAIL_RE)||[])){const email=raw.replace(/[.,;:!?)}\]>]+$/,'').toLowerCase();if(seen.has(email))continue;seen.add(email);candidates.push({email,source:page.url,title:item.title||new URL(page.url).hostname});if(candidates.length>=limit*2)break;}if(candidates.length>=limit*2)break;}
    const checked=await Promise.all(candidates.slice(0,limit*2).map(async c=>({...c,...await validate(c.email)})));
    const results:Result[]=checked.filter(x=>x.status!=='invalid').slice(0,limit).map(x=>({email:x.email,domain:x.email.split('@')[1],source:x.source,title:x.title,status:x.status,reason:x.reason}));
    return NextResponse.json({results,stats:{sources:pages.length,pagesScanned:scraped.filter(x=>x.page).length,emailsFound:candidates.length,valid:results.filter(x=>x.status==='valid').length,unverified:results.filter(x=>x.status==='unverified').length,invalid:checked.filter(x=>x.status==='invalid').length},note:'Only public pages that permit this crawler were checked. MX validation confirms domain mail routing, not an individual mailbox or consent.'});
  } catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Unexpected search error'},{status:500});}
}
