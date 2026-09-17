"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const NAMES = new Set(["Error","TypeError","ApiError","AbortError","TimeoutError","GeminiVideoError","AggregateError"]);
const CODES = new Set(["ECONNRESET","ETIMEDOUT","ECONNREFUSED","EAI_AGAIN","ENOTFOUND","ENOENT","EACCES","EPERM","EISDIR","EIO","UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT","UND_ERR_SOCKET","INVALID_ARGUMENT","NOT_FOUND","PERMISSION_DENIED","UNAUTHENTICATED","RESOURCE_EXHAUSTED","UNAVAILABLE","INTERNAL","DEADLINE_EXCEEDED","FAILED_PRECONDITION"]);
function numeric(value) { return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined; }
function causes(error) {
 const result=[],seen=new Set();
 for(let e=error;e && typeof e==="object" && result.length<4 && !seen.has(e);e=e.cause){
  seen.add(e);
  let body=e.response?.data?.error || e.error;
  if(!body && e.name==="ApiError" && typeof e.message==="string" && e.message.length<65536){try{body=JSON.parse(e.message)?.error;}catch{}}
  result.push({name:NAMES.has(e.name)?e.name:"OtherError",
   httpStatus:numeric(e.status) || numeric(e.statusCode) || numeric(e.response?.status) || numeric(e.code),
   code:CODES.has(e.code)?e.code:undefined,
   providerCode:CODES.has(body?.code)?body.code:numeric(body?.code),
   providerStatus:CODES.has(body?.status)?body.status:undefined});
 }
 return result;
}
function substage(error, fallback) {
 // Observe only known SDK stack function names; never emit stack text or URLs.
 const stack=typeof error?.stack==="string"?error.stack.slice(0,16000):"";
 if(/fetchUploadUrl/.test(stack))return "sdk_upload_initialization";
 if(/uploadFileFromPathInternal|uploadBlob/.test(stack))return "transfer_finalization";
 if(/uploadFileFromPath/.test(stack))return "provider_file_response_handling";
 return fallback;
}
function metadata(filePath,mimeType,fileName){
 let exists=false,readable=false,byteSize=null;
 try{exists=fs.existsSync(filePath);const s=fs.statSync(filePath);byteSize=s.isFile()?s.size:null;fs.accessSync(filePath,fs.constants.R_OK);readable=s.isFile();}catch{}
 const ext=path.extname(typeof fileName==="string"?fileName:"").toLowerCase();
 return {exists,readable,byteSize,extension:[".mp4",".mov",".webm",".avi",".mkv",".mpeg",".mpg",".m4v",".3gp"].includes(ext)?ext:"unknown",
 declaredMime:["video/mp4","video/quicktime","video/webm","video/x-msvideo","video/x-matroska","video/mpeg","video/3gpp"].includes(mimeType)?mimeType:"other"};
}
function emit(logger,fields){try{logger?.info?.("[GeminiUploadDiagnostic]",fields);}catch{}}
module.exports={extension:fileName=>{const ext=path.extname(typeof fileName==="string"?fileName:"").toLowerCase();return [".mp4",".mov",".webm",".avi",".mkv",".mpeg",".mpg",".m4v",".3gp"].includes(ext)?ext:"unknown";},newCorrelationId:()=>crypto.randomUUID(),causes,substage,metadata,emit};
