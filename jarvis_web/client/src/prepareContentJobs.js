import { readPrepareContentResponse } from './prepareContentResponse.js';
export async function executePrepareContentJob(baseUrl, body, { fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve,ms)), now = Date.now, requestId = crypto.randomUUID() } = {}) {
  async function request(url, options = {}) {
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetchImpl(url,{...options,credentials:'include',signal:controller.signal});
      try {return await readPrepareContentResponse(response);} catch(error) {error.httpStatus=response.status;throw error;}
    } finally {clearTimeout(timer);}
  }
  const url=`${baseUrl}/api/ai/prepare-content/jobs`;
  let job;
  // A repeated submission uses the same workspace-scoped key, never another upload.
  for(let attempt=0;attempt<2;attempt++){
    try{job=await request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Corex-Job-Request':requestId},body:JSON.stringify(body)});break;}
    catch(error){if(attempt===1 || (error.httpStatus && error.httpStatus<500))throw error;await sleep(1000);}
  }
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(job?.jobId||''))throw new Error('Prepare Content returned an invalid job response.');
  const deadline=now()+41*60*1000;let pollFailures=0;
  while(now()<deadline){
    await sleep(2000);
    let state;
    try{state=await request(`${url}/${job.jobId}`);pollFailures=0;}
    catch(error){if((error.httpStatus && error.httpStatus<500) || ++pollFailures>=5)throw error;continue;}
    if(state.state==='succeeded')return state.result;
    if(state.state==='failed')throw new Error(state.failure?.error || 'Prepare Content failed.');
    if(state.state!=='running')throw new Error('Prepare Content returned an invalid job state.');
  }
  throw new Error('Prepare Content did not finish within the allowed time.');
}
