import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
const {reloadConfig,validateConfig}=await import(pathToFileURL(root+'/src/runtime/config.ts'));
const names=['PORT','REQUEST_TIMEOUT_MS','TELEMETRY_BATCH_SIZE','TELEMETRY_FLUSH_INTERVAL_MS','TELEMETRY_MAX_QUEUE_SIZE','RUVECTOR_SERVICE_URL','TELEMETRY_ENDPOINT'];
const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
function measure(name,env,port,timeout,invalid){for(const n of names)delete process.env[n];Object.assign(process.env,env);const c=reloadConfig(),errors=validateConfig();return {name,port:c.server.port,timeout:Number.isFinite(c.server.requestTimeoutMs)?c.server.requestTimeoutMs:String(c.server.requestTimeoutMs),errors,passed:c.server.port===port&&c.server.requestTimeoutMs===timeout&&(invalid?errors.some(e=>e.includes(invalid)):errors.length===0)};}
try{
 const holdout=[];for(const [i,value]of ['1.5','1e3','8081junk','9007199254740993'].entries())holdout.push(measure('malformed-port-'+i,{PORT:value},8080,30000));
 for(const [i,value]of ['2500junk','1234.5','9007199254740993','9'.repeat(400)].entries())holdout.push(measure('malformed-timeout-'+i,{REQUEST_TIMEOUT_MS:value},8080,30000));
 const anchors=[measure('defaults',{},8080,30000),measure('valid',{PORT:'8081',REQUEST_TIMEOUT_MS:'2500'},8081,2500),measure('trimmed-signed',{PORT:' +8081 ',REQUEST_TIMEOUT_MS:' +2500 '},8081,2500),measure('invalid-port-range',{PORT:'-1'},-1,30000,'PORT'),measure('invalid-timeout-range',{REQUEST_TIMEOUT_MS:'999'},8080,999,'REQUEST_TIMEOUT_MS')];
 console.log(JSON.stringify({holdout,anchors}));if([...holdout,...anchors].some(x=>!x.passed))process.exitCode=1;
}finally{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}}
