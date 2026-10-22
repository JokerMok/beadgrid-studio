// Restricted acceptance operations, only the two named beadgrid QA users and beadgrid product.
import fs from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
const center='/srv/apps/zhenyi-accounts',file='/srv/apps/beadgrid-studio/shared/config/qa-accounts.json';
const dotenv=await import(center+'/current/node_modules/dotenv/lib/main.js');
const e=dotenv.parse(await fs.readFile(center+'/shared/config/app.env','utf8'));
const mode=process.argv[2] || 'prepare';
if(process.getuid()!==0)throw Error('Root only');
async function native(endpoint,params={},body){const u=new URL('http://127.0.0.1:5305/api/'+endpoint);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);const r=await fetch(u,{method:body===undefined?'GET':'POST',headers:{Authorization:'Basic '+Buffer.from(e.CASDOOR_ADMIN_CLIENT_ID+':'+e.CASDOOR_ADMIN_CLIENT_SECRET).toString('base64'),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const b=await r.json();if(!r.ok || b.status!=='ok')throw Error('Official QA API failed: '+endpoint);return b.data;}
let qa=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);
if(mode==='prepare'){
 if(!qa){const suffix=randomBytes(3).toString('hex');qa={a:{username:'qa_beadgrid_20261022_a_'+suffix,password:randomBytes(18).toString('base64url')+'!9'},b:{username:'qa_beadgrid_20261022_b_'+suffix,password:randomBytes(18).toString('base64url')+'!9'}};await fs.writeFile(file,JSON.stringify(qa),{mode:0o600});}
 if(!await native('get-user',{id:'consumers/'+qa.a.username}))await native('add-user',{}, {owner:'consumers',name:qa.a.username,id:randomUUID(),displayName:'拼豆专用验收A',type:'normal-user',password:qa.a.password,isAdmin:false,createdTime:new Date().toISOString()});
 console.log('Dedicated existing consumer A prepared; B credentials prepared for actual registration UI.');
}else{
 Object.assign(process.env,e,{APP_ID:'center',DOTENV_CONFIG_PATH:center+'/shared/config/app.env'});
 const {pool,tx}=await import(center+'/current/src/server/db.ts'),{grant,audit}=await import(center+'/current/src/server/entitlements.ts');
 const actor=(await pool.query('SELECT uid FROM identities WHERE subject=$1 AND organization=$2',[e.ADMIN_SUB,'built-in'])).rows[0].uid;
 if(mode==='verify'){const {checkProduct}=await import(center+'/current/src/server/management.ts');console.log(JSON.stringify(await checkProduct('beadgrid',actor)));await pool.end();process.exit(0);}
 const who=mode.endsWith('-b')?'b':'a',u=(await pool.query('SELECT uid FROM identities WHERE username=$1 AND organization=$2',[qa[who].username,'consumers'])).rows[0];if(!u)throw Error('QA identity must login first');
 if(mode==='grant-a')await grant(actor,{uid:u.uid,product_id:'beadgrid',kind:'membership',days:1,reason:'拼豆公共账号接入专用验收A，一天会员，无支付'});
 else if(mode==='grant-b')await grant(actor,{uid:u.uid,product_id:'beadgrid',kind:'quota',feature_id:'export',amount:5,reason:'拼豆公共账号接入专用验收B，五次导出，无支付'});
 else if(mode==='expire-a')await tx(async db=>{const before=(await db.query('SELECT * FROM memberships WHERE uid=$1 AND product_id=$2',[u.uid,'beadgrid'])).rows[0];if(!before)throw Error('QA membership missing');const after=(await db.query("UPDATE memberships SET expires_at=now()+interval '3 seconds' WHERE uid=$1 AND product_id=$2 RETURNING *",[u.uid,'beadgrid'])).rows[0];await audit(db,actor,'qa_expiry_boundary','beadgrid/'+u.uid,'仅专用测试用户：以真实服务器时间验证3秒到期边界',before,after);});
 else if(mode==='verify'){const {checkProduct}=await import(center+'/current/src/server/management.ts');console.log(JSON.stringify(await checkProduct('beadgrid',actor)));}
 else throw Error('Unsupported targeted operation');
 await pool.end();console.log('Targeted beadgrid QA operation completed: '+mode);
}
