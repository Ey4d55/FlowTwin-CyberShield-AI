import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base=new URL('../docs/',import.meta.url),records=[];
async function download(url,relative){const response=await fetch(url);if(!response.ok)throw new Error(`${response.status}: ${url}`);const bytes=Buffer.from(await response.arrayBuffer());await mkdir(new URL(relative.slice(0,relative.lastIndexOf('/')+1),base),{recursive:true});await writeFile(new URL(relative,base),bytes);records.push({path:relative,source:url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});return bytes;}
await download('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js','vendor/tf.min.js');
await download('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js','vendor/coco-ssd.min.js');
// COCO-SSD's lite_mobilenet_v2 graph, with its original TensorFlow.js weights.
const graphURL='https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json';
const manifest=JSON.parse((await download(graphURL,'models/model.json')).toString());
for(const group of manifest.weightsManifest)for(const name of group.paths){if(name.includes('..')||name.includes('/')||name.includes('\\'))throw new Error('Unexpected weight path');await download(new URL(name,graphURL).href,'models/'+name);}
await download('https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE','vendor/TENSORFLOW-LICENSE.txt');
await download('https://raw.githubusercontent.com/tensorflow/tfjs-models/master/LICENSE','vendor/COCO-SSD-LICENSE.txt');
await writeFile(new URL('../evidence/model-assets.json',import.meta.url),JSON.stringify({detector:'COCO-SSD 2.2.3, ssdlite_mobilenet_v2',runtime:'TensorFlow.js 4.22.0',records},null,2));
console.log(JSON.stringify({files:records.length,bytes:records.reduce((n,r)=>n+r.bytes,0)}));
