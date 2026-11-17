import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';
import robotsParser from 'robots-parser';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Status = 'valid' | 'invalid' | 'unverified';
type Result = { email:string; domain:string; source:string; title:string; status:Status; reason:string };
type SearchHit = { url:string; title?:string; content?:string };
const EMAIL_RE = /[a-zA-Z0-9.!#$%&'*+/=?^`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;
const BLOCKED = new Set(['example.com','example.org','example.net','test.com','domain.com','yourdomain.com']);

// Personal means a publicly listed address on a consumer mailbox provider.
// Company-owned domains are deliberately excluded from Personal-only results.
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','yahoo.ca','yahoo.com.au','ymail.com','rocketmail.com',
  'outlook.com','hotmail.com','hotmail.co.uk','live.com','live.co.uk','msn.com',
  'icloud.com','me.com','mac.com','aol.com','aim.com',
  'proton.me','protonmail.com','pm.me','tutanota.com','tuta.io',
  'gmx.com','gmx.net','mail.com','email.com','usa.com',
  'yandex.com','yandex.ru','fastmail.com','fastmail.fm','hey.com',
  'zoho.com'
]);

function isPublicIp(ip:string) {
  const v=net.isIP(ip);
  if(v===4){const p=ip.split('.').map(Number);return !(p[0]===10||p[0]===127||p[0]===0||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168));}
  if(v===6){const x=ip.toLowerCase();return !(x==='::1'||x==='::'||x.startsWith('fc')||x.startsWith('fd')||x.startsWith('fe80:')||x.startsWith('::ffff:'));}
  return false;
}
async function allowedByRobots(url:URL):Promise<boolean>{
  try {
    const r=await fetch(new URL('/robots.txt',url.origin),{signal:AbortSignal.timeout(2500),headers:{'User-Agent':'OpenContactBot/1.0 (+public contact discovery)'}});
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
    const res=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(5000),headers:{'User-Agent':'OpenContactBot/1.0 (+public contact discovery)','Accept':'text/html,application/xhtml+xml'}});
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

    const scopeTerms = scope==='business'
      ? ['company contact page business email','official company website contact us email','business directory company email address','company leadership and contact information','local business public email contacts']
      : scope==='professional'
      ? ['professional work email public profile contact','consultant specialist professional directory work email','staff biography work contact email','professional association member contact email','publicly listed employee business email']
      : scope==='personal'
      ? [
          'public Gmail Yahoo Outlook Hotmail personal email contact',
          'individual publicly listed Gmail address contact',
          'person personal email address Gmail Yahoo contact page',
          'public personal mailbox address Outlook iCloud Proton Mail',
          'individual blog author personal email address contact',
          'personal website contact email Gmail',
          'public creator writer individual email address',
          'publicly published personal email address not company contact'
        ]
      : ['public business and professional email directory','company team staff contact email','publicly listed individual contact email','business website contact information','professional profile email address'];

    // Wider query coverage: Tavily returns up to 20 pages per query. Search snippets are
    // also inspected so useful publicly indexed contacts are not lost when a site blocks crawling.
    const searches = await Promise.all(scopeTerms.map(async terms => {
      const response=await fetch('https://api.tavily.com/search',{
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({api_key:key,query:`${query} ${terms}`,search_depth:'advanced',max_results:20,include_raw_content:false}),
        signal:AbortSignal.timeout(15000)
      });
      if(!response.ok) throw new Error(`Tavily returned ${response.status}. Check the API key, plan limits and available credits.`);
      return await response.json() as {results?:SearchHit[]};
    }));

    const uniquePages=new Map<string,{url:string;title:string}>();
    const snippets:Array<{text:string;url:string;title:string}>=[];
    for(const search of searches) for(const item of search.results||[]) {
      if(!item.url) continue;
      try {
        const normalized=new URL(item.url); normalized.hash='';
        const url=normalized.href;
        uniquePages.set(url,{url,title:item.title||normalized.hostname});
        if(item.content) snippets.push({text:item.content,url,title:item.title||normalized.hostname});
      } catch {}
    }
    const maxPages=Math.min(160,Math.max(1,Number(process.env.MAX_PAGES_PER_SEARCH)||120));
    const pages=Array.from(uniquePages.values()).slice(0,maxPages);

    const seen=new Set<string>();
    const candidates:Array<{email:string;source:string;title:string}>=[];
    const candidateCap=Math.min(3000,Math.max(limit*5,500));
    function collect(text:string,source:string,title:string){
      EMAIL_RE.lastIndex=0;
      for(const raw of (text.match(EMAIL_RE)||[])){
        const email=raw.replace(/[.,;:!?)}\\]>]+$/,'').toLowerCase();
        const domain=email.split('@')[1];
        if(!domain||seen.has(email)) continue;
        if(scope==='personal'&&!PERSONAL_EMAIL_DOMAINS.has(domain)) continue;
        if((scope==='business'||scope==='professional')&&PERSONAL_EMAIL_DOMAINS.has(domain)) continue;
        seen.add(email);
        candidates.push({email,source,title});
        if(candidates.length>=candidateCap) return;
      }
    }

    // Extract indexed search snippets first. Crawl more pages only when the snippets
    // do not contain enough scope-matching addresses.
    for(const hit of snippets){collect(hit.text,hit.url,hit.title);if(candidates.length>=candidateCap) break;}

    const maxPages=Math.min(160,Math.max(1,Number(process.env.MAX_PAGES_PER_SEARCH)||120));
    const pages=Array.from(uniquePages.values()).slice(0,maxPages);
    const scraped:Array<{item:{url:string;title:string};page:{text:string;url:string}|null}>=[];
    const desiredCandidates=Math.min(candidateCap,Math.max(limit*3,150));
    if(candidates.length<desiredCandidates){
      const concurrency=30;
      for(let i=0;i<pages.length&&candidates.length<desiredCandidates;i+=concurrency){
        const batch=await Promise.all(pages.slice(i,i+concurrency).map(async item=>({item,page:await fetchPage(item.url)})));
        scraped.push(...batch);
        for(const {item,page} of batch){
          if(page) collect(page.text,page.url,item.title);
          if(candidates.length>=desiredCandidates) break;
        }
      }
    }

    const checked:Array<{email:string;source:string;title:string;status:Status;reason:string}>=[];
    const validationCap=Math.min(candidates.length,Math.max(limit*3,150));
    for(let i=0;i<validationCap;i+=50){
      const batch=await Promise.all(candidates.slice(i,Math.min(i+50,validationCap)).map(async c=>({...c,...await validate(c.email)})));
      checked.push(...batch);
      if(checked.filter(x=>x.status!=='invalid').length>=limit) break;
    }
    const results:Result[]=checked.filter(x=>x.status!=='invalid').slice(0,limit).map(x=>({email:x.email,domain:x.email.split('@')[1],source:x.source,title:x.title,status:x.status,reason:x.reason}));
    const personalExcluded=scope==='personal'?' Only consumer mailbox domains (such as Gmail, Yahoo, Outlook, iCloud and Proton) are included; company-domain addresses are excluded.':'';
    const note=`Requested ${limit} leads; found ${results.length} matching public addresses. The selected number is a maximum, not a guaranteed count: results depend on relevant indexed pages, crawl permissions and available provider coverage.${personalExcluded} MX checks confirm domain mail routing, not an individual mailbox or consent.`;
    return NextResponse.json({
      results,
      stats:{sources:pages.length,pagesScanned:scraped.filter(x=>x.page).length,emailsFound:candidates.length,valid:results.filter(x=>x.status==='valid').length,unverified:results.filter(x=>x.status==='unverified').length,invalid:checked.filter(x=>x.status==='invalid').length},
      note
    });
  } catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Unexpected search error'},{status:500});}
}
