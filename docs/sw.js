const CACHE='cybershield-1.0.0';
const SHELL=['./','./index.html','./styles.css','./app.js','./core.js','./icon.svg','./fonts/space.ttf','./fonts/arabic.ttf'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('cybershield-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/'))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}
    catch(error){const cached=await cache.match(event.request);if(cached)return cached;if(event.request.mode==='navigate')return cache.match(new URL('./index.html',self.location.href).href);throw error;}
  }));
});
self.addEventListener('message',event=>{
  if(event.data?.type!=='CACHE_VISION')return;
  event.waitUntil((async()=>{const cache=await caches.open(CACHE);const manifest=await(await fetch('./models/model.json')).json();const assets=['./vendor/tf.min.js','./vendor/coco-ssd.min.js','./models/model.json',...manifest.weightsManifest.flatMap(g=>g.paths.map(p=>'./models/'+p))];await cache.addAll(assets);})());
});
