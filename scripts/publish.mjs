// Uses the user's existing Git credential manager. Never prints or writes credentials.
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const owner='Ey4d55',name='FlowTwin-CyberShield-AI',repository=`${owner}/${name}`;
const credential=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
const token=/^password=(.+)$/m.exec(credential.stdout||'')?.[1];
if(credential.status!==0||!token)throw new Error('Existing GitHub authentication is unavailable.');
async function api(route,method='GET',data){const response=await fetch('https://api.github.com'+route,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},body:data?JSON.stringify(data):undefined});const text=await response.text();let body;try{body=JSON.parse(text);}catch{body={message:text.slice(0,200)};}return{status:response.status,body};}
const user=await api('/user');if(user.body.login!==owner)throw new Error('GitHub credential belongs to a different account.');
if(process.argv.includes('--status')){const meta=await api(`/repos/${repository}/pages`),build=await api(`/repos/${repository}/pages/builds/latest`),runs=await api(`/repos/${repository}/actions/runs?per_page=4`);console.log(JSON.stringify({pagesStatus:meta.status,url:meta.body.html_url,build:build.body.status,error:build.body.error,checks:runs.body.workflow_runs?.map(r=>({name:r.name,status:r.status,conclusion:r.conclusion,url:r.html_url}))},null,2));process.exit();}
if(process.argv.includes('--enable-pages')){const result=await api(`/repos/${repository}/pages`,'POST',{build_type:'legacy',source:{branch:'main',path:'/docs'}});if(![201,409].includes(result.status))throw new Error(`Pages setup failed: ${result.status} ${result.body.message}`);console.log(JSON.stringify({status:result.status,url:result.body.html_url||`https://${owner.toLowerCase()}.github.io/${name}/`}));process.exit();}
const head=spawnSync('git',['rev-parse','--verify','HEAD'],{encoding:'utf8'});if(head.status!==0)throw new Error('Commit the reviewed code before creating a remote repository.');
const existing=await api(`/repos/${repository}`);
if(existing.status!==404)throw new Error('Repository already exists or cannot be inspected. Refusing to overwrite it.');
const created=await api('/user/repos','POST',{name,description:'Cyber-resilient traffic digital twin: signed telemetry, threat detection, operator-reviewed simulation, offline edge monitoring, and local vehicle detection.',private:false,auto_init:false,homepage:`https://${owner.toLowerCase()}.github.io/${name}/`});
if(created.status!==201)throw new Error(`Repository creation failed: ${created.status} ${created.body.message}`);
function git(args){const r=spawnSync('git',args,{encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});if(r.status!==0)throw new Error(`git ${args[0]} failed: ${(r.stderr||'').slice(0,700)}`);return r.stdout.trim();}
git(['remote','add','origin',created.body.clone_url]);git(['push','-u','origin','HEAD:main']);
const pages=await api(`/repos/${repository}/pages`,'POST',{build_type:'legacy',source:{branch:'main',path:'/docs'}});
if(![201,409].includes(pages.status))throw new Error(`Repository pushed, but Pages setup failed: ${pages.status} ${pages.body.message}`);
const receipt={repository:created.body.html_url,commit:git(['rev-parse','HEAD']),url:pages.body.html_url||`https://${owner.toLowerCase()}.github.io/${name}/`,source:'main:/docs',createdAt:new Date().toISOString()};
await writeFile(new URL('../evidence/deployment.json',import.meta.url),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
