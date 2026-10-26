import {createRequire} from 'node:module';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const require=createRequire(path.join(process.env.CYBERSHIELD_NODE_MODULES,'_resolve.cjs'));
const{chromium}=require('playwright');const url='https://ey4d55.github.io/FlowTwin-CyberShield-AI/';
const checks=[];
for(const file of['index.html','app.js','core.js','sw.js','styles.css']){const response=await fetch(url+file);assert.equal(response.status,200);const remote=Buffer.from(await response.arrayBuffer()),local=await readFile('docs/'+file);assert.equal(createHash('sha256').update(remote).digest('hex'),createHash('sha256').update(local).digest('hex'));checks.push({file,verified:true});}
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{await page.goto(url);await page.waitForSelector('#scenario');await page.selectOption('#scenario','tamper');await page.waitForFunction(()=>document.body.innerText.includes('Message integrity failed'));await page.screenshot({path:'test-results/public-demo.png',fullPage:true});await page.goto(url+'#vision');await page.waitForSelector('#image-input');await page.setInputFiles('#image-input','.local/bus.jpg');await page.waitForFunction(()=>document.querySelector('#vision-status').textContent.includes('Local inference'),{},{timeout:120000});assert(/bus: [1-9]/i.test(await page.locator('#vision-results').innerText()));assert.deepEqual(errors,[]);await writeFile('evidence/public-verification.json',JSON.stringify({url,timestamp:new Date().toISOString(),checks,hostedTamperDetection:true,hostedVehicleInference:true,uncaughtErrors:errors},null,2));console.log('Hosted assets match; public tamper detection and local bus inference pass.');}finally{await browser.close();}
