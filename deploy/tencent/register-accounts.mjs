// Run as root on tencent-main only. Registers only beadgrid; never runs center setup/start.
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const center='/srv/apps/zhenyi-accounts', product='/srv/apps/beadgrid-studio';
const {withOperationLock}=await import(center+'/current/scripts/ops-runtime.mjs');
const dotenv=await import(center+'/current/node_modules/dotenv/lib/main.js');
const action=process.argv[2] || 'inspect';
if(!['inspect','apply'].includes(action) || process.getuid()!==0) throw Error('Root-only inspect/apply');
await withOperationLock(center+'/shared/operation.lock',async()=>{
 const envPath=center+'/shared/config/app.env', registryPath=center+'/shared/config/products.json';
 const original=await fs.readFile(envPath,'utf8'), e=dotenv.parse(original), registry=JSON.parse(await fs.readFile(registryPath,'utf8'));
 async function native(endpoint,params={},body){const url=new URL('http://127.0.0.1:5305/api/'+endpoint);for(const[k,v]of Object.entries(params))url.searchParams.set(k,v);const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Authorization:'Basic '+Buffer.from(e.CASDOOR_ADMIN_CLIENT_ID+':'+e.CASDOOR_ADMIN_CLIENT_SECRET).toString('base64'),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const result=await r.json();if(!r.ok || result.status!=='ok')throw Error('Official API failed: '+endpoint);return result.data;}
 let app=await native('get-application',{id:'admin/zhenyi-beadgrid'});
 const registered=registry.find(p=>p.id==='beadgrid');
 if(registered && (registered.application!=='zhenyi-beadgrid' || registered.url!=='https://pindou.shizibandu.icu')) throw Error('Conflicting beadgrid registration; preserved');
 if(app && (app.organization!=='consumers' || app.redirectUris.length!==1 || app.redirectUris[0]!=='https://pindou.shizibandu.icu/auth/callback/beadgrid' || app.tokenSigningMethod!=='RS256' || app.tokenFormat!=='JWT-Standard' || app.grantTypes.join(',')!=='authorization_code')) throw Error('Existing application conflicts; preserved');
 console.log(JSON.stringify({application:app?{name:app.name,organization:app.organization,redirectUris:app.redirectUris,grantTypes:app.grantTypes,tokenFormat:app.tokenFormat,tokenSigningMethod:app.tokenSigningMethod}:null,registered:!!registered}));
 if(action==='inspect')return;
 if(!app){
   const template=await native('get-application',{id:'admin/zhenyi-center'});
   app={...template,name:'zhenyi-beadgrid',displayName:'豆格工坊 · 拼豆',homepageUrl:'https://pindou.shizibandu.icu',organization:'consumers',clientId:randomBytes(12).toString('hex'),clientSecret:randomBytes(32).toString('hex'),redirectUris:['https://pindou.shizibandu.icu/auth/callback/beadgrid'],grantTypes:['authorization_code'],tokenFormat:'JWT-Standard',tokenSigningMethod:'RS256',enableSigninSession:true,enableAutoSignin:true,enableSignUp:true,providers:[],createdTime:new Date().toISOString()};
   await native('add-application',{},app);
 }
 if(e.CASDOOR_BEADGRID_CLIENT_ID && e.CASDOOR_BEADGRID_CLIENT_ID!==app.clientId)throw Error('Client ID mismatch');
 if(e.CASDOOR_BEADGRID_CLIENT_SECRET && e.CASDOOR_BEADGRID_CLIENT_SECRET!==app.clientSecret)throw Error('Client secret mismatch');
 const additions={CASDOOR_BEADGRID_CLIENT_ID:app.clientId,CASDOOR_BEADGRID_CLIENT_SECRET:app.clientSecret,BEADGRID_SERVICE_KEY:e.BEADGRID_SERVICE_KEY || randomBytes(32).toString('hex')};
 if(additions.BEADGRID_SERVICE_KEY.length<43)throw Error('Service key too short');
 const next=original.replace(/\s*$/,'\n')+Object.entries(additions).filter(([k])=>!e[k]).map(([k,v])=>`${k}=${v}\n`).join('');
 await fs.writeFile(envPath+'.beadgrid-next',next,{mode:0o640});await fs.chown(envPath+'.beadgrid-next',0,(await fs.stat(envPath)).gid);await fs.rename(envPath+'.beadgrid-next',envPath);
 if(!registered)registry.push({id:'beadgrid',name:'豆格工坊 · 拼豆',url:'https://pindou.shizibandu.icu',application:'zhenyi-beadgrid',clientIdEnv:'CASDOOR_BEADGRID_CLIENT_ID',clientSecretEnv:'CASDOOR_BEADGRID_CLIENT_SECRET',serviceKeyEnv:'BEADGRID_SERVICE_KEY',enabled:true});
 else if(!registered.enabled)throw Error('Existing registration disabled; not silently enabled');
 await fs.writeFile(registryPath+'.beadgrid-next',JSON.stringify(registry,null,2)+'\n',{mode:0o640});await fs.chown(registryPath+'.beadgrid-next',0,(await fs.stat(registryPath)).gid);await fs.rename(registryPath+'.beadgrid-next',registryPath);
 // This privileged provisioning process may operate the center. The product runtime never receives this environment or DB permission.
 Object.assign(process.env,dotenv.parse(next),{DOTENV_CONFIG_PATH:envPath,APP_ID:'center'});
 const {pool}=await import(center+'/current/src/server/db.ts');
 const {saveCatalog}=await import(center+'/current/src/server/catalog.ts');
 const actor=(await pool.query('SELECT uid FROM identities WHERE subject=$1 AND organization=$2',[e.ADMIN_SUB,'built-in'])).rows[0]?.uid;
 if(!actor)throw Error('No initialized administrator identity');
 const reason='正式拼豆OIDC接入；依据当前本机v1.6功能映射，非支付记录';
 const old=(await pool.query('SELECT * FROM products WHERE id=$1',['beadgrid'])).rows[0];
 if(old && old.origin!=='https://pindou.shizibandu.icu')throw Error('Business product conflict');
 await saveCatalog(actor,'products',{id:'beadgrid',name:'豆格工坊 · 拼豆',status:'active',application:'zhenyi-beadgrid',callback_url:'https://pindou.shizibandu.icu/auth/callback/beadgrid',origin:'https://pindou.shizibandu.icu',reason});
 const features=[{id:'studio',name:'登录后的配色与用豆清单',kind:'access',member_only:false},{id:'cloud',name:'账号作品保存和恢复',kind:'access',member_only:false},{id:'export_member',name:'有效拼豆会员免次导出',kind:'access',member_only:true},{id:'export',name:'图纸导出次数（每任务1次）',kind:'quota',member_only:false}];
 for(const f of features){const exists=(await pool.query('SELECT * FROM features WHERE product_id=$1 AND id=$2',['beadgrid',f.id])).rows[0];if(exists){if(exists.kind!==f.kind || exists.member_only!==f.member_only)throw Error('Existing feature conflict: '+f.id);continue;}await saveCatalog(actor,'features',{product_id:'beadgrid',...f,free_quota:0,period:'once',active:true,reason});}
 const plans=(await pool.query('SELECT id FROM plans WHERE product_id=$1 AND id=$2',['beadgrid','monthly'])).rows;
 if(!plans.length)await saveCatalog(actor,'plans',{product_id:'beadgrid',id:'monthly',name:'拼豆30天会员（免次导出权限独立登记）',days:30,quotas:{},active:true,casdoor_plan:null,reason});
 await pool.end();
 const selected={NODE_ENV:'production',HOST:'127.0.0.1',PORT:'18871',DATA_DIR:product+'/shared/data',COOKIE_SECURE:'1',PUBLIC_URL:'https://pindou.shizibandu.icu',TRUSTED_PROXIES:'127.0.0.1/32',CLIENT_IP_HEADER:'x-forwarded-for',ACCOUNTS_URL:'https://accounts.shizibandu.icu',OIDC_ISSUER:'https://identity.accounts.shizibandu.icu',OIDC_APPLICATION:'zhenyi-beadgrid',OIDC_CLIENT_ID:app.clientId,OIDC_CLIENT_SECRET:app.clientSecret,OIDC_REDIRECT_URI:'https://pindou.shizibandu.icu/auth/callback/beadgrid',PRODUCT_ID:'beadgrid',PRODUCT_SERVICE_KEY:additions.BEADGRID_SERVICE_KEY,EXPORT_ACCESS_FEATURE:'export_member',EXPORT_QUOTA_FEATURE:'export'};
 await fs.writeFile(product+'/shared/config/accounts-next.env',Object.entries(selected).map(([k,v])=>`${k}=${v}\n`).join(''),{mode:0o600});
 console.log('beadgrid application, product, features and private product-only environment prepared; restart center only.');
});
