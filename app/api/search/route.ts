import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';
import robotsParser from 'robots-parser';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Status = 'valid' | 'unverified';
type Result = { email:string; domain:string; source:string; title:string; status:Status; reason:string };
type SearchHit = { url:string; title?:string; content?:string };
type Page = {url:string;title:string};
type JobState = {pages:Page[];cursor:number;seen:string[];scanned:number;sourceCount:number;found:number;round:number};
const EMAIL_RE = /[a-zA-Z0-9.!#$%&'*+/=?^`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;
const BLOCKED = new Set(['example.com','example.org','example.net','test.com','domain.com','yourdomain.com']);
const ROLE_LOCAL_PARTS = new Set(['info','information','contact','contacts','support','help','admin','administrator','hello','hi','team','office','sales','service','services','enquiries','enquiry','inquiries','inquiry','noreply','no-reply','donotreply','do-not-reply','mailer-daemon','webmaster','postmaster','billing','accounts','accounting','payments','orders','careers','jobs','hr','humanresources','marketing','press','media','news','newsletter','feedback','notifications','notification','privacy','legal','abuse','security','root','test','testing','demo','example','sample','user','guest','mail','email','bot','robot']);
const PLACEHOLDER_LOCAL_PARTS = /(?:^|[._-])(test|testing|fake|dummy|sample|example|placeholder|invalid|unknown|nobody|none)(?:$|[._-])/i;
const PERSONAL_EMAIL_DOMAINS = new Set(['gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','yahoo.ca','yahoo.com.au','ymail.com','rocketmail.com','outlook.com','hotmail.com','hotmail.co.uk','live.com','live.co.uk','msn.com','icloud.com','me.com','mac.com','aol.com','aim.com','proton.me','protonmail.com','pm.me','tutanota.com','tuta.io','gmx.com','gmx.net','mail.com','email.com','usa.com','yandex.com','yandex.ru','fastmail.com','fastmail.fm','hey.com','zoho.com']);

function isPlausiblePersonAddress(email:string):boolean {
  const rawLocal=email.toLowerCase().split('@')[0]; const local=rawLocal.split('+')[0];
  if(!local||local.length<3||!/[a-z]/.test(local)||ROLE_LOCAL_PARTS.has(local)||PLACEHOLDER_LOCAL_PARTS.test(local)) return false;
  if(/^(?:info|contact|support|admin|sales|hello|team|office|service|billing|jobs|careers|noreply|no-reply|webmaster|newsletter|marketing|press|media|help|feedback|orders|accounts|hr)[._-]?\d*$/i.test(local)) return false;
  if(/^\d+$/.test(local)||/^[a-f0-9]{16,}$/i.test(local)) return false;
  const digits=(local.match(/\d/g)||[]).length;
  if(local.length>=8&&digits/local.length>0.45) return false;
  if(local.length>=20&&!/[._-]/.test(local)&&digits>=3) return false;
  return true;
}
function isPublicIp(ip:string) {
  const v=net.isIP(ip);
  if(v===4){const p=ip.split('.').map(Number);return !(p[0]===10||p[0]===127||p[0]===0||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168));}
  if(v===6){const x=ip.toLowerCase();return !(x==='::1'||x==='::'||x.startsWith('fc')||x.startsWith('fd')||x.startsWith('fe80:')||x.startsWith('::ffff:'));}
  return false;
}
async function allowedByRobots(url:URL):Promise<boolean>{
  try {const r=await fetch(new URL('/robots.txt',url.origin),{signal:AbortSignal.timeout(2500),headers:{'User-Agent':'OpenContactBot/1.0 (+public contact discovery)'}});if(!r.ok)return r.status===404;return robotsParser(url.origin+'/robots.txt',await r.text()).isAllowed(url.href,'OpenContactBot')!==false;}catch{return false;}
}
async function fetchPage(raw:string):Promise<{text:string;url:string}|null>{
  try {
    const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;
    const host=u.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.local'))return null;
    const ips=await dns.lookup(host,{all:true,verbatim:true});if(!ips.length||ips.some(x=>!isPublicIp(x.address)))return null;
    if(!(await allowedByRobots(u)))return null;
    const res=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(5000),headers:{'User-Agent':'OpenContactBot/1.0 (+public contact discovery)','Accept':'text/html,application/xhtml+xml'}});
    if(res.status>=300&&res.status<400)return null;
    const type=res.headers.get('content-type')||'';if(!res.ok||!type.includes('text/html'))return null;
    const len=Number(res.headers.get('content-length')||0);if(len>1000000)return null;
    const html=(await res.text()).slice(0,1000000);
    const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&commat;|&#64;|&#x40;/gi,'@').replace(/&period;|&#46;|&#x2e;/gi,'.').replace(/&amp;/gi,'&').replace(/\s+/g,' ');
    return {text,url:u.href};
  }catch{return null;}
}
async function validate(email:string):Promise<{status:Status;reason:string}>{
  const [local,domain]=email.toLowerCase().split('@');
  if(!local||local.length>64||!domain||domain.length>253||BLOCKED.has(domain)||local.startsWith('.')||local.endsWith('.')||local.includes('..'))return {status:'unverified',reason:'Address format or domain needs manual review'};
  try {const mx=await dns.resolveMx(domain);return mx.length?{status:'valid',reason:'MX records found; mailbox itself is not confirmed'}:{status:'unverified',reason:'No MX record found'};}
  catch {try{await dns.resolve4(domain);return {status:'unverified',reason:'Domain resolves, but mail routing could not be confirmed'};}catch{return {status:'unverified',reason:'Domain could not be verified'};}}
}
const EXAMPLE_SOURCE_TERMS = /\b(example|sample|demo|tutorial|how[- ]to|documentation|docs|template|placeholder|dummy|fake|test data|lorem ipsum|code snippet|regex|programming|developer guide|api reference|stackoverflow|w3schools|geeksforgeeks)\b/i;
const CONTACT_CONTEXT = /\b(contact|email|e-mail|reach|write to|mail to|author|editor|staff|team|faculty|directory|member|profile|about us|press inquiries|media inquiries|for inquiries)\b/i;
const EXAMPLE_CONTEXT = /\b(example|sample|dummy|fake|placeholder|test address|for instance|e\.g\.|such as|replace this|your[- ]?email|name@|user@|john doe|jane doe)\b/i;

