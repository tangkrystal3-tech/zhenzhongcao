const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createClient}=require('./ai.cjs');
test('sends server-side credentials and configured model',async()=>{
 let sent;const client=createClient({baseURL:'https://example.com/v1/',apiKey:'test-secret',model:'test-model',fetchImpl:async(url,init)=>{sent={url,init};return {ok:true,json:async()=>({choices:[{message:{content:'{"ok":true}'}}]})}}});
 assert.equal(await client.chat([{role:'user',content:'hello'}],{system:'rules',maxTokens:100}),'{'+'"ok":true}');
 assert.equal(sent.url,'https://example.com/v1/chat/completions');
 const body=JSON.parse(sent.init.body);assert.equal(body.model,'test-model');assert.equal(body.messages[0].role,'system');assert.equal(sent.init.headers.Authorization,'Bearer test-secret');
});
test('missing config is actionable and makes no request',async()=>{const c=createClient({});assert.equal(c.isAiEnabled(),false);await assert.rejects(c.chat([],{}),/配置/)});
test('rejects upstream authentication failure without exposing response',async()=>{const c=createClient({baseURL:'https://example.com/v1',apiKey:'secret',model:'m',fetchImpl:async()=>({ok:false,status:401})});await assert.rejects(c.chat([],{}),/鉴权/)});
test('rejects empty model content',async()=>{const c=createClient({baseURL:'https://example.com/v1',apiKey:'s',model:'m',fetchImpl:async()=>({ok:true,json:async()=>({choices:[]})})});await assert.rejects(c.chat([],{}),/为空/)});

test('translates request timeout',async()=>{const c=createClient({baseURL:'https://example.com/v1',apiKey:'s',model:'m',fetchImpl:async()=>{const e=new Error('timeout');e.name='TimeoutError';throw e;}});await assert.rejects(c.chat([],{}),/超时/)});
