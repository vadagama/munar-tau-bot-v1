import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assistantDemo} from './assistant-server.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export default defineConfig(async()=>{Object.assign(process.env,loadEnv('development',root,''));return {root,plugins:[assistantDemo(),{name:'demo-fixtures',enforce:'pre',resolveId(source,importer){if(source.startsWith('/snapshot/'))return this.resolve(resolve(root,source.slice(1)),importer,{skipSelf:true});if(!importer||!source.startsWith('.'))return;const p=resolve(dirname(importer),source).replace(/\.tsx?$/,'');for(const name of ['api','identity'])if(p===resolve(root,'snapshot/source/admin/src/lib/'+name))return resolve(root,name+'.ts');}},react()],resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:8770,strictPort:true},build:{rollupOptions:{input:{dashboard:resolve(root,'dashboard-browser.html'),library:resolve(root,'library-v3.html'),limit:resolve(root,'assistant-limit.html')}}}};});