function isCredibleSource(source:string,title:string):boolean {
  try {
    const url=new URL(source);
    const host=url.hostname.toLowerCase().replace(/^www\./,'');
    const path=(url.pathname+' '+url.search).toLowerCase();
    if(EXAMPLE_SOURCE_TERMS.test(title+' '+path))return false;
    if(['example.com','example.org','example.net','localhost'].includes(host))return false;
    if(/\/(?:docs?|documentation|tutorials?|guides?|learn|training|blog\/tag|tags|categories)\//i.test(path))return false;
    return true;
  } catch { return false; }
}
function hasContactEvidence(text:string,email:string):boolean {
  const lower=text.toLowerCase();const needle=email.toLowerCase();let at=lower.indexOf(needle);
  while(at>=0){
    const context=lower.slice(Math.max(0,at-180),Math.min(lower.length,at+needle.length+180));
    if(CONTACT_CONTEXT.test(context)&&!EXAMPLE_CONTEXT.test(context))return true;
    at=lower.indexOf(needle,at+needle.length);
  }
  return false;
}
function extract(text:string,source:string,title:string,scope:string,seen:Set<string>){
  const out:Array<{email:string;source:string;title:string}>=[];
  if(!isCredibleSource(source,title))return out;
  EMAIL_RE.lastIndex=0;
  for(const raw of (text.match(EMAIL_RE)||[])){
    const email=raw.replace(/[.,;:!?)}\]>]+$/,'').toLowerCase();const domain=email.split('@')[1];
    if(!domain||seen.has(email)||!isPlausiblePersonAddress(email))continue;
    if(!hasContactEvidence(text,email))continue;
    if(scope==='personal'&&!PERSONAL_EMAIL_DOMAINS.has(domain))continue;
    if((scope==='business'||scope==='professional')&&PERSONAL_EMAIL_DOMAINS.has(domain))continue;
    seen.add(email);out.push({email,source,title});
  }
  return out;
}
async function makeResults(candidates:Array<{email:string;source:string;title:string}>):Promise<Result[]>{
  const out:Result[]=[];
  for(let i=0;i<candidates.length;i+=40){
    const batch=await Promise.all(candidates.slice(i,i+40).map(async c=>({...c,...await validate(c.email)})));
    out.push(...batch.map(x=>({email:x.email,domain:x.email.split('@')[1],source:x.source,title:x.title,status:x.status,reason:x.reason})));
  }
  return out;
}


const MAX_SEARCH_ROUNDS = 5;
function expansionTerms(scope:string, round:number):string[] {
 const sets={
 personal:['individual personal Gmail email contact','personal website author email address','public creator profile contact Gmail','independent professional personal email','public portfolio contact email address','writer blogger author contact email','freelancer individual contact address','public speaker personal contact email','artist personal website email contact','individual profile publicly listed email'],
 business:['company staff directory direct email','small business owner contact email website','business association member email listing','company leadership team contact email','vendor supplier public contact email','local business directory email website','company employee profile work email','business team page email address','organization contact directory email','company about page staff email'],
 professional:['consultant advisor professional profile email','faculty researcher staff directory email','professional association directory email','speaker author profile work email','public employee work contact email','specialist consultant contact details','professional portfolio email address','conference speaker contact email','researcher university profile email','expert professional directory email'],
 both:['staff directory publicly listed email address','member directory contact email address','team page email address contact details','public profile email address contact information','association directory listed contact details','local directory business owner email','author contributor profile contact email','professional listings contact details email','organization people directory email','publicly posted email address contact page']
 };
 const source=sets[scope as keyof typeof sets]||sets.both, offset=(round*5)%source.length;
 return Array.from({length:5},(_,i)=>source[(offset+i)%source.length]);
}
async function discoverMore(query:string,scope:string,country:string,round:number,key:string,seen:Set<string>){
 const location=country==='Worldwide'?'':` in ${country}`, terms=expansionTerms(scope,round);
 const searches=await Promise.all(terms.map(async term=>{
  const response=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({api_key:key,query:`${query}${location} ${term}`,search_depth:'advanced',max_results:20,include_raw_content:false}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Tavily returned ${response.status}. Check API credits and rate limits.`);
  return await response.json() as {results?:SearchHit[]};
 }));
 const pages=new Map<string,Page>(), candidates:Array<{email:string;source:string;title:string}>=[];
 for(const search of searches)for(const item of search.results||[]){
  if(!item.url)continue;
  try{const u=new URL(item.url);u.hash='';pages.set(u.href,{url:u.href,title:item.title||u.hostname});if(item.content)candidates.push(...extract(item.content,u.href,item.title||u.hostname,scope,seen));}catch{}
 }
 return {pages:Array.from(pages.values()),candidates};
}

export async function POST(req:NextRequest){
 try{
  const key=process.env.TAVILY_API_KEY;if(!key)return NextResponse.json({error:'Search is not configured. Add TAVILY_API_KEY in Vercel environment variables.'},{status:503});
  const body=await req.json();const phase=body.phase==='continue'?'continue':'start';
  const query=String(body.query||'').trim();const limit=Math.floor(Number(body.limit));
  const scope=['business','professional','personal'].includes(body.scope)?body.scope:'both';
  const country=String(body.country||'Worldwide').trim().slice(0,80)||'Worldwide';
  if(query.length<2||query.length>180)return NextResponse.json({error:'Enter a search phrase between 2 and 180 characters.'},{status:400});
  if(!Number.isInteger(limit)||limit<1||limit>10000)return NextResponse.json({error:'Result limit must be between 1 and 10,000.'},{status:400});
  let state:JobState;let newCandidates:Array<{email:string;source:string;title:string}>=[];
  const seen=new Set<string>();
  if(phase==='start'){
    const terms=scope==='business'?['company contact page business email','official company website contact email','business directory company email','local business public email contacts','company team and staff contact page','public company contact directory','small business owner public email contact','business association member contact email','company about us leadership contact email','public vendor supplier contact email']
      :scope==='professional'?['professional work email public profile','consultant professional directory work email','staff biography work contact email','professional association member contact email','publicly listed employee work email','specialist public professional contact','speaker author professional contact email','researcher faculty public email address','advisor coach consultant contact email','conference speaker public work email']
      :scope==='personal'?['public personal Gmail Yahoo Outlook contact','individual publicly listed Gmail address','personal website contact email','blog author personal email contact','public creator writer email address','individual public personal mailbox contact','independent artist public email address','personal portfolio contact email','freelancer public contact email address','publicly published individual email contact']
      :['public business and professional email directory','company team staff contact email','publicly listed individual contact email','business website contact information','professional profile email address','public contact directory email','business association contact email directory','public speaker author contact details','small business public contact information','consultant freelancer public email address'];
    const location=country==='Worldwide'?'':` in ${country}`;
    const searches=await Promise.all(terms.map(async term=>{
      const response=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({api_key:key,query:`${query}${location} ${term}`,search_depth:'advanced',max_results:20,include_raw_content:false}),signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error(`Tavily returned ${response.status}. Check API credits and rate limits.`);
      return await response.json() as {results?:SearchHit[]};
    }));
    const pageMap=new Map<string,Page>();
    for(const search of searches)for(const item of search.results||[]){
      if(!item.url)continue;
      try{const u=new URL(item.url);u.hash='';pageMap.set(u.href,{url:u.href,title:item.title||u.hostname});if(item.content)newCandidates.push(...extract(item.content,u.href,item.title||u.hostname,scope,seen));}catch{}
    }
    state={pages:Array.from(pageMap.values()).slice(0,240),cursor:0,seen:Array.from(seen).slice(-12000),scanned:0,sourceCount:pageMap.size,found:0,round:0};
  }else{
    state=body.state as JobState;
    if(!state||!Array.isArray(state.pages)||!Array.isArray(state.seen)||!Number.isInteger(state.cursor))return NextResponse.json({error:'Extraction session expired. Start a new search.'},{status:400});
    for(const email of state.seen)seen.add(String(email).toLowerCase());
  }
  if(phase==='continue'&&state.cursor>=state.pages.length&&state.found<limit&&state.round<MAX_SEARCH_ROUNDS){
    const expanded=await discoverMore(query,scope,country,state.round,key,seen);
    const known=new Set(state.pages.map(p=>p.url));
    const freshPages=expanded.pages.filter(p=>!known.has(p.url));
    state={...state,pages:freshPages.slice(0,240),cursor:0,round:state.round+1,sourceCount:state.sourceCount+freshPages.length};
    newCandidates=expanded.candidates;
  }
  const snippetResults=await makeResults(newCandidates.slice(0,Math.max(0,limit-state.found)));
  if(snippetResults.length)state={...state,found:state.found+snippetResults.length};
  const remaining=Math.max(0,limit-state.found);
  const batchSize=6;
  const batch=remaining>0?state.pages.slice(state.cursor,state.cursor+batchSize):[];
  const fetched=await Promise.all(batch.map(async item=>({item,page:await fetchPage(item.url)})));
  const crawledCandidates:Array<{email:string;source:string;title:string}>=[];
  for(const {item,page} of fetched)if(page)crawledCandidates.push(...extract(page.text,page.url,item.title,scope,seen));
  const pageResults=remaining>0?await makeResults(crawledCandidates.slice(0,remaining)): [];
  state={...state,cursor:state.cursor+batch.length,seen:Array.from(seen).slice(-12000),scanned:state.scanned+fetched.filter(x=>x.page).length};
  const results=[...snippetResults,...pageResults].slice(0,limit);
  state={...state,found:state.found+pageResults.length};
  const done=state.found>=limit||(state.cursor>=state.pages.length&&state.round>=MAX_SEARCH_ROUNDS);
  const totalScanned=state.scanned;
  return NextResponse.json({
    results, state, done, progress:{target:limit,found:state.found,scanned:totalScanned,totalSources:state.sourceCount,processedPages:state.cursor,totalPages:state.pages.length},
    note:`Country filter: ${country}. ${state.found} addresses found so far. Sources titled as tutorials, documentation, samples or programming examples are excluded, and each address must appear near contact-related context. MX checks confirm domain mail routing only; they do not confirm that a specific mailbox exists or can receive messages. The extractor scans publicly indexed pages and pages that permit crawling; 10,000 is the maximum target, not a guaranteed supply of public addresses.`
  });
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Unexpected search error'},{status:500});}
}
